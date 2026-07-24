/**
 * 半集成测试：Codex Leader 与 Claude Teammate 协作闭环。
 *
 * 使用真实 SQLite 内存库 + 真实 EventBus，
 * mock ConversationService / TeamMcpServer，验证 TeamService 的完整业务链路。
 *
 * 对应 PLAN-4.md 中的用例一到用例七。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@server/db/connection';
import { MailboxRepository } from '@server/db/mailboxRepository';
import { TaskRepository } from '@server/db/taskRepository';
import { TeamRepository } from '@server/db/teamRepository';
import { EventBus } from '@server/events';
import type {
  AgentBackend,
  AgentEvent,
  ChatMessage,
  Conversation,
  ConversationSummary,
  ConversationStatus,
} from '@shared/types';

// ---------------------------------------------------------------------------
// Mock TeamMcpServer — same pattern as teamService.test.ts
// ---------------------------------------------------------------------------

const mockMcpInstances: Array<{
  teamId: string;
  callbacks: unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getStdioConfig: ReturnType<typeof vi.fn>;
  callTool: (tool: string, args: Record<string, unknown>, fromSlotId?: string) => Promise<unknown>;
}> = [];

vi.mock('@server/mcp/teamMcpServer', () => {
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

    constructor(teamId: string, getTeam: () => unknown, callbacks: unknown) {
      this.teamId = teamId;
      this.getTeam = getTeam;
      this.callbacks = callbacks;
      mockMcpInstances.push({
        teamId,
        callbacks,
        start: this.start,
        stop: this.stop,
        getStdioConfig: this.getStdioConfig,
        callTool: this.callTool.bind(this),
      });
    }

    async callTool(tool: string, args: Record<string, unknown>, fromSlotId?: string): Promise<unknown> {
      const parseAgentBackend = (val: unknown) => {
        if (val === 'claude' || val === 'codex') return val;
        throw new Error('backend must be exactly "claude" or "codex"');
      };

      if (tool === 'team_add_agent') {
        const name = args.name;
        const backend = parseAgentBackend(args.backend);
        return (this.callbacks as unknown).addAgent({ teamId: this.teamId, name, backend });
      }
      if (tool === 'team_delegate_task') {
        const backend = parseAgentBackend(args.backend);
        const taskBody = String(args.task || '').trim();
        const summary = args.summary ? String(args.summary).trim() : '';
        const name = String(args.name || '').trim();
        if (!taskBody) throw new Error('task is required');

        const team = this.getTeam();
        let target = team.agents.find((agent: unknown) => agent.role === 'teammate' && agent.backend === backend);
        let createdAgent = false;
        if (!target) {
          target = await (this.callbacks as unknown).addAgent({
            teamId: team.id,
            name: name || (backend === 'claude' ? 'Claude Code' : 'Codex Agent'),
            backend,
          });
          createdAgent = true;
        }

        const task = await (this.callbacks as unknown).taskCreate({
          teamId: team.id,
          title: summary || taskBody,
          description: taskBody,
          assignedSlotId: target.slotId,
          createdBySlotId: fromSlotId,
        });

        const sender = fromSlotId
          ? team.agents.find((agent: unknown) => agent.slotId === fromSlotId)
          : team.agents.find((agent: unknown) => agent.role === 'leader') ?? team.agents[0];

        const message = {
          id: crypto.randomUUID(),
          teamId: team.id,
          toAgentId: target.slotId,
          fromAgentId: sender?.slotId ?? team.leaderSlotId,
          content: [`Task: ${summary || taskBody}`, taskBody, `Task ID: ${task.id}`].join('\n\n'),
          summary: summary || taskBody,
          read: false,
          createdAt: Date.now(),
        };

        await (this.callbacks as unknown).sendMailboxMessage(message);

        return createdAgent
          ? `Delegated task to ${target.name} (${target.slotId}). The teammate has been started if it did not already exist.`
          : `Delegated task to ${target.name} (${target.slotId}).`;
      }
      throw new Error(`Unknown tool: ${tool}`);
    }
  }

  return { TeamMcpServer: MockTeamMcpServer };
});

import { TeamService } from '@server/services/teamService';

// ---------------------------------------------------------------------------
// FakeConversationService — 按 PLAN-4.md §5 设计
// ---------------------------------------------------------------------------

class FakeConversationService {
  conversations = new Map<string, Conversation>();
  mcpServers = new Map<string, unknown[]>();
  sentMessages: Array<{ conversationId: string; content: string }> = [];
  runtimePrompts: Array<{ conversationId: string; prompt: string; displayMessage?: string }> = [];
  restarted: string[] = [];
  stopped: string[] = [];
  messagesMap = new Map<string, ChatMessage[]>();

  private nextConversationIndex = 0;
  private finishHandler:
    | ((event: { conversationId: string; status: ConversationStatus }) => void | Promise<void>)
    | null = null;
  private agentEventHandler:
    | ((event: AgentEvent) => void | Promise<void>)
    | null = null;

  create(input: { backend: AgentBackend; workspaceId?: string; name?: string }): ConversationSummary {
    this.nextConversationIndex += 1;
    const conversation: Conversation = {
      id: `conv-${this.nextConversationIndex}`,
      backend: input.backend,
      name: input.name || `${input.backend} conversation`,
      workspaceId: input.workspaceId || 'workspace-team-integration',
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.conversations.set(conversation.id, conversation);
    return {
      id: conversation.id,
      name: conversation.name,
      preview: '',
      status: conversation.status,
      backend: conversation.backend,
      workspace: {
        id: conversation.workspaceId,
        name: conversation.workspaceId,
        path: '/tmp/team-integration',
        kind: 'server',
        isTemporary: false,
        existsOnDisk: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  setMcpServers(conversationId: string, servers: unknown[]): void {
    this.mcpServers.set(conversationId, servers);
  }

  restart(conversationId: string): void {
    this.restarted.push(conversationId);
  }

  stop(conversationId: string): void {
    this.stopped.push(conversationId);
  }

  async sendMessage(input: { conversationId: string; content: string }): Promise<void> {
    this.sentMessages.push(input);
  }

  async sendRuntimePrompt(input: {
    conversationId: string;
    prompt: string;
    displayMessage?: string;
    beforeRuntimeSend?: () => void;
  }): Promise<void> {
    input.beforeRuntimeSend?.();
    this.runtimePrompts.push(input);
    if (input.displayMessage?.trim()) {
      this.sentMessages.push({
        conversationId: input.conversationId,
        content: input.displayMessage,
      });
    }
  }

  onAgentEvent(
    handler: (event: AgentEvent) => void | Promise<void>
  ): () => void {
    this.agentEventHandler = handler;
    return () => {
      if (this.agentEventHandler === handler) {
        this.agentEventHandler = null;
      }
    };
  }

  commands(_conversationId: string) {
    return null;
  }

  messages(conversationId: string) {
    return this.messagesMap.get(conversationId) || [];
  }

  addDummyMessage(
    conversationId: string,
    role: 'assistant' | 'user',
    content: string,
    createdAt: number = Date.now(),
    id?: string
  ): ChatMessage {
    const messages = this.messagesMap.get(conversationId) || [];
    const msg: ChatMessage = {
      id: id || `msg-${crypto.randomUUID().slice(0, 8)}`,
      conversationId,
      role,
      content,
      createdAt,
      status: 'done',
    };
    messages.push(msg);
    this.messagesMap.set(conversationId, messages);
    return msg;
  }

  triggerFinish(conversationId: string, status: ConversationStatus): void {
    if (this.finishHandler) {
      void this.finishHandler({ conversationId, status });
    }
  }

  triggerAgentEvent(event: AgentEvent): void {
    if (this.agentEventHandler) {
      void this.agentEventHandler(event);
    }
  }

  onFinish(
    handler: (event: { conversationId: string; status: ConversationStatus }) => void | Promise<void>
  ): () => void {
    this.finishHandler = handler;
    return () => {
      if (this.finishHandler === handler) this.finishHandler = null;
    };
  }

  /** 清空所有追踪记录，保留已创建的 conversations。 */
  clearTracking(): void {
    this.sentMessages = [];
    this.runtimePrompts = [];
    this.restarted = [];
    this.stopped = [];
    this.messagesMap.clear();
  }
}

// ---------------------------------------------------------------------------
// Helper：等待异步唤醒
// ---------------------------------------------------------------------------

async function flushWakeups(): Promise<void> {
  // TeamService 用 setTimeout(fn, 0) 排队唤醒，
  // 连续 flush 保证嵌套 timer 也执行完毕。
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// 集成测试
// ---------------------------------------------------------------------------

describe('team integration flow', () => {
  let teamsRepo: TeamRepository;
  let mailboxRepo: MailboxRepository;
  let tasksRepo: TaskRepository;
  let conversations: FakeConversationService;
  let events: EventBus;
  let teamService: TeamService;
  let emitSpy: ReturnType<typeof vi.spyOn>;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    vi.useFakeTimers();

    // 真实内存 SQLite
    db = openDatabase(':memory:');
    db.prepare(
      `INSERT INTO workspaces (id, name, path, kind, is_temporary, exists_on_disk, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('workspace-team-integration', 'Team Integration', '/tmp/team-integration', 'server', 0, 1, 1, 1);
    teamsRepo = new TeamRepository(db);
    mailboxRepo = new MailboxRepository(db);
    tasksRepo = new TaskRepository(db);

    conversations = new FakeConversationService();
    events = new EventBus();
    emitSpy = vi.spyOn(events, 'emit');

    teamService = new TeamService(teamsRepo, mailboxRepo, tasksRepo, conversations as unknown, events);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockMcpInstances.length = 0;
    db.close();
  });

  // =========================================================================
  // 用例一：创建 Codex Leader Team 后应注入 MCP 配置
  // =========================================================================
  it('injects MCP config when creating a codex leader team', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });

    // Team 中只有一个 Leader
    expect(team.agents).toHaveLength(1);
    const leader = team.agents[0];
    expect(leader.role).toBe('leader');
    expect(leader.backend).toBe('codex');

    // Leader conversation 收到了 MCP servers 配置
    const leaderConvId = leader.conversationId;
    expect(conversations.mcpServers.has(leaderConvId)).toBe(true);
    const mcpConfig = conversations.mcpServers.get(leaderConvId)!;
    expect(mcpConfig).toHaveLength(1);

    // MCP 配置包含必要字段
    const cfg = mcpConfig[0];
    expect(cfg).toHaveProperty('command');
    expect(cfg).toHaveProperty('args');
    expect(cfg.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'TEAM_MCP_PORT' }),
        expect.objectContaining({ name: 'TEAM_MCP_TOKEN' }),
        expect.objectContaining({ name: 'TEAM_AGENT_SLOT_ID', value: leader.slotId }),
      ])
    );

    // TeamMcpServer 已启动
    expect(mockMcpInstances).toHaveLength(1);
    expect(mockMcpInstances[0].start).toHaveBeenCalledTimes(1);

    // 持久化验证
    const persisted = teamsRepo.getTeam(team.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.agents).toHaveLength(1);
    expect(persisted!.leaderSlotId).toBe(leader.slotId);
  });

  // =========================================================================
  // 用例二：Leader 添加 Claude 后不应重启 Leader
  // =========================================================================
  it('adds claude teammate without restarting leader', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    // 清空 mock 调用记录
    conversations.clearTracking();
    emitSpy.mockClear();

    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Reviewer',
      backend: 'claude',
    });

    // Team agents 数量从 1 变成 2
    const refreshed = teamsRepo.getTeam(team.id)!;
    expect(refreshed.agents).toHaveLength(2);

    // 新 Agent 属性正确
    expect(claude.backend).toBe('claude');
    expect(claude.role).toBe('teammate');
    expect(claude.name).toBe('Claude Reviewer');
    expect(claude.slotId).toBeTruthy();

    // 新 Agent conversation 有 MCP 配置
    expect(conversations.mcpServers.has(claude.conversationId)).toBe(true);
    const claudeMcp = conversations.mcpServers.get(claude.conversationId)!;
    expect(claudeMcp[0].env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'TEAM_AGENT_SLOT_ID', value: claude.slotId }),
      ])
    );

    // Leader conversation 没有被 stop/restart
    expect(conversations.stopped).not.toContain(leader.conversationId);
    expect(conversations.restarted).not.toContain(leader.conversationId);

    // 没有新的 MCP 实例（复用已有 session）
    expect(mockMcpInstances).toHaveLength(1);
    expect(mockMcpInstances[0].stop).not.toHaveBeenCalled();

    // 事件已发射
    expect(emitSpy).toHaveBeenCalledWith('team.agent.added', {
      teamId: team.id,
      agent: expect.objectContaining({ name: 'Claude Reviewer', role: 'teammate' }),
    });
  });

  // =========================================================================
  // 用例三：Leader 使用 team_delegate_task 创建 Claude 并派发任务
  // =========================================================================
  it('delegates a task to claude and wakes claude', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    const mcp = mockMcpInstances[0];

    // 调用 team_delegate_task 工具
    await mcp.callTool('team_delegate_task', {
      backend: 'claude',
      name: 'Claude Reviewer',
      task: '请回答你当前使用的模型是什么',
      summary: '询问 Claude 当前模型',
    }, leader.slotId);

    await flushWakeups();

    // Claude 被创建
    const refreshed = teamsRepo.getTeam(team.id)!;
    expect(refreshed.agents).toHaveLength(2);
    const claude = refreshed.agents.find((a) => a.backend === 'claude' && a.role === 'teammate')!;
    expect(claude).toBeDefined();
    expect(claude.name).toBe('Claude Reviewer');

    // Claude 收到任务消息
    const claudeMessages = conversations.runtimePrompts.filter(
      (m) => m.conversationId === claude.conversationId
    );
    expect(claudeMessages.length).toBeGreaterThanOrEqual(1);

    // Claude 收到的 prompt 包含关键信息
    const claudePrompt = claudeMessages[claudeMessages.length - 1].prompt;
    expect(claudePrompt).toContain(`You are ${claude.name}`);
    expect(claudePrompt).toContain('Current teammates:');
    expect(claudePrompt).toContain('Unread team messages:');
    expect(claudePrompt).toContain('请回答你当前使用的模型是什么');
    expect(
      conversations.sentMessages.find((m) => m.conversationId === claude.conversationId)?.content
    ).toContain('Leader: Task: 询问 Claude 当前模型');
    expect(
      conversations.sentMessages.find((m) => m.conversationId === claude.conversationId)?.content
    ).toContain('请回答你当前使用的模型是什么');

    // Leader 没有被同步阻塞 — sendMessage 是异步的，无同步等待
    // Leader 的 conversation 不应被唤醒（只有 Claude 被唤醒）
    const leaderMessages = conversations.runtimePrompts.filter(
      (m) => m.conversationId === leader.conversationId
    );
    expect(leaderMessages).toHaveLength(0);

    // mailbox 中存在一条发给 Claude 的消息
    const timeline = teamService.timeline(team.id);
    const claudeMailbox = timeline.filter((e) => e.message.toAgentId === claude.slotId);
    expect(claudeMailbox.length).toBeGreaterThanOrEqual(1);
    expect(claudeMailbox[claudeMailbox.length - 1].message.content).toContain('请回答你当前使用的模型是什么');
  });

  // =========================================================================
  // 用例四：已有 Claude 时 team_delegate_task 应复用现有 Agent
  // =========================================================================
  it('reuses existing claude teammate when delegating again', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    const mcp = mockMcpInstances[0];

    // 第一次委派，创建 Claude Reviewer
    await mcp.callTool('team_delegate_task', {
      backend: 'claude',
      name: 'Claude Reviewer',
      task: '第一次任务',
    }, leader.slotId);

    await flushWakeups();

    const afterFirst = teamsRepo.getTeam(team.id)!;
    const claudeCountAfterFirst = afterFirst.agents.filter((a) => a.backend === 'claude').length;
    expect(claudeCountAfterFirst).toBe(1);
    const claude = afterFirst.agents.find((a) => a.backend === 'claude')!;

    // 再次委派
    await mcp.callTool('team_delegate_task', {
      backend: 'claude',
      task: '请审查当前实现',
    }, leader.slotId);

    await flushWakeups();

    // Team agents 数量仍为 2，没有重复创建
    const afterSecond = teamsRepo.getTeam(team.id)!;
    const claudeCountAfterSecond = afterSecond.agents.filter((a) => a.backend === 'claude').length;
    expect(claudeCountAfterSecond).toBe(claudeCountAfterFirst);

    // 任务消息发送给已有 Claude
    const claudeMessages = conversations.runtimePrompts.filter(
      (m) => m.conversationId === claude.conversationId
    );
    expect(claudeMessages.length).toBeGreaterThanOrEqual(2);

    // mailbox 中任务目标是已有 Claude 的 slotId
    const timeline = teamService.timeline(team.id);
    const claudeMailbox = timeline.filter((e) => e.message.toAgentId === claude.slotId);
    expect(claudeMailbox.length).toBeGreaterThanOrEqual(2);
    expect(claudeMailbox[claudeMailbox.length - 1].message.content).toContain('请审查当前实现');
  });

  // =========================================================================
  // 用例五：Claude 调用 team_finish_task 后 Leader 应收到结果
  // =========================================================================
  it('delivers claude finishTask result back to codex leader', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Reviewer',
      backend: 'claude',
    });

    conversations.clearTracking();
    emitSpy.mockClear();

    // 模拟 Claude 完成任务
    await teamService.finishTask({
      teamId: team.id,
      fromSlotId: claude.slotId,
      summary: 'Claude 当前模型是 claude-4-opus',
    });

    await flushWakeups();

    // mailbox 中出现一条发给 Leader 的消息
    const timeline = teamService.timeline(team.id);
    const leaderMail = timeline.filter((e) => e.message.toAgentId === leader.slotId);
    expect(leaderMail.length).toBeGreaterThanOrEqual(1);

    // 消息来源是 Claude
    const resultMessage = leaderMail.find((e) =>
      e.message.content.includes('Task finished: Claude 当前模型是 claude-4-opus')
    );
    expect(resultMessage).toBeDefined();
    expect(resultMessage!.message.fromAgentId).toBe(claude.slotId);
    expect(resultMessage!.message.toAgentId).toBe(leader.slotId);
    expect(resultMessage!.fromAgentName).toBe('Claude Reviewer');
    expect(resultMessage!.toAgentName).toBe('Leader');

    // Leader 的 conversation 被 sendMessage 唤醒
    const leaderMessages = conversations.runtimePrompts.filter(
      (m) => m.conversationId === leader.conversationId
    );
    expect(leaderMessages.length).toBeGreaterThanOrEqual(1);

    // Leader 收到的 prompt 能看到 Claude 的结果
    const leaderPrompt = leaderMessages[leaderMessages.length - 1].prompt;
    expect(leaderPrompt).toContain('Claude 当前模型是 claude-4-opus');
    expect(leaderPrompt).toContain('You are Leader');
    expect(
      conversations.sentMessages.find((m) => m.conversationId === leader.conversationId)?.content
    ).toContain('Claude Reviewer: Task finished: Claude 当前模型是 claude-4-opus');

    // 任务记录已完成
    const tasks = teamService.tasks(team.id);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const doneTask = tasks.find((t) => t.status === 'done');
    expect(doneTask).toBeDefined();
    expect(doneTask!.completionSummary).toBe('Claude 当前模型是 claude-4-opus');
    expect(doneTask!.completedBySlotId).toBe(claude.slotId);
  });

  // =========================================================================
  // 用例六：Claude 直接 team_send_message 给 Leader 时 Leader 应收到消息
  // =========================================================================
  it('allows claude to send a direct message to leader', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Reviewer',
      backend: 'claude',
    });

    conversations.clearTracking();
    emitSpy.mockClear();

    // 通过 MCP callback 直接投递消息（模拟 Claude 通过 MCP tool 发消息给 Leader）
    const { callbacks } = mockMcpInstances[0];
    await callbacks.sendMailboxMessage({
      id: crypto.randomUUID(),
      teamId: team.id,
      toAgentId: leader.slotId,
      fromAgentId: claude.slotId,
      content: '我当前使用的是 Claude 模型。',
      read: false,
      createdAt: Date.now(),
    });

    await flushWakeups();

    // Leader 收到 Claude 消息
    const timeline = teamService.timeline(team.id);
    const leaderMail = timeline.filter((e) => e.message.toAgentId === leader.slotId);
    expect(leaderMail.length).toBeGreaterThanOrEqual(1);

    // 消息内容完整
    const directMessage = leaderMail.find((e) =>
      e.message.content.includes('我当前使用的是 Claude 模型。')
    );
    expect(directMessage).toBeDefined();
    expect(directMessage!.fromAgentName).toBe('Claude Reviewer');
    expect(directMessage!.toAgentName).toBe('Leader');

    // Timeline 可展示 Claude Reviewer → Leader
    expect(directMessage!.message.fromAgentId).toBe(claude.slotId);
    expect(directMessage!.message.toAgentId).toBe(leader.slotId);

    // Leader conversation 被调用一次
    const leaderMessages = conversations.runtimePrompts.filter(
      (m) => m.conversationId === leader.conversationId
    );
    expect(leaderMessages).toHaveLength(1);

    // Leader prompt 包含消息内容
    expect(leaderMessages[0].prompt).toContain('我当前使用的是 Claude 模型。');
    expect(
      conversations.sentMessages.find((m) => m.conversationId === leader.conversationId)?.content
    ).toContain('Claude Reviewer: 我当前使用的是 Claude 模型。');

    // 事件已发射
    expect(emitSpy).toHaveBeenCalledWith(
      'team.agent.message',
      expect.objectContaining({
        teamId: team.id,
        entry: expect.objectContaining({
          fromAgentName: 'Claude Reviewer',
          toAgentName: 'Leader',
        }),
      })
    );
  });

  // =========================================================================
  // 用例七：非法 backend 应被拒绝
  // =========================================================================
  it('rejects invalid backend values through team MCP tools', async () => {
    const team = await teamService.create({
      name: 'Invalid Backend Team',
      leaderBackend: 'codex',
    });

    const before = teamService.get(team.id)!;
    const agentCountBefore = before.agents.length;
    const conversationCountBefore = conversations.conversations.size;

    const mcp = mockMcpInstances[0];

    // 通过 MCP tool 'team_delegate_task' 发送非法 backend，断言抛出异常
    await expect(
      mcp.callTool('team_delegate_task', {
        backend: 'anthropic',
        task: 'test task',
      })
    ).rejects.toThrow('backend must be exactly "claude" or "codex"');

    // 通过 MCP tool 'team_add_agent' 发送非法 backend，断言抛出异常
    await expect(
      mcp.callTool('team_add_agent', {
        name: 'Bad Agent',
        backend: 'claude-code',
      })
    ).rejects.toThrow('backend must be exactly "claude" or "codex"');

    const after = teamService.get(team.id)!;

    // 验证：没有创建新的 teammate，没有多余的 conversation
    expect(after.agents).toHaveLength(agentCountBefore);
    expect(conversations.conversations.size).toBe(conversationCountBefore);

    // 验证合法 backend 仍可正常添加
    const validResult = await mcp.callTool('team_add_agent', {
      name: 'Valid Claude',
      backend: 'claude',
    });
    expect(validResult.name).toBe('Valid Claude');
    expect(validResult.backend).toBe('claude');

    expect(teamsRepo.getTeam(team.id)!.agents).toHaveLength(agentCountBefore + 1);
  });

  // =========================================================================
  // 补充：EventBus 事件顺序验证
  // =========================================================================
  it('emits events in expected order during full collaboration cycle', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    emitSpy.mockClear();

    // Step 1: 添加 Claude
    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Worker',
      backend: 'claude',
    });

    // Step 2: 用户给 Leader 发消息
    await teamService.sendMessage({
      teamId: team.id,
      content: '请让 Claude 回答模型问题',
    });
    await flushWakeups();

    // Step 3: Claude 完成任务
    await teamService.finishTask({
      teamId: team.id,
      fromSlotId: claude.slotId,
      summary: '我是 Claude 4 Opus',
    });
    await flushWakeups();

    // 收集所有 emit 调用
    const emittedEvents = emitSpy.mock.calls.map(([name, data]) => ({
      name: name as string,
      data: data as unknown,
    }));

    // 验证关键事件存在
    const eventNames = emittedEvents.map((e) => e.name);

    // team.agent.added 应最早出现
    expect(eventNames).toContain('team.agent.added');

    // team.agent.message 应出现多次（Leader 收到用户消息、Claude 完成结果回流）
    const messageEvents = emittedEvents.filter((e) => e.name === 'team.agent.message');
    expect(messageEvents.length).toBeGreaterThanOrEqual(2);

    // team.agent.status 应有 active 和 idle 交替
    const statusEvents = emittedEvents.filter((e) => e.name === 'team.agent.status');
    expect(statusEvents.length).toBeGreaterThanOrEqual(2);

    const leaderActiveEvents = statusEvents.filter(
      (e) => e.data.slotId === leader.slotId && e.data.status === 'active'
    );
    const leaderIdleEvents = statusEvents.filter(
      (e) => e.data.slotId === leader.slotId && e.data.status === 'idle'
    );
    expect(leaderActiveEvents.length).toBeGreaterThanOrEqual(1);
    expect(leaderIdleEvents.length).toBeGreaterThanOrEqual(1);

    // team.turn.finished 应出现
    expect(eventNames).toContain('team.turn.finished');

    // 验证事件顺序：agent.added 在所有 message/status 之前
    const addedIndex = eventNames.indexOf('team.agent.added');
    const firstMessageIndex = eventNames.indexOf('team.agent.message');
    expect(addedIndex).toBeLessThan(firstMessageIndex);
  });

  // =========================================================================
  // 补充：Team timeline / mailbox 完整消息链路验证
  // =========================================================================
  it('maintains a complete timeline across the full collaboration cycle', async () => {
    const team = await teamService.create({
      name: 'Timeline Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Worker',
      backend: 'claude',
    });

    // 用户 → Leader
    await teamService.sendMessage({
      teamId: team.id,
      content: '请让 Claude 分析代码',
    });
    await flushWakeups();

    // Leader → Claude（模拟 Leader 使用 MCP callback）
    const { callbacks } = mockMcpInstances[0];
    await callbacks.sendMailboxMessage({
      id: crypto.randomUUID(),
      teamId: team.id,
      toAgentId: claude.slotId,
      fromAgentId: leader.slotId,
      content: '请分析 src/server/teamService.ts 的代码质量',
      read: false,
      createdAt: Date.now(),
    });
    await flushWakeups();

    // Claude → Leader（模拟 Claude 完成任务）
    await teamService.finishTask({
      teamId: team.id,
      fromSlotId: claude.slotId,
      summary: '代码质量良好，建议补充错误处理',
    });
    await flushWakeups();

    // 验证 timeline
    const timeline = teamService.timeline(team.id);

    // 至少有 3 条消息：user→Leader, Leader→Claude, Claude→Leader
    expect(timeline.length).toBeGreaterThanOrEqual(3);

    // 验证消息方向
    const userToLeader = timeline.find(
      (e) => e.fromAgentName === 'user' && e.toAgentName === 'Leader'
    );
    expect(userToLeader).toBeDefined();
    expect(userToLeader!.message.content).toContain('请让 Claude 分析代码');

    const leaderToClaude = timeline.find(
      (e) => e.fromAgentName === 'Leader' && e.toAgentName === 'Claude Worker'
    );
    expect(leaderToClaude).toBeDefined();

    const claudeToLeader = timeline.find(
      (e) => e.fromAgentName === 'Claude Worker' && e.toAgentName === 'Leader'
    );
    expect(claudeToLeader).toBeDefined();
    expect(claudeToLeader!.message.content).toContain('代码质量良好');

    // 所有消息都已处理
    for (const entry of timeline) {
      expect(entry.processed).toBe(true);
    }
  });

  // =========================================================================
  // 补充：Teammate 重复回流与旧消息过滤防御用例
  // =========================================================================

  // 用例 1: teammate 已调用 team_finish_task 时，不再自动回流 Reply from ...
  it('does not auto-reply when teammate has already called finishTask', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];
    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Worker',
      backend: 'claude',
    });

    // 唤醒 claude
    await teamService.sendMessageToAgent({
      teamId: team.id,
      slotId: claude.slotId,
      content: '任务',
    });
    await flushWakeups();

    // 模拟 claude 已经显式调用 finishTask
    await teamService.finishTask({
      teamId: team.id,
      fromSlotId: claude.slotId,
      summary: '显式汇报结果',
    });
    await flushWakeups();

    // 往 claude 对应的 conversation 里塞一条 assistant 消息，并注入真正的 reply.done
    conversations.addDummyMessage(claude.conversationId, 'assistant', '这是自然语言文本回复', Date.now(), 'reply-1');
    conversations.triggerAgentEvent({
      id: 'event-1',
      type: 'agent.reply.done',
      conversationId: claude.conversationId,
      turnId: 'turn-1',
      messageId: 'reply-1',
      content: '这是自然语言文本回复',
      at: Date.now(),
    });
    await flushWakeups();

    // 再次检查，mailbox 中关于 leader 的 timeline 里不应存在 "Reply from ..." 消息
    const timeline = teamService.timeline(team.id);
    const replies = timeline.filter(
      (e) => e.message.toAgentId === leader.slotId && e.message.content.includes('Reply from')
    );
    expect(replies).toHaveLength(0);
  });

  // 用例 2: leader conversation finish 时，不触发自动回流
  it('does not auto-reply when leader conversation finishes', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];

    // 给 leader 添加 assistant 消息并触发其 finish
    conversations.addDummyMessage(leader.conversationId, 'assistant', 'Leader 回复内容');
    
    const timelineBefore = teamService.timeline(team.id);
    const initialMailboxCount = timelineBefore.length;

    conversations.triggerFinish(leader.conversationId, 'idle');
    await flushWakeups();

    // 信箱里不应新增自动回流消息
    const timelineAfter = teamService.timeline(team.id);
    expect(timelineAfter.length).toBe(initialMailboxCount);
  });

  // 用例 3: teammate assistant 内容为空时，不触发自动回流
  it('does not auto-reply when teammate assistant message is empty', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Worker',
      backend: 'claude',
    });

    await teamService.sendMessageToAgent({
      teamId: team.id,
      slotId: claude.slotId,
      content: '任务',
    });
    await flushWakeups();

    // 塞一条空内容消息
    conversations.addDummyMessage(claude.conversationId, 'assistant', '   ');

    const timelineBefore = teamService.timeline(team.id);
    const initialMailboxCount = timelineBefore.length;

    conversations.triggerFinish(claude.conversationId, 'idle');
    await flushWakeups();

    const timelineAfter = teamService.timeline(team.id);
    expect(timelineAfter.length).toBe(initialMailboxCount);
  });

  // 用例 4: 非 idle finish，如 failed/stopped，不触发自动回流
  it('does not auto-reply on non-idle finishes like failed or stopped', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Worker',
      backend: 'claude',
    });

    await teamService.sendMessageToAgent({
      teamId: team.id,
      slotId: claude.slotId,
      content: '任务',
    });
    await flushWakeups();

    conversations.addDummyMessage(claude.conversationId, 'assistant', '出错了');

    const timelineBefore = teamService.timeline(team.id);
    const initialMailboxCount = timelineBefore.length;

    // 触发 failed
    conversations.triggerFinish(claude.conversationId, 'failed');
    await flushWakeups();

    // 触发 stopped
    conversations.triggerFinish(claude.conversationId, 'stopped');
    await flushWakeups();

    const timelineAfter = teamService.timeline(team.id);
    expect(timelineAfter.length).toBe(initialMailboxCount);
  });

  // 用例 5: 同一个 assistant message id 触发多次 finish，只投递一次
  it('does not auto-reply duplicate times for the same assistant message ID', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];
    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Worker',
      backend: 'claude',
    });

    await teamService.sendMessageToAgent({
      teamId: team.id,
      slotId: claude.slotId,
      content: '任务',
    });
    await flushWakeups();

    // 塞一条带固定 ID 的 assistant 消息
    const msgId = 'fixed-assistant-msg-id';
    conversations.addDummyMessage(claude.conversationId, 'assistant', '测试排重', Date.now(), msgId);

    // 第一次注入 reply.done
    conversations.triggerAgentEvent({
      id: 'event-1',
      type: 'agent.reply.done',
      conversationId: claude.conversationId,
      turnId: 'turn-1',
      messageId: msgId,
      content: '测试排重',
      at: Date.now(),
    });
    await flushWakeups();

    const timelineFirst = teamService.timeline(team.id);
    const repliesFirst = timelineFirst.filter(
      (e) => e.message.toAgentId === leader.slotId && e.message.content.includes('Reply from')
    );
    expect(repliesFirst).toHaveLength(1);

    // 第二次注入同一条 reply.done
    conversations.triggerAgentEvent({
      id: 'event-2',
      type: 'agent.reply.done',
      conversationId: claude.conversationId,
      turnId: 'turn-1',
      messageId: msgId,
      content: '测试排重',
      at: Date.now(),
    });
    await flushWakeups();

    const timelineSecond = teamService.timeline(team.id);
    const repliesSecond = timelineSecond.filter(
      (e) => e.message.toAgentId === leader.slotId && e.message.content.includes('Reply from')
    );
    expect(repliesSecond).toHaveLength(1); // 依然只是 1
  });

  // 用例 6: 本轮没有新 assistant，只存在历史 assistant 时，不自动回流旧消息
  it('does not auto-reply using old historical assistant messages if no new assistant message was created in the current turn', async () => {
    const team = await teamService.create({
      name: 'Integration Team',
      leaderBackend: 'codex',
    });
    const leader = team.agents[0];
    const claude = await teamService.addAgent({
      teamId: team.id,
      name: 'Claude Worker',
      backend: 'claude',
    });

    // 1. 第一轮：产出一条 assistant 消息
    await teamService.sendMessageToAgent({
      teamId: team.id,
      slotId: claude.slotId,
      content: '任务一',
    });
    await flushWakeups();

    const firstTime = Date.now();
    conversations.addDummyMessage(claude.conversationId, 'assistant', '第一轮回答', firstTime, 'first-reply');
    conversations.triggerAgentEvent({
      id: 'event-1',
      type: 'agent.reply.done',
      conversationId: claude.conversationId,
      turnId: 'turn-1',
      messageId: 'first-reply',
      content: '第一轮回答',
      at: firstTime,
    });
    await flushWakeups();

    // 此时第一轮已被自动回流
    const timelineFirst = teamService.timeline(team.id);
    const repliesFirst = timelineFirst.filter(
      (e) => e.message.toAgentId === leader.slotId && e.message.content.includes('第一轮回答')
    );
    expect(repliesFirst).toHaveLength(1);

    // 2. 第二轮唤醒：推进虚拟时间，没有产出新的 assistant 消息（只存在旧消息）
    vi.advanceTimersByTime(2000); // 推进时间确保转轮时间更新

    await teamService.sendMessageToAgent({
      teamId: team.id,
      slotId: claude.slotId,
      content: '任务二',
    });
    await flushWakeups();

    // 不添加任何新 message，直接再次注入同一条 reply.done
    conversations.triggerAgentEvent({
      id: 'event-2',
      type: 'agent.reply.done',
      conversationId: claude.conversationId,
      turnId: 'turn-2',
      messageId: 'first-reply',
      content: '第一轮回答',
      at: Date.now(),
    });
    await flushWakeups();

    // 此时信箱中不应再次自动回流第一轮的旧消息，即相关消息依然只有最开始的那 1 条
    const timelineSecond = teamService.timeline(team.id);
    const repliesSecond = timelineSecond.filter(
      (e) => e.message.toAgentId === leader.slotId && e.message.content.includes('Reply from Claude Worker:\n第一轮回答')
    );
    expect(repliesSecond).toHaveLength(1);
  });
});
