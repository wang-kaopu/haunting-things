import type {
  AgentBackend,
  AgentEvent,
  MailboxMessage,
  ConversationCommands,
  Team,
  TeamAgent,
  TeamMailboxEntry,
  TeamTask,
} from '../shared/types';
import type { Repository } from './db';
import type { ConversationService } from './conversations';
import type { EventBus } from './events';
import { createLogger } from './logger';
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
 * 读取未读消息 → `ConversationService.sendRuntimePrompt`（触发 ACP prompt）
 */
export class TeamService {
  private readonly logger = createLogger('team');
  /** 以 `teamId` 映射当前运行时会话。 */
  private readonly sessions = new Map<string, TeamSession>();
  /** 已排队等待唤醒的 teamId:slotId。 */
  private readonly pendingWakeups = new Set<string>();
  /** 当前正在唤醒的 teamId:slotId。 */
  private readonly activeWakeups = new Set<string>();
  /** 记录已自动回流的 teammate assistant message，避免重复投递。 */
  private readonly autoRepliedAssistantMessages = new Map<string, string>();
  /** 记录每个 conversationId 本轮是否已显式回传。 */
  private readonly explicitRepliedTurns = new Map<string, boolean>();

  constructor(
    private readonly repo: Repository,
    private readonly conversations: ConversationService,
    private readonly events: EventBus
  ) {
    const onAgentEvent = (this.conversations as ConversationService & {
      onAgentEvent?: (handler: (event: AgentEvent) => void | Promise<void>) => () => void;
    }).onAgentEvent;
    if (onAgentEvent) {
      onAgentEvent.call(this.conversations, (event) => this.handleConversationAgentEvent(event));
    }
  }

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
  async create(input: {
    name: string;
    workspace?: string;
    leaderBackend: AgentBackend;
    leaderModel?: string;
  }): Promise<Team> {
    this.logger.info('team_create_start', {
      name: input.name,
      leaderBackend: input.leaderBackend,
      leaderModel: input.leaderModel,
      hasWorkspace: Boolean(input.workspace),
    });
    const leaderConversation = this.conversations.create({
      backend: input.leaderBackend,
      model: input.leaderModel,
      workspace: input.workspace,
      name: `${input.name} - Leader`,
    });
    const leader: TeamAgent = {
      slotId: `slot-${crypto.randomUUID().slice(0, 8)}`,
      conversationId: leaderConversation.id,
      role: 'leader',
      backend: input.leaderBackend,
      model: input.leaderModel?.trim() || undefined,
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
    this.logger.info('team_create_done', {
      teamId: team.id,
      leaderSlotId: leader.slotId,
      workspace: team.workspace,
    });
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
   * 删除整个 Team 工作空间，停止所有成员 runtime，并清理持久化记录。
   */
  async delete(teamId: string): Promise<{ deleted: true }> {
    this.logger.info('team_delete_start', {
      teamId,
    });
    const team = this.repo.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);

    const session = this.sessions.get(teamId);
    if (session) {
      await session.mcpServer.stop();
      this.sessions.delete(teamId);
    }
    for (const agent of team.agents) {
      this.conversations.stop(agent.conversationId);
      this.autoRepliedAssistantMessages.delete(agent.conversationId);
      this.explicitRepliedTurns.delete(agent.conversationId);
      this.pendingWakeups.delete(`${teamId}:${agent.slotId}`);
      this.activeWakeups.delete(`${teamId}:${agent.slotId}`);
    }
    this.repo.deleteTeam(teamId);
    this.logger.info('team_delete_done', {
      teamId,
      memberCount: team.agents.length,
    });
    return { deleted: true };
  }

  /**
   * 向 Team 添加新 Agent（Teammate），并为新 conversation 注入当前 Team MCP 配置。
   */
  async addAgent(input: {
    teamId: string;
    name: string;
    backend: AgentBackend;
    model?: string;
  }): Promise<TeamAgent> {
    this.logger.info('agent_add_start', {
      teamId: input.teamId,
      name: input.name,
      backend: input.backend,
      model: input.model,
    });
    const team = this.requireTeam(input.teamId);
    const conversation = this.conversations.create({
      backend: input.backend,
      model: input.model,
      workspace: team.workspace,
      name: `${team.name} - ${input.name}`,
    });
    const agent: TeamAgent = {
      slotId: `slot-${crypto.randomUUID().slice(0, 8)}`,
      conversationId: conversation.id,
      role: 'teammate',
      backend: input.backend,
      model: input.model?.trim() || undefined,
      name: input.name,
      status: 'idle',
    };
    const updated = { ...team, agents: [...team.agents, agent], updatedAt: Date.now() };
    this.repo.updateTeam(updated);
    const session = await this.ensureSession(updated.id);
    this.injectConversationMcpConfig(session.mcpServer, conversation.id, agent.slotId);
    this.events.emit('team.agent.added', { teamId: updated.id, agent });
    this.logger.info('agent_add_done', {
      teamId: updated.id,
      slotId: agent.slotId,
      conversationId: agent.conversationId,
      backend: agent.backend,
      model: agent.model,
    });
    return agent;
  }

  /**
   * 更新 Team 中某个 Agent 的模型，并同步到对应 Conversation。
   */
  async setAgentModel(input: { teamId: string; slotId: string; model: string }): Promise<TeamAgent> {
    const team = this.requireTeam(input.teamId);
    const agent = this.requireAgent(team, input.slotId);
    const model = input.model.trim();
    if (!model) throw new Error('model is required');

    this.logger.info('agent_model_set', {
      teamId: input.teamId,
      slotId: input.slotId,
      conversationId: agent.conversationId,
      previousModel: agent.model,
      model,
    });

    const updatedAgent: TeamAgent = { ...agent, model };
    const updatedTeam: Team = {
      ...team,
      agents: team.agents.map((item) => (item.slotId === input.slotId ? updatedAgent : item)),
      updatedAt: Date.now(),
    };
    this.repo.updateTeam(updatedTeam);

    this.conversations.setModel({
      conversationId: agent.conversationId,
      model,
    });

    const session = this.sessions.get(team.id);
    if (session) {
      session.team = updatedTeam;
    }
    return updatedAgent;
  }

  /**
   * 从 Team 中移除一个 Agent（leader 不允许被移除）。
   */
  async removeAgent(input: { teamId: string; slotId: string }): Promise<{ removed: true }> {
    this.logger.info('agent_remove_start', {
      teamId: input.teamId,
      slotId: input.slotId,
    });
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
    this.events.emit('team.agent.removed', { teamId: updated.id, slotId: input.slotId });
    this.logger.info('agent_remove_done', {
      teamId: updated.id,
      slotId: input.slotId,
      conversationId: agent.conversationId,
    });
    return { removed: true };
  }

  /**
   * 创建一个显式任务记录，默认处于 pending 状态。
   */
  async taskCreate(input: {
    teamId: string;
    title: string;
    description?: string;
    assignedSlotId?: string;
    createdBySlotId?: string;
  }): Promise<TeamTask> {
    this.logger.info('task_create', {
      teamId: input.teamId,
      title: input.title,
      assignedSlotId: input.assignedSlotId,
      createdBySlotId: input.createdBySlotId,
    });
    const team = this.requireTeam(input.teamId);
    const title = input.title.trim();
    if (!title) throw new Error('title is required');
    if (input.assignedSlotId) this.requireAgent(team, input.assignedSlotId);
    if (input.createdBySlotId) this.requireAgent(team, input.createdBySlotId);

    const now = Date.now();
    return this.repo.createTask({
      id: crypto.randomUUID(),
      teamId: team.id,
      title,
      description: input.description?.trim() || undefined,
      status: 'pending',
      createdBySlotId: input.createdBySlotId,
      assignedSlotId: input.assignedSlotId,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** 返回当前 Team 的任务列表。 */
  tasks(teamId: string): TeamTask[] {
    this.requireTeam(teamId);
    return this.repo.listTasks(teamId);
  }

  /**
   * 记录某个 Agent 的任务完成结果。
   *
   * 如果没有显式 taskId，会先创建一条临时任务，再将其标记为 done，
   * 这样任务状态和完成结果都能持久化。
   */
  async finishTask(input: { teamId: string; summary: string; taskId?: string; fromSlotId?: string }): Promise<{ finished: true }> {
    this.logger.info('task_finish_start', {
      teamId: input.teamId,
      taskId: input.taskId,
      fromSlotId: input.fromSlotId,
      summaryLength: input.summary.length,
    });
    const team = this.requireTeam(input.teamId);
    const summary = input.summary.trim();
    if (!summary) throw new Error('summary is required');
    const actor =
      (input.fromSlotId && this.requireAgent(team, input.fromSlotId)) ??
      team.agents.find((agent) => agent.role === 'leader') ??
      team.agents[0];
    if (!actor) throw new Error(`Leader not found for team ${team.id}`);

    this.explicitRepliedTurns.set(actor.conversationId, true);

    const now = Date.now();
    let task = input.taskId ? this.repo.getTask(input.taskId) : null;
    if (task && task.teamId !== team.id) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    if (!task) {
      task = this.repo.createTask({
        id: input.taskId ?? crypto.randomUUID(),
        teamId: team.id,
        title: input.taskId ? `Task ${input.taskId}` : 'Ad hoc task',
        description: undefined,
        status: 'pending',
        createdBySlotId: actor.slotId,
        assignedSlotId: actor.role === 'teammate' ? actor.slotId : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.repo.updateTask({
      ...task,
      status: 'done',
      completionSummary: summary,
      completedBySlotId: actor.slotId,
      completedAt: now,
      updatedAt: now,
    });

    const leader = team.agents.find((agent) => agent.role === 'leader');
    if (leader && actor.role !== 'leader') {
      const content = input.taskId ? `Task ${input.taskId} finished: ${summary}` : `Task finished: ${summary}`;
      await this.deliver({
        id: crypto.randomUUID(),
        teamId: team.id,
        toAgentId: leader.slotId,
        fromAgentId: actor.slotId,
        content,
        summary: input.taskId ? `${input.taskId}: ${summary}` : summary,
        read: false,
        createdAt: now,
      });
    }
    this.logger.info('task_finish_done', {
      teamId: team.id,
      taskId: input.taskId,
      completedBySlotId: actor.slotId,
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
   * 当 teammate 的 assistant 回复完成时，把最终自然语言回流给 leader mailbox。
   */
  private async handleConversationAgentEvent(event: AgentEvent): Promise<void> {
    if (event.type !== 'agent.reply.done') return;

    const found = this.findTeamAgentByConversationId(event.conversationId);
    if (!found) return;

    const { team, agent } = found;
    if (agent.role !== 'teammate') return;

    /** 检查本轮是否已显式回传。 */
    const alreadyReplied = this.explicitRepliedTurns.get(event.conversationId) ?? false;
    if (alreadyReplied) {
      this.logger.debug('auto_reply_skip_explicit_reply', {
        teamId: team.id,
        slotId: agent.slotId,
        conversationId: event.conversationId,
        messageId: event.messageId,
      });
      return;
    }

    const content = event.content.trim();
    if (!content) return;

    if (this.autoRepliedAssistantMessages.get(event.conversationId) === event.messageId) {
      this.logger.debug('auto_reply_skip_duplicate', {
        teamId: team.id,
        slotId: agent.slotId,
        messageId: event.messageId,
      });
      return;
    }
    this.autoRepliedAssistantMessages.set(event.conversationId, event.messageId);

    this.logger.info('auto_reply_to_leader', {
      teamId: team.id,
      fromSlotId: agent.slotId,
      toSlotId: team.leaderSlotId,
      messageId: event.messageId,
      contentLength: content.length,
    });
    await this.deliver({
      id: crypto.randomUUID(),
      teamId: team.id,
      toAgentId: team.leaderSlotId,
      fromAgentId: agent.slotId,
      content: `Reply from ${agent.name}:\n${content}`,
      read: false,
      createdAt: Date.now(),
    });
  }

  /**
   * 停止 Team：关闭 MCP server，并停止所有成员的 ACP 进程。
   */
  async stop(teamId: string): Promise<void> {
    this.logger.info('team_stop', {
      teamId,
      hadSession: this.sessions.has(teamId),
    });
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
    await this.ensureSession(team.id);
    this.logger.info('mailbox_deliver', {
      teamId: message.teamId,
      messageId: message.id,
      fromAgentId: message.fromAgentId,
      toAgentId: message.toAgentId,
      contentLength: message.content.length,
    });
    const fromAgent = team.agents.find((agent) => agent.slotId === message.fromAgentId);

    if (
      fromAgent &&
      fromAgent.role === 'teammate' &&
      message.toAgentId === team.leaderSlotId
    ) {
      this.explicitRepliedTurns.set(fromAgent.conversationId, true);
    }

    this.repo.writeMailbox(message);
    this.events.emit('team.agent.message', {
      teamId: message.teamId,
      entry: this.buildMailboxEntry(team, message),
    });
    this.scheduleWakeAgent(message.teamId, message.toAgentId);
  }

  /**
   * 异步排队唤醒目标 Agent，避免同一 agent 重复并发起 prompt。
   */
  private scheduleWakeAgent(teamId: string, slotId: string): void {
    const key = `${teamId}:${slotId}`;
    if (this.pendingWakeups.has(key) || this.activeWakeups.has(key)) {
      this.logger.debug('wake_skip_already_queued', { teamId, slotId });
      return;
    }
    this.logger.debug('wake_scheduled', { teamId, slotId });
    this.pendingWakeups.add(key);
    setTimeout(() => {
      this.pendingWakeups.delete(key);
      void this.runWakeCycle(teamId, slotId);
    }, 0);
  }

  /**
   * 执行一轮唤醒；如果在执行期间又收到新消息，则在结束后再补一轮。
   */
  private async runWakeCycle(teamId: string, slotId: string): Promise<void> {
    const key = `${teamId}:${slotId}`;
    if (this.activeWakeups.has(key)) {
      this.logger.debug('wake_skip_active', { teamId, slotId });
      return;
    }
    const startedAt = Date.now();
    this.activeWakeups.add(key);
    try {
      this.logger.info('wake_start', { teamId, slotId });
      await this.wakeAgent(teamId, slotId);
      this.logger.info('wake_done', {
        teamId,
        slotId,
        ms: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.warn('wake_failed', {
        teamId,
        slotId,
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      /** 方法 `wakeAgent` 已经发出失败状态，这里只负责收尾和补轮次。 */
    } finally {
      this.activeWakeups.delete(key);
      const hasUnread = this.repo.listUnreadMailbox(teamId, slotId).length > 0;
      if (hasUnread) this.scheduleWakeAgent(teamId, slotId);
    }
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

    /** 本轮唤醒起点。 */
    this.explicitRepliedTurns.set(agent.conversationId, false);

    this.events.emit('team.agent.status', { teamId, slotId, status: 'active' });
    const messages = this.repo.readUnreadAndMark(teamId, slotId);
    for (const message of messages) {
      this.events.emit('team.agent.message', {
        teamId,
        entry: this.buildMailboxEntry(team, { ...message, read: true }),
      });
    }
    const prompt = formatMailbox(messages, team, agent, (conversationId) => this.conversations.commands(conversationId));
    const displayMessage = formatMailboxDisplay(messages, team);
    this.events.emit('team.agent.prompt', {
      teamId,
      slotId,
      conversationId: agent.conversationId,
      prompt,
    });
    this.logger.info('agent_prompt_send', {
      teamId,
      slotId,
      conversationId: agent.conversationId,
      unreadCount: messages.length,
      promptLength: prompt.length,
      displayMessageLength: displayMessage.length,
    });
    try {
      await this.conversations.sendRuntimePrompt({
        conversationId: agent.conversationId,
        prompt,
        displayMessage,
      });
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
    return this.restartSession(team, { restartAgents: false });
  }

  /**
   * 重建 Team 的 MCP 服务：停止旧 server，启动新 server，
   * 并将新的 stdio 配置（含端口和 token）注入所有成员的 MCP 配置。
   *
   * 在此处将 `env` 从 `Record<string,string>` 转换为 SDK 要求的 `{name,value}[]`。
   */
  private async restartSession(
    team: Team,
    options: { restartAgents?: boolean } = {}
  ): Promise<TeamSession> {
    const restartAgents = options.restartAgents ?? true;
    this.logger.info('team_session_restart', {
      teamId: team.id,
      restartAgents,
      memberCount: team.agents.length,
    });
    await this.sessions.get(team.id)?.mcpServer.stop();
    const mcpServer = new TeamMcpServer(
      team.id,
      () => this.repo.getTeam(team.id),
      {
        addAgent: (input) => this.addAgent(input),
        taskCreate: (input) => this.taskCreate(input),
        removeAgent: (input) => this.removeAgent(input),
        finishTask: (input) => this.finishTask(input),
        sendMailboxMessage: (message) => this.deliver(message),
        getCommands: (conversationId) => this.conversations.commands(conversationId),
      }
    );
    await mcpServer.start();
    for (const agent of team.agents) {
      this.injectConversationMcpConfig(mcpServer, agent.conversationId, agent.slotId);
      if (restartAgents) {
        this.conversations.restart(agent.conversationId);
      }
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

  /** 查询 Team 内成员，不存在则抛出。 */
  private requireAgent(team: Team, slotId: string): TeamAgent {
    const agent = team.agents.find((item) => item.slotId === slotId);
    if (!agent) throw new Error(`Agent not found: ${slotId}`);
    return agent;
  }

  /** 将 Team MCP stdio 桥接配置注入指定 Conversation 的启动配置。 */
  private injectConversationMcpConfig(mcpServer: TeamMcpServer, conversationId: string, slotId: string): void {
    const cfg = mcpServer.getStdioConfig(slotId);
    this.conversations.setMcpServers(conversationId, [
      {
        name: cfg.name,
        command: cfg.command,
        args: cfg.args,
        env: Object.entries(cfg.env).map(([name, value]) => ({ name, value })),
      },
    ]);
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

  private findTeamAgentByConversationId(conversationId: string): { team: Team; agent: TeamAgent } | null {
    for (const team of this.repo.listTeams()) {
      const agent = team.agents.find((item) => item.conversationId === conversationId);
      if (agent) return { team, agent };
    }
    return null;
  }
}

/**
 * 将 mailbox 未读消息格式化为 Agent 可读的团队 prompt。
 *
 * 先给出当前团队身份、成员和可用工具，再附上 mailbox 内容。
 */
function formatMailbox(
  messages: MailboxMessage[],
  team: Team,
  agent: TeamAgent,
  getCommands?: (conversationId: string) => ConversationCommands | null
): string {
  const teamLines = team.agents.map((member) => {
    const commands = getCommands?.(member.conversationId);
    const commandNames = commands?.commands
      .slice(0, 8)
      .map((cmd) => cmd.name)
      .join(', ');
    const modelPart = member.model ? `, model=${member.model}` : '';
    const commandsPart = commandNames ? `, commands=${commandNames}` : ', commands=unknown';
    return `- ${member.name} (${member.role}, ${member.backend}${modelPart}, ${member.status}${commandsPart})`;
  });
  const messageLines =
    messages.length === 0
      ? ['- No unread team messages.']
      : messages.map((message) => {
          const from =
            message.fromAgentId === 'user'
              ? 'user'
              : team.agents.find((item) => item.slotId === message.fromAgentId)?.name || message.fromAgentId;
          return `- From ${from}: ${message.content}`;
        });

  return [
    `You are ${agent.name}, a member of team ${team.name}.`,
    'Current teammates:',
    ...teamLines,
    '',
    'Available team RPC tools:',
    '- team_members: list teammates',
    '- team_add_agent: start Claude/Codex and add it to the team',
    '- team_send_message: send task/message to teammate',
    '- team_finish_task: report completion',
    '- team_delegate_task: create a task and assign it in one step',
    '',
    'Important:',
    '- When a task benefits from another agent, call team_add_agent first.',
    '- To start Claude Code, use backend exactly "claude".',
    '- After adding a teammate, use team_send_message to assign work.',
    '',
    'Unread team messages:',
    ...messageLines,
  ].join('\n');
}

function formatMailboxDisplay(messages: MailboxMessage[], team: Team): string {
  if (messages.length === 0) {
    return '无新的团队消息。';
  }

  return messages
    .map((message) => `${formatMailboxSender(message.fromAgentId, team)}: ${message.content}`)
    .join('\n');
}

function formatMailboxSender(agentId: string, team: Team): string {
  if (agentId === 'user') return 'user';
  return team.agents.find((item) => item.slotId === agentId)?.name ?? agentId;
}
