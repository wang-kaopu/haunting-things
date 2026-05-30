import type { AgentBackend, MailboxMessage, Team, TeamAgent, TeamMailboxEntry } from '../shared/types';
import type { Repository } from './db';
import type { ConversationService } from './conversations';
import type { EventBus } from './events';
import { TeamMcpServer } from './teamMcpServer';

/** 运行时 Team 会话：持有 Team 快照和对应的 MCP TCP 服务。 */
type TeamSession = {
  team: Team;
  mcpServer: TeamMcpServer;
};

/**
 * 管理 Team 的完整生命周期：创建、成员管理、消息投递、Agent 唤醒。
 *
 * 每个 Team 在内存中维护一个 `TeamSession`，包含一个
 * `TeamMcpServer`（TCP）— Agent 通过 stdio MCP 桥接到该 server，
 * 借助 `team_send_message` / `team_members` 工具与队友通信。
 *
 * 消息投递流程：
 * `sendMessage` → `deliver` → mailbox 写库 → `wakeAgent` →
 * 读取未读消息 → `ConversationService.sendMessage`（触发 ACP prompt）
 */
export class TeamService {
  /** teamId → 当前运行时会话。 */
  private readonly sessions = new Map<string, TeamSession>();

  constructor(
    private readonly repo: Repository,
    private readonly conversations: ConversationService,
    private readonly events: EventBus
  ) {}

  /**
   * 服务重启后恢复已有 Team 的 MCP session，幂等。
   * 在 index.ts 启动阶段调用，确保旧 Team 的 MCP 配置已注入所有成员的 AcpRuntime。
   */
  async restoreSession(teamId: string): Promise<void> {
    await this.ensureSession(teamId);
  }

  /**
   * 创建新 Team，自动建立 Leader conversation 并启动 MCP 服务。
   *
   * @param input.name          - Team 名称
   * @param input.workspace     - 工作目录（不传则由 ConversationService 自动创建）
   * @param input.leaderBackend - Leader Agent 使用的后端（claude / codex）
   */
  async create(input: { name: string; workspace?: string; leaderBackend: AgentBackend }): Promise<Team> {
    const leaderConversation = this.conversations.create({
      backend: input.leaderBackend,
      workspace: input.workspace,
      name: `${input.name} - Leader`,
    });
    const leader: TeamAgent = {
      slotId: `slot-${crypto.randomUUID().slice(0, 8)}`,
      conversationId: leaderConversation.id,
      role: 'leader',
      backend: input.leaderBackend,
      name: 'Leader',
      status: 'idle',
    };
    const now = Date.now();
    const team = this.repo.createTeam({
      id: crypto.randomUUID(),
      name: input.name,
      workspace: leaderConversation.workspace,
      leaderSlotId: leader.slotId,
      agents: [leader],
      createdAt: now,
      updatedAt: now,
    });
    await this.ensureSession(team.id);
    return team;
  }

  /** 返回所有 Team 列表。 */
  list(): Team[] {
    return this.repo.listTeams();
  }

  /** 按 ID 查询单个 Team，不存在返回 null。 */
  get(teamId: string): Team | null {
    return this.repo.getTeam(teamId);
  }

  /**
   * 向 Team 添加新 Agent（Teammate），并重启 MCP 服务使新成员生效。
   *
   * 重启后所有成员的 MCP 配置都会更新为新 server 的端口和 token。
   */
  async addAgent(input: { teamId: string; name: string; backend: AgentBackend }): Promise<TeamAgent> {
    const team = this.requireTeam(input.teamId);
    const conversation = this.conversations.create({
      backend: input.backend,
      workspace: team.workspace,
      name: `${team.name} - ${input.name}`,
    });
    const agent: TeamAgent = {
      slotId: `slot-${crypto.randomUUID().slice(0, 8)}`,
      conversationId: conversation.id,
      role: 'teammate',
      backend: input.backend,
      name: input.name,
      status: 'idle',
    };
    const updated = { ...team, agents: [...team.agents, agent], updatedAt: Date.now() };
    this.repo.updateTeam(updated);
    this.scheduleSessionRefresh(updated.id);
    this.events.emit('team.agent.added', { teamId: updated.id, agent });
    return agent;
  }

  /**
   * 从 Team 中移除一个 Agent（leader 不允许被移除）。
   */
  async removeAgent(input: { teamId: string; slotId: string }): Promise<{ removed: true }> {
    const team = this.requireTeam(input.teamId);
    const agent = team.agents.find((item) => item.slotId === input.slotId);
    if (!agent) throw new Error(`Agent not found: ${input.slotId}`);
    if (agent.role === 'leader') throw new Error('Leader cannot be removed');

    this.conversations.stop(agent.conversationId);
    const updated = {
      ...team,
      agents: team.agents.filter((item) => item.slotId !== input.slotId),
      updatedAt: Date.now(),
    };
    this.repo.updateTeam(updated);
    this.scheduleSessionRefresh(updated.id);
    this.events.emit('team.agent.removed', { teamId: updated.id, slotId: input.slotId });
    return { removed: true };
  }

  /**
   * 记录某个 Agent 的任务完成结果，默认通知 leader。
   *
   * 当前仓库没有完整的 task board，因此这里采用最小闭环：
   * 将完成摘要写入 leader mailbox，并唤醒 leader 处理后续协作。
   */
  async finishTask(input: { teamId: string; summary: string; taskId?: string; fromSlotId?: string }): Promise<{ finished: true }> {
    const team = this.requireTeam(input.teamId);
    const summary = input.summary.trim();
    if (!summary) throw new Error('summary is required');
    const leader = team.agents.find((agent) => agent.role === 'leader');
    if (!leader) throw new Error(`Leader not found for team ${team.id}`);

    const caller =
      (input.fromSlotId && team.agents.find((agent) => agent.slotId === input.fromSlotId)) ??
      team.agents.find((agent) => agent.role !== 'leader') ??
      leader;

    if (!caller || caller.role === 'leader') {
      return { finished: true };
    }

    const content = input.taskId ? `Task ${input.taskId} finished: ${summary}` : `Task finished: ${summary}`;
    await this.deliver({
      id: crypto.randomUUID(),
      teamId: team.id,
      toAgentId: leader.slotId,
      fromAgentId: caller.slotId,
      content,
      summary: input.taskId ? `${input.taskId}: ${summary}` : summary,
      read: false,
      createdAt: Date.now(),
    });
    return { finished: true };
  }

  /**
   * 用户向 Team 发送消息，默认投递给 Leader Agent。
   */
  async sendMessage(input: { teamId: string; content: string; files?: string[] }): Promise<void> {
    const team = this.requireTeam(input.teamId);
    await this.deliver({
      teamId: team.id,
      toAgentId: team.leaderSlotId,
      fromAgentId: 'user',
      content: input.content,
      read: false,
      createdAt: Date.now(),
      id: crypto.randomUUID(),
    });
  }

  /**
   * 用户向指定 Agent（by slotId）直接发送消息。
   */
  async sendMessageToAgent(input: { teamId: string; slotId: string; content: string; files?: string[] }): Promise<void> {
    const team = this.requireTeam(input.teamId);
    if (!team.agents.some((agent) => agent.slotId === input.slotId)) {
      throw new Error(`Agent not found: ${input.slotId}`);
    }
    await this.deliver({
      teamId: team.id,
      toAgentId: input.slotId,
      fromAgentId: 'user',
      content: input.content,
      read: false,
      createdAt: Date.now(),
      id: crypto.randomUUID(),
    });
  }

  /**
   * 停止 Team：关闭 MCP server，并停止所有成员的 ACP 进程。
   */
  async stop(teamId: string): Promise<void> {
    const session = this.sessions.get(teamId);
    if (session) {
      await session.mcpServer.stop();
      this.sessions.delete(teamId);
    }
    const team = this.repo.getTeam(teamId);
    if (team) {
      for (const agent of team.agents) {
        this.conversations.stop(agent.conversationId);
      }
    }
  }

  /**
   * 返回 Team mailbox 的完整时间线。
   */
  timeline(teamId: string): TeamMailboxEntry[] {
    const team = this.requireTeam(teamId);
    return this.repo.listMailbox(teamId).map((message) => this.buildMailboxEntry(team, message));
  }

  /**
   * 将消息写入 mailbox 并立即唤醒目标 Agent。
   */
  private async deliver(message: MailboxMessage): Promise<void> {
    const team = this.requireTeam(message.teamId);
    this.repo.writeMailbox(message);
    this.events.emit('team.agent.message', { teamId: message.teamId, entry: this.buildMailboxEntry(team, message) });
    await this.wakeAgent(message.teamId, message.toAgentId);
  }

  /**
   * 读取目标 Agent 的未读 mailbox 消息，格式化后作为 prompt 发送给 ACP 进程。
   *
   * 发送成功后 emit `team.turn.finished`；发送失败则 emit `team.agent.status: failed`。
   */
  private async wakeAgent(teamId: string, slotId: string): Promise<void> {
    const team = this.requireTeam(teamId);
    const agent = team.agents.find((item) => item.slotId === slotId);
    if (!agent) throw new Error(`Agent not found: ${slotId}`);
    this.events.emit('team.agent.status', { teamId, slotId, status: 'active' });
    const messages = this.repo.readUnreadAndMark(teamId, slotId);
    for (const message of messages) {
      this.events.emit('team.agent.message', {
        teamId,
        entry: this.buildMailboxEntry(team, { ...message, read: true }),
      });
    }
    const content = formatMailbox(messages, team);
    try {
      await this.conversations.sendMessage({ conversationId: agent.conversationId, content });
      this.events.emit('team.turn.finished', { teamId, slotId });
      this.events.emit('team.agent.status', { teamId, slotId, status: 'idle' });
    } catch (error) {
      this.events.emit('team.agent.status', {
        teamId,
        slotId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取或创建 Team 的运行时会话（幂等）。
   */
  private async ensureSession(teamId: string): Promise<TeamSession> {
    const existing = this.sessions.get(teamId);
    if (existing) return existing;
    const team = this.requireTeam(teamId);
    return this.restartSession(team);
  }

  /**
   * 重建 Team 的 MCP 服务：停止旧 server，启动新 server，
   * 并将新的 stdio 配置（含端口和 token）注入所有成员的 MCP 配置。
   *
   * env 在此处从 `Record<string,string>` 转换为 SDK 要求的 `{name,value}[]`。
   */
  private async restartSession(team: Team): Promise<TeamSession> {
    await this.sessions.get(team.id)?.mcpServer.stop();
    const mcpServer = new TeamMcpServer(
      team,
      {
        addAgent: (input) => this.addAgent({ ...input, backend: input.backend as AgentBackend }),
        removeAgent: (input) => this.removeAgent(input),
        finishTask: (input) => this.finishTask(input),
        sendMailboxMessage: (message) => this.deliver(message),
      }
    );
    await mcpServer.start();
    for (const agent of team.agents) {
      const cfg = mcpServer.getStdioConfig(agent.slotId);
      this.conversations.setMcpServers(agent.conversationId, [
        {
          name: cfg.name,
          command: cfg.command,
          args: cfg.args,
          env: Object.entries(cfg.env).map(([name, value]) => ({ name, value })),
        },
      ]);
      this.conversations.restart(agent.conversationId);
    }
    const session = { team, mcpServer };
    this.sessions.set(team.id, session);
    return session;
  }

  /** 异步重建 Team runtime，避免在当前 MCP tool 调用期间强行杀掉调用者进程。 */
  private scheduleSessionRefresh(teamId: string): void {
    setTimeout(() => {
      void this.refreshSession(teamId).catch((error) => {
        console.warn(`[Team] Failed to refresh session for ${teamId}:`, error);
      });
    }, 0);
  }

  private async refreshSession(teamId: string): Promise<TeamSession> {
    const team = this.requireTeam(teamId);
    return this.restartSession(team);
  }

  /** 查询 Team，不存在则抛出。 */
  private requireTeam(teamId: string): Team {
    const team = this.repo.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    return team;
  }

  private buildMailboxEntry(team: Team, message: MailboxMessage): TeamMailboxEntry {
    return {
      message,
      fromAgentName: this.resolveAgentName(team, message.fromAgentId),
      toAgentName: this.resolveAgentName(team, message.toAgentId),
      processed: message.read,
    };
  }

  private resolveAgentName(team: Team, agentId: string): string {
    if (agentId === 'user') return 'user';
    return team.agents.find((agent) => agent.slotId === agentId)?.name ?? agentId;
  }
}

/**
 * 将 mailbox 未读消息格式化为 Agent 可读的纯文本 prompt。
 *
 * 每条消息独占一段，格式为 `Message from <name>:\n<content>`。
 */
function formatMailbox(messages: MailboxMessage[], team: Team): string {
  if (messages.length === 0) return 'No unread team messages.';
  const names = new Map(team.agents.map((agent) => [agent.slotId, agent.name]));
  return messages
    .map((message) => {
      const from = message.fromAgentId === 'user' ? 'user' : names.get(message.fromAgentId) || message.fromAgentId;
      return `Message from ${from}:\n${message.content}`;
    })
    .join('\n\n');
}
