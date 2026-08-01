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
  messagesMap = new Map<string, ChatMessage[]>();

  private nextConversationIndex = 0;
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

  triggerAgentEvent(event: AgentEvent): void {
    if (this.agentEventHandler) {
      void this.agentEventHandler(event);
    }
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

});
