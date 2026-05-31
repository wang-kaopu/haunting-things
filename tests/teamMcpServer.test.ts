import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamMcpServer, resolveTeamMcpStdioInvocation } from '../src/server/teamMcpServer';
import type { MailboxMessage, Team, TeamAgent, TeamTask } from '../src/shared/types';

function makeTeam(): Team {
  return {
    id: 'team-1',
    name: 'Test Team',
    workspace: '/tmp/work',
    leaderSlotId: 'slot-lead',
    agents: [
      {
        slotId: 'slot-lead',
        conversationId: 'conv-lead',
        role: 'leader',
        backend: 'claude',
        name: 'Leader',
        status: 'idle',
      },
      {
        slotId: 'slot-dev',
        conversationId: 'conv-dev',
        role: 'teammate',
        backend: 'codex',
        name: 'Dev',
        status: 'idle',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function callTool(
  port: number,
  authToken: string,
  tool: string,
  args: Record<string, unknown> = {},
  fromSlotId = 'slot-lead'
): Promise<{ result?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
      const payload: Record<string, unknown> = { tool, args, authToken };
      if (fromSlotId) payload.fromSlotId = fromSlotId;
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    });

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < length + 4) return;
        const json = buffer.subarray(4, 4 + length).toString('utf8');
        buffer = buffer.subarray(4 + length);
        try {
          resolve(JSON.parse(json));
        } catch (error) {
          reject(error);
        } finally {
          socket.destroy();
        }
        return;
      }
    });
    socket.on('error', reject);
  });
}

describe('TeamMcpServer', () => {
  let server: TeamMcpServer;
  let team: Team;
  let port = 0;
  let authToken = '';
  let mailboxWrites: MailboxMessage[];
  let wakeAgent: ReturnType<typeof vi.fn>;
  let addAgent: ReturnType<typeof vi.fn>;
  let taskCreate: ReturnType<typeof vi.fn>;
  let removeAgent: ReturnType<typeof vi.fn>;
  let finishTask: ReturnType<typeof vi.fn>;
  let sendMailboxMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    team = makeTeam();
    mailboxWrites = [];
    wakeAgent = vi.fn().mockResolvedValue(undefined);
    addAgent = vi.fn(async ({ name, backend, model }: { teamId: string; name: string; backend: string; model?: string }) => {
      const agent: TeamAgent = {
        slotId: `slot-${name.toLowerCase()}`,
        conversationId: `conv-${name.toLowerCase()}`,
        role: 'teammate',
        backend,
        model,
        name,
        status: 'idle',
      };
      team.agents.push(agent);
      return agent;
    });
    taskCreate = vi.fn(async ({ title, description, assignedSlotId, createdBySlotId }: {
      teamId: string;
      title: string;
      description?: string;
      assignedSlotId?: string;
      createdBySlotId?: string;
    }): Promise<TeamTask> => {
      const task: TeamTask = {
        id: `task-${title.toLowerCase().replace(/\s+/g, '-')}`,
        teamId: team.id,
        title,
        description,
        status: 'pending',
        assignedSlotId,
        createdBySlotId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return task;
    });
    removeAgent = vi.fn(async ({ slotId }: { teamId: string; slotId: string }) => {
      team.agents = team.agents.filter((agent) => agent.slotId !== slotId);
      return { removed: true as const };
    });
    finishTask = vi.fn(async () => ({ finished: true as const }));
    sendMailboxMessage = vi.fn(async (message: MailboxMessage) => {
      mailboxWrites.push(message);
      await wakeAgent(message.toAgentId);
    });

    server = new TeamMcpServer(team.id, () => team, {
      addAgent,
      taskCreate,
      removeAgent,
      finishTask,
      sendMailboxMessage,
    });
    await server.start();
    const config = server.getStdioConfig('slot-lead');
    port = Number.parseInt(config.env.TEAM_MCP_PORT, 10);
    authToken = config.env.TEAM_MCP_TOKEN;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('rejects requests with a bad token', async () => {
    const response = await callTool(port, 'wrong-token', 'team_members');
    expect(response.error).toBe('Unauthorized');
  });

  it('resolves the stdio launcher differently for dev and production builds', () => {
    const dev = resolveTeamMcpStdioInvocation(pathToFileURL(path.resolve('src/server/teamMcpServer.ts')).href);
    expect(dev).toEqual({
      command: 'npx',
      args: ['tsx', path.resolve('src/server/teamMcpStdio.ts')],
    });

    const prod = resolveTeamMcpStdioInvocation(pathToFileURL(path.resolve('dist-server/server/teamMcpServer.js')).href);
    expect(prod).toEqual({
      command: 'node',
      args: [path.resolve('dist-server/server/teamMcpStdio.js')],
    });
  });

  it('returns the current team members', async () => {
    const response = await callTool(port, authToken, 'team_members');
    expect(response.result).toContain('Leader');
    expect(response.result).toContain('Dev');
  });

  it('writes mailbox messages and wakes the teammate when sending through MCP', async () => {
    const response = await callTool(port, authToken, 'team_send_message', {
      to: 'Dev',
      message: 'Please start on the bug fix',
      summary: 'bug fix',
    });

    expect(response.result).toContain('Message queued for Dev');
    expect(mailboxWrites).toHaveLength(1);
    expect(mailboxWrites[0]).toMatchObject({
      teamId: 'team-1',
      toAgentId: 'slot-dev',
      fromAgentId: 'slot-lead',
      content: 'Please start on the bug fix',
      summary: 'bug fix',
      read: false,
    });
    expect(wakeAgent).toHaveBeenCalledWith('slot-dev');
  });

  it('supports adding and removing teammates over the TCP interface', async () => {
    const added = await callTool(port, authToken, 'team_add_agent', {
      name: 'Researcher',
      backend: 'claude',
    });
    expect(added.result).toContain('Researcher');
    expect(addAgent).toHaveBeenCalledWith({
      teamId: 'team-1',
      name: 'Researcher',
      backend: 'claude',
      model: undefined,
    });

    const membersAfterAdd = await callTool(port, authToken, 'team_members');
    expect(membersAfterAdd.result).toContain('Researcher');

    const removed = await callTool(port, authToken, 'team_remove_agent', {
      agent: 'Researcher',
    });
    expect(removed.result).toContain('Removed teammate Researcher');
    expect(removeAgent).toHaveBeenCalledWith({
      teamId: 'team-1',
      slotId: 'slot-researcher',
    });

    const membersAfterRemove = await callTool(port, authToken, 'team_members');
    expect(membersAfterRemove.result).not.toContain('Researcher');
  });

  it('delegates a task in one call by provisioning and assigning work', async () => {
    const response = await callTool(port, authToken, 'team_delegate_task', {
      backend: 'claude',
      name: 'Researcher',
      task: 'Inspect the failing assertion and patch the regression.',
      summary: 'Investigate the flaky test',
    });

    expect(response.result).toContain('Delegated task to Researcher');
    expect(addAgent).toHaveBeenCalledWith({
      teamId: 'team-1',
      name: 'Researcher',
      backend: 'claude',
      model: undefined,
    });
    expect(taskCreate).toHaveBeenCalledWith({
      teamId: 'team-1',
      title: 'Investigate the flaky test',
      description: 'Inspect the failing assertion and patch the regression.',
      assignedSlotId: 'slot-researcher',
      createdBySlotId: 'slot-lead',
    });
    expect(mailboxWrites).toHaveLength(1);
    expect(mailboxWrites[0]).toMatchObject({
      teamId: 'team-1',
      toAgentId: 'slot-researcher',
      fromAgentId: 'slot-lead',
      summary: 'Investigate the flaky test',
    });
    expect(team.agents.some((agent) => agent.name === 'Researcher')).toBe(true);
  });

  it('reuses an existing teammate with the requested backend', async () => {
    team.agents.push({
      slotId: 'slot-claude',
      conversationId: 'conv-claude',
      role: 'teammate',
      backend: 'claude',
      name: 'Claude Reviewer',
      status: 'idle',
    });

    const response = await callTool(port, authToken, 'team_delegate_task', {
      backend: 'claude',
      task: 'Review the implementation for edge cases and regressions.',
    });

    expect(response.result).toContain('Delegated task to Claude Reviewer');
    expect(addAgent).not.toHaveBeenCalled();
    expect(taskCreate).toHaveBeenCalledWith({
      teamId: 'team-1',
      title: 'Review the implementation for edge cases and regressions.',
      description: 'Review the implementation for edge cases and regressions.',
      assignedSlotId: 'slot-claude',
      createdBySlotId: 'slot-lead',
    });
    expect(mailboxWrites[0]).toMatchObject({
      toAgentId: 'slot-claude',
      summary: 'Review the implementation for edge cases and regressions.',
    });
  });

  it('passes model when adding an agent through team_add_agent', async () => {
    const response = await callTool(port, authToken, 'team_add_agent', {
      name: 'Claude Reviewer',
      backend: 'claude',
      model: 'sonnet',
    });

    expect(response.result).toContain('Claude Reviewer');
    expect(addAgent).toHaveBeenCalledWith({
      teamId: 'team-1',
      name: 'Claude Reviewer',
      backend: 'claude',
      model: 'sonnet',
    });
  });

  it('passes model when delegating a task to a new teammate', async () => {
    const response = await callTool(port, authToken, 'team_delegate_task', {
      backend: 'claude',
      model: 'opus',
      name: 'Claude Reviewer',
      task: 'review code',
    });

    expect(response.result).toContain('Delegated task to Claude Reviewer');
    expect(addAgent).toHaveBeenCalledWith({
      teamId: 'team-1',
      name: 'Claude Reviewer',
      backend: 'claude',
      model: 'opus',
    });
  });

  it('rejects invalid backend values at runtime', async () => {
    const response = await callTool(port, authToken, 'team_add_agent', {
      name: 'Bad Agent',
      backend: 'Claude',
    });

    expect(response.error).toBe('backend must be exactly "claude" or "codex"');
  });

  it('forwards finish-task updates to the service layer', async () => {
    const response = await callTool(port, authToken, 'team_finish_task', {
      summary: 'Implemented the retry path',
      task_id: 'task-123',
    });

    expect(response.result).toContain('task-123');
    expect(finishTask).toHaveBeenCalledWith({
      teamId: 'team-1',
      summary: 'Implemented the retry path',
      taskId: 'task-123',
      fromSlotId: 'slot-lead',
    });
  });
});
