import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/server/events';
import type { AgentEvent, ChatMessage, Conversation, MailboxMessage, Team, TeamAgent, TeamTask } from '../src/shared/types';

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
  deleteTeam(id: string): void;
  writeMailbox(message: MailboxMessage): MailboxMessage;
  readUnreadAndMark(teamId: string, toAgentId: string): MailboxMessage[];
  listUnreadMailbox(teamId: string, toAgentId: string): MailboxMessage[];
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
    deleteTeam(id) {
      teams.delete(id);
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
    listUnreadMailbox(teamId, toAgentId) {
      return mailbox
        .filter((message) => message.teamId === teamId && message.toAgentId === toAgentId && !message.read)
        .map((message) => structuredClone(message));
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
    setModel: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    sendRuntimePrompt: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
    commands: ReturnType<typeof vi.fn>;
    onFinish: ReturnType<typeof vi.fn>;
    onAgentEvent: ReturnType<typeof vi.fn>;
  };
  let events: EventBus;
  let finishHandler: ((event: { conversationId: string; status: Conversation['status'] }) => void | Promise<void>) | null;
  let agentEventHandler: ((event: AgentEvent) => void | Promise<void>) | null;
  let conversationMessages: Map<string, ChatMessage[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = createFakeRepository();
    finishHandler = null;
    agentEventHandler = null;
    conversationMessages = new Map();
    conversations = {
      create: vi.fn((input: { backend: string; workspace?: string; name?: string }): Conversation => ({
        id: `conv-${mockInstances.length + 1}`,
        backend: input.backend as Conversation['backend'],
        name: input.name ?? 'conversation',
        workspace: input.workspace ?? '/tmp/workspace',
        model: undefined,
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      setMcpServers: vi.fn(),
      setModel: vi.fn((input: { conversationId: string; model: string }) => ({
        id: input.conversationId,
        backend: 'claude',
        name: 'conversation',
        workspace: '/tmp/workspace',
        model: input.model,
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      restart: vi.fn(),
      stop: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendRuntimePrompt: vi.fn().mockResolvedValue(undefined),
      messages: vi.fn((conversationId: string) => structuredClone(conversationMessages.get(conversationId) ?? [])),
      commands: vi.fn(() => null),
      onFinish: vi.fn((handler: (event: { conversationId: string; status: Conversation['status'] }) => void | Promise<void>) => {
        finishHandler = handler;
        return () => {
          if (finishHandler === handler) finishHandler = null;
        };
      }),
      onAgentEvent: vi.fn((handler: (event: AgentEvent) => void | Promise<void>) => {
        agentEventHandler = handler;
        return () => {
          if (agentEventHandler === handler) agentEventHandler = null;
        };
      }),
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
    expect(conversations.restart).not.toHaveBeenCalled();

    const emitSpy = vi.spyOn(events, 'emit');

    await service.addAgent({ teamId: team.id, name: 'Dev', backend: 'codex' });
    await vi.runAllTimersAsync();

    const refreshed = repo.getTeam(team.id);
    expect(refreshed?.agents).toHaveLength(2);
    expect(conversations.setMcpServers).toHaveBeenCalledWith('conv-2', expect.any(Array));
    expect(conversations.restart).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('team.agent.added', {
      teamId: team.id,
      agent: expect.objectContaining({ name: 'Dev', role: 'teammate' }),
    });
    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].stop).not.toHaveBeenCalled();
  });

  it('updates an agent model and synchronizes the conversation model', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude', leaderModel: 'sonnet-4' });
    const teammate = await service.addAgent({ teamId: team.id, name: 'Dev', backend: 'codex', model: 'haiku-3' });

    const updated = await service.setAgentModel({
      teamId: team.id,
      slotId: teammate.slotId,
      model: 'sonnet-4',
    });

    expect(updated.model).toBe('sonnet-4');
    expect(repo.getTeam(team.id)?.agents.find((agent) => agent.slotId === teammate.slotId)?.model).toBe('sonnet-4');
    expect(conversations.setModel).toHaveBeenCalledWith({
      conversationId: teammate.conversationId,
      model: 'sonnet-4',
    });
  });

  it('deletes a team by stopping its runtimes and removing persisted state', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });
    await service.addAgent({ teamId: team.id, name: 'Dev', backend: 'codex' });

    const result = await service.delete(team.id);

    expect(result).toEqual({ deleted: true });
    expect(repo.getTeam(team.id)).toBeNull();
    expect(conversations.stop).toHaveBeenCalledWith('conv-1');
    expect(conversations.stop).toHaveBeenCalledWith('conv-2');
    expect(mockInstances[0].stop).toHaveBeenCalledTimes(1);
  });

  it('records mailbox entries in the team timeline and marks them processed after delivery', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });

    await service.sendMessage({ teamId: team.id, content: 'Hello leader' });
    await vi.runAllTimersAsync();

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
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      prompt: expect.stringContaining('You are Leader, a member of team Alpha.'),
      displayMessage: 'user: Hello leader',
    });
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      prompt: expect.stringContaining('Current teammates:'),
      displayMessage: 'user: Hello leader',
    });
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      prompt: expect.stringContaining('Available team RPC tools:'),
      displayMessage: 'user: Hello leader',
    });
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      prompt: expect.stringContaining('team_delegate_task: create a task and assign it in one step'),
      displayMessage: 'user: Hello leader',
    });
  });

  it('queues wakeups without blocking and serializes repeated prompts for the same agent', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });

    let resolveFirstWake: (() => void) | null = null;
    conversations.sendRuntimePrompt.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstWake = resolve;
        })
    );

    await service.sendMessage({ teamId: team.id, content: 'First message' });
    expect(conversations.sendRuntimePrompt).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledTimes(1);

    await service.sendMessage({ teamId: team.id, content: 'Second message' });
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledTimes(1);

    resolveFirstWake?.();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(0);
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledTimes(2);
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
    await vi.runAllTimersAsync();

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
    expect(conversations.sendRuntimePrompt).toHaveBeenCalled();
  });

  it('auto-returns the teammate final assistant reply to the leader mailbox on conversation finish', async () => {
    const service = new TeamService(repo as any, conversations as any, events);
    const team = await service.create({ name: 'Alpha', leaderBackend: 'claude' });
    const teammate = await service.addAgent({ teamId: team.id, name: 'Dev', backend: 'codex' });

    conversationMessages.set(teammate.conversationId, [
      {
        id: 'reply-1',
        conversationId: teammate.conversationId,
        role: 'assistant',
        content: 'I fixed the bug and added coverage.',
        createdAt: Date.now(),
        status: 'done',
      },
    ]);

    await agentEventHandler?.({
      id: 'event-1',
      type: 'agent.reply.done',
      conversationId: teammate.conversationId,
      turnId: 'turn-1',
      messageId: 'reply-1',
      content: 'I fixed the bug and added coverage.',
      at: Date.now(),
    });
    await vi.runAllTimersAsync();

    const timeline = service.timeline(team.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      fromAgentName: 'Dev',
      toAgentName: 'Leader',
      processed: true,
      message: {
        content: expect.stringContaining('Reply from Dev:'),
      },
    });
    expect(conversations.sendRuntimePrompt).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      prompt: expect.stringContaining('Reply from Dev:'),
      displayMessage: 'Dev: Reply from Dev:\nI fixed the bug and added coverage.',
    });
  });
});
