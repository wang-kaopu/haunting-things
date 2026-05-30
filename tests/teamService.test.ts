import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/server/events';
import type { Conversation, MailboxMessage, Team, TeamAgent, TeamTask } from '../src/shared/types';

const mockInstances: Array<{
  teamId: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getStdioConfig: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('../src/server/teamMcpServer', () => {
  class MockTeamMcpServer {
    readonly teamId;
    readonly getTeam;
    readonly callbacks;
    readonly start = vi.fn(async () => undefined);
    readonly stop = vi.fn(async () => undefined);
    readonly getStdioConfig = vi.fn((slotId: string) => ({
      name: `mock-team-${this.teamId}`,
      command: 'node',
      args: ['mock-team-mcp.js'],
      env: {
        TEAM_MCP_PORT: '12345',
        TEAM_MCP_TOKEN: 'mock-token',
        TEAM_AGENT_SLOT_ID: slotId,
      },
    }));

    constructor(teamId: string, getTeam: () => Team | null, callbacks: unknown) {
      this.teamId = teamId;
      this.getTeam = getTeam;
      this.callbacks = callbacks;
      mockInstances.push({
        teamId,
        start: this.start,
        stop: this.stop,
        getStdioConfig: this.getStdioConfig,
      });
    }
  }

  return { TeamMcpServer: MockTeamMcpServer };
});

import { TeamService } from '../src/server/teamService';

type FakeRepository = {
  createTeam(team: Team): Team;
  updateTeam(team: Team): void;
  getTeam(id: string): Team | null;
  listTeams(): Team[];
  writeMailbox(message: MailboxMessage): MailboxMessage;
  readUnreadAndMark(teamId: string, toAgentId: string): MailboxMessage[];
  listMailbox(teamId: string): MailboxMessage[];
  createTask(task: TeamTask): TeamTask;
  updateTask(task: TeamTask): void;
  getTask(id: string): TeamTask | null;
  listTasks(teamId: string): TeamTask[];
};

function createFakeRepository(): FakeRepository {
  const teams = new Map<string, Team>();
  const mailbox: MailboxMessage[] = [];
  const tasks = new Map<string, TeamTask>();

  return {
    createTeam(team) {
      teams.set(team.id, structuredClone(team));
      return team;
    },
    updateTeam(team) {
      teams.set(team.id, structuredClone(team));
    },
    getTeam(id) {
      const team = teams.get(id);
      return team ? structuredClone(team) : null;
    },
    listTeams() {
      return [...teams.values()].map((team) => structuredClone(team));
    },
    writeMailbox(message) {
      mailbox.push(structuredClone(message));
      return message;
    },
    readUnreadAndMark(teamId, toAgentId) {
      const unread = mailbox
        .filter((message) => message.teamId === teamId && message.toAgentId === toAgentId && !message.read)
        .map((message) => structuredClone(message));
      for (const message of mailbox) {
        if (message.teamId === teamId && message.toAgentId === toAgentId && !message.read) {
          message.read = true;
        }
      }
      return unread;
    },
    listMailbox(teamId) {
      return mailbox.filter((message) => message.teamId === teamId).map((message) => structuredClone(message));
    },
    createTask(task) {
      tasks.set(task.id, structuredClone(task));
      return task;
    },
    updateTask(task) {
      if (!tasks.has(task.id)) throw new Error(`Task not found: ${task.id}`);
      tasks.set(task.id, structuredClone(task));
    },
    getTask(id) {
      const task = tasks.get(id);
      return task ? structuredClone(task) : null;
    },
    listTasks(teamId) {
      return [...tasks.values()]
        .filter((task) => task.teamId === teamId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((task) => structuredClone(task));
    },
  };
}

describe('TeamService', () => {
  let repo: FakeRepository;
  let conversations: {
    create: ReturnType<typeof vi.fn>;
    setMcpServers: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  let events: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = createFakeRepository();
    conversations = {
      create: vi.fn((input: { backend: string; workspace?: string; name?: string }): Conversation => ({
        id: `conv-${mockInstances.length + 1}`,
        backend: input.backend as Conversation['backend'],
        name: input.name ?? 'conversation',
        workspace: input.workspace ?? '/tmp/workspace',
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      setMcpServers: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    events = new EventBus();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockInstances.length = 0;
  });

  it('creates a team and refreshes the runtime when a teammate is added', async () => {
    const service = new TeamService(repo as any, conversations as any, events);

    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });
    expect(team.agents).toHaveLength(1);
    expect(conversations.create).toHaveBeenCalledTimes(1);
    expect(mockInstances).toHaveLength(1);
    expect(conversations.restart).toHaveBeenCalledTimes(1);

    const emitSpy = vi.spyOn(events, 'emit');

    await service.addAgent({ teamId: team.id, name: 'Dev', backend: 'codex' });
    await vi.runAllTimersAsync();

    const refreshed = repo.getTeam(team.id);
    expect(refreshed?.agents).toHaveLength(2);
    expect(conversations.setMcpServers).toHaveBeenCalledWith('conv-2', expect.any(Array));
    expect(conversations.restart).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('team.agent.added', {
      teamId: team.id,
      agent: expect.objectContaining({ name: 'Dev', role: 'teammate' }),
    });
    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].stop).not.toHaveBeenCalled();
  });

  it('records mailbox entries in the team timeline and marks them processed after delivery', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });

    await service.sendMessage({ teamId: team.id, content: 'Hello leader' });

    const timeline = service.timeline(team.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      fromAgentName: 'user',
      toAgentName: 'Leader',
      processed: true,
      message: {
        content: 'Hello leader',
        read: true,
      },
    });
    expect(conversations.sendMessage).toHaveBeenCalled();
  });

  it('creates explicit tasks through taskCreate', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });

    const task = await service.taskCreate({
      teamId: team.id,
      title: 'Write migration notes',
      description: 'Capture the DB schema changes',
    });

    expect(task).toMatchObject({
      teamId: team.id,
      title: 'Write migration notes',
      description: 'Capture the DB schema changes',
      status: 'pending',
    });
    expect(service.tasks(team.id)).toEqual([task]);
  });

  it('creates a temporary task and completes it when finishTask has no taskId', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });
    const teammate = await service.addAgent({ teamId: team.id, name: 'Dev', backend: 'codex' });

    await service.finishTask({
      teamId: team.id,
      summary: 'Implemented the retry path',
      fromSlotId: teammate.slotId,
    });

    const tasks = service.tasks(team.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      teamId: team.id,
      title: 'Ad hoc task',
      status: 'done',
      completionSummary: 'Implemented the retry path',
      completedBySlotId: teammate.slotId,
    });

    const timeline = service.timeline(team.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      fromAgentName: 'Dev',
      toAgentName: 'Leader',
      processed: true,
    });
    expect(conversations.sendMessage).toHaveBeenCalled();
  });
});
