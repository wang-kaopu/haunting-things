import type { AgentBackend, MailboxMessage, Team, TeamAgent } from '../shared/types';
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
    await this.restartSession(updated);
    this.events.emit('team.agent.added', { teamId: updated.id, agent });
    return agent;
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
   * 将消息写入 mailbox 并立即唤醒目标 Agent。
   */
  private async deliver(message: MailboxMessage): Promise<void> {
    this.repo.writeMailbox(message);
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
    const mcpServer = new TeamMcpServer(team, this.repo, (slotId) => this.wakeAgent(team.id, slotId));
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
    }
    const session = { team, mcpServer };
    this.sessions.set(team.id, session);
    return session;
  }

  /** 查询 Team，不存在则抛出。 */
  private requireTeam(teamId: string): Team {
    const team = this.repo.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    return team;
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
