import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentBackend, MailboxMessage, Team, TeamAgent, TeamTask } from '../shared/types';

type TcpRequest = {
  authToken?: string;
  tool?: string;
  args?: Record<string, unknown>;
  fromSlotId?: string;
};

export type StdioMcpConfig = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

type TeamCallbacks = {
  addAgent: (input: { teamId: string; name: string; backend: AgentBackend }) => Promise<TeamAgent>;
  taskCreate: (input: {
    teamId: string;
    title: string;
    description?: string;
    assignedSlotId?: string;
    createdBySlotId?: string;
  }) => Promise<TeamTask>;
  removeAgent: (input: { teamId: string; slotId: string }) => Promise<{ removed: true }>;
  finishTask: (input: { teamId: string; summary: string; taskId?: string; fromSlotId?: string }) => Promise<{
    finished: true;
  }>;
  sendMailboxMessage: (message: MailboxMessage) => Promise<void>;
};

export class TeamMcpServer {
  private server: net.Server | null = null;
  private port = 0;
  private readonly authToken = crypto.randomUUID();

  constructor(
    private readonly teamId: string,
    private readonly getTeam: () => Team | null,
    private readonly callbacks: TeamCallbacks
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    this.server = net.createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') this.port = address.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    this.port = 0;
  }

  getStdioConfig(slotId: string): StdioMcpConfig {
    const team = this.resolveTeam();
    return {
      name: `haunting-souls-team-${team.id}`,
      command: 'node',
      args: [resolveTeamMcpStdioPath()],
      env: {
        TEAM_MCP_PORT: String(this.port),
        TEAM_MCP_TOKEN: this.authToken,
        TEAM_AGENT_SLOT_ID: slotId,
      },
    };
  }

  private resolveTeam(): Team {
    const team = this.getTeam();
    if (!team) throw new Error(`Team not found: ${this.teamId}`);
    return team;
  }

  private handleSocket(socket: net.Socket): void {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < length + 4) return;
        const body = buffer.subarray(4, 4 + length).toString('utf8');
        buffer = buffer.subarray(4 + length);
        void this.handleRequest(socket, body);
      }
    });
    socket.on('error', () => socket.destroy());
    socket.setTimeout(600_000, () => socket.destroy());
  }

  private async handleRequest(socket: net.Socket, body: string): Promise<void> {
    try {
      const request = JSON.parse(body) as TcpRequest;
      if (request.authToken !== this.authToken) throw new Error('Unauthorized');
      const result = await this.callTool(request.tool || '', request.args || {}, request.fromSlotId);
      writeTcpMessage(socket, { result });
    } catch (error) {
      writeTcpMessage(socket, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      socket.end();
    }
  }

  private async callTool(tool: string, args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    switch (tool) {
      case 'team_members':
        return this.resolveTeam().agents.map(formatAgent).join('\n');
      case 'team_send_message':
        return this.sendMessage(args, fromSlotId);
      case 'team_add_agent':
        return this.addAgent(args);
      case 'team_remove_agent':
        return this.removeAgent(args);
      case 'team_finish_task':
        return this.finishTask(args, fromSlotId);
      case 'team_delegate_task':
        return this.delegateTask(args, fromSlotId);
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async sendMessage(args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    const team = this.resolveTeam();
    const to = String(args.to || '');
    const content = String(args.message || '');
    const target = this.resolveTarget(team, to);
    if (!target) throw new Error(`Teammate not found: ${to}`);

    const sender = fromSlotId
      ? team.agents.find((agent) => agent.slotId === fromSlotId)
      : team.agents.find((agent) => agent.role === 'leader') ?? team.agents[0];

    const message: MailboxMessage = {
      id: crypto.randomUUID(),
      teamId: team.id,
      toAgentId: target.slotId,
      fromAgentId: sender?.slotId ?? team.leaderSlotId,
      content,
      summary: args.summary ? String(args.summary) : undefined,
      read: false,
      createdAt: Date.now(),
    };
    await this.callbacks.sendMailboxMessage(message);
    return `Message queued for ${target.name}`;
  }

  private async addAgent(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || '').trim();
    const backend = String(args.backend || '').trim();
    if (!name) throw new Error('name is required');
    if (!backend) throw new Error('backend is required');

    const team = this.resolveTeam();
    const agent = await this.callbacks.addAgent({ teamId: team.id, name, backend: parseAgentBackend(backend) });
    return `Added teammate ${agent.name} (${agent.slotId})`;
  }

  private async removeAgent(args: Record<string, unknown>): Promise<string> {
    const team = this.resolveTeam();
    const agentRef = String(args.agent || '').trim();
    if (!agentRef) throw new Error('agent is required');
    const target = this.resolveTarget(team, agentRef);
    if (!target) throw new Error(`Teammate not found: ${agentRef}`);
    await this.callbacks.removeAgent({ teamId: team.id, slotId: target.slotId });
    return `Removed teammate ${target.name}`;
  }

  private async finishTask(args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    const team = this.resolveTeam();
    const summary = String(args.summary || '').trim();
    if (!summary) throw new Error('summary is required');
    const taskId = args.task_id ? String(args.task_id).trim() : undefined;
    await this.callbacks.finishTask({ teamId: team.id, summary, taskId, fromSlotId });
    return taskId ? `Task ${taskId} marked finished` : 'Task marked finished';
  }

  private async delegateTask(args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    const team = this.resolveTeam();
    const backend = parseAgentBackend(args.backend);
    const taskBody = String(args.task || '').trim();
    const summary = args.summary ? String(args.summary).trim() : '';
    const name = String(args.name || '').trim();
    if (!taskBody) throw new Error('task is required');

    let target = team.agents.find((agent) => agent.role === 'teammate' && agent.backend === backend) ?? null;
    let createdAgent = false;
    if (!target) {
      target = await this.callbacks.addAgent({
        teamId: team.id,
        name: name || defaultDelegateName(backend),
        backend,
      });
      createdAgent = true;
    }

    const task = await this.callbacks.taskCreate({
      teamId: team.id,
      title: summary || taskBody,
      description: taskBody,
      assignedSlotId: target.slotId,
      createdBySlotId: fromSlotId,
    });
    const sender = fromSlotId
      ? team.agents.find((agent) => agent.slotId === fromSlotId)
      : team.agents.find((agent) => agent.role === 'leader') ?? team.agents[0];
    const message: MailboxMessage = {
      id: crypto.randomUUID(),
      teamId: team.id,
      toAgentId: target.slotId,
      fromAgentId: sender?.slotId ?? team.leaderSlotId,
      content: [`Task: ${summary || taskBody}`, taskBody, `Task ID: ${task.id}`].join('\n\n'),
      summary: summary || taskBody,
      read: false,
      createdAt: Date.now(),
    };
    await this.callbacks.sendMailboxMessage(message);
    return createdAgent
      ? `Delegated task to ${target.name} (${target.slotId}). The teammate has been started if it did not already exist.`
      : `Delegated task to ${target.name} (${target.slotId}).`;
  }

  private resolveTarget(team: Team, nameOrSlotId: string): TeamAgent | null {
    const normalized = nameOrSlotId.trim().toLowerCase();
    return (
      team.agents.find(
        (agent) => agent.slotId === nameOrSlotId || agent.name.trim().toLowerCase() === normalized
      ) ?? null
    );
  }
}

function formatAgent(agent: TeamAgent): string {
  return `- ${agent.name} (${agent.role}, ${agent.backend}, ${agent.status})`;
}

function parseAgentBackend(value: unknown): AgentBackend {
  if (value === 'claude' || value === 'codex') return value;
  throw new Error('backend must be exactly "claude" or "codex"');
}

function defaultDelegateName(backend: AgentBackend): string {
  return backend === 'claude' ? 'Claude Code' : 'Codex Agent';
}

function writeTcpMessage(socket: net.Socket, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

function resolveTeamMcpStdioPath(): string {
  const current = fileURLToPath(import.meta.url);
  const built = path.join(path.dirname(current), 'teamMcpStdio.js');
  return built;
}
