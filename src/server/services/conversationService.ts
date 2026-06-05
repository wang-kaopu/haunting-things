import path from 'node:path';
import type {
  AgentBackend,
  AgentEvent,
  ChatMessage,
  Conversation,
  ConversationCommands,
  ConversationListInput,
  ConversationListResult,
  ConversationSummary,
  ConversationWithWorkspace,
  ConversationMcpServer,
  ConversationModels,
  ConversationMode,
  ConversationUsage,
  PermissionResponse,
  StopReason,
  StoredAttachment,
  Workspace,
} from '@shared/types';
import { classifyAgentEvent } from '@server/agentEventPolicy';
import type { AttachmentRepositoryPort } from '@server/db/attachmentRepository';
import type { ConversationRepositoryPort } from '@server/db/conversationRepository';
import { toAttachmentRef } from '@server/db/mappers';
import type { EventBus } from '@server/events';
import { createId } from '@server/id';
import { createLogger } from '@server/utils/logger';
import type { AttachmentService } from '@server/services/attachmentService';
import { AcpRuntime } from '@server/runtime/acpRuntime';
import { MemoryContextService } from '@server/services/memoryContextService';
import type { WorkspaceService } from '@server/services/workspaceService';

const ALLOWED_PERMISSION_MODES: Record<AgentBackend, readonly string[]> = {
  claude: ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'],
  codex: ['read-only', 'auto', 'full-access'],
};

/**
 * 管理所有 Conversation 的创建、消息收发和 ACP 运行时生命周期。
 *
 * 每个 Conversation 对应一个懒加载的 `AcpRuntime` 实例（首次 `sendMessage` 时启动）。
 * 通过 `setMcpServers` 在启动前注入 MCP 配置，启动后更新不会影响已有进程。
 *
 * 事件转发：`AcpRuntime` 的 message / agentEvent / permission / status / finish 事件
 * 经由 `EventBus` 广播给所有 WebSocket 客户端。
 */
export class ConversationService {
  private readonly logger = createLogger('conversation');
  private readonly memoryContext: MemoryContextService;
  private readonly fallbackWorkspaces = new Map<string, Workspace>();
  /** 以 `conversationId` 映射运行时实例（懒加载）。 */
  private readonly runtimes = new Map<string, AcpRuntime>();
  /** 以 `conversationId` 映射待注入的 MCP server 配置列表。 */
  private readonly mcpServers = new Map<string, ConversationMcpServer[]>();
  /** 以 `conversationId` 映射可用命令快照。 */
  private readonly commandSnapshots = new Map<string, ConversationCommands>();
  /** 以 `conversationId` 映射模型快照。 */
  private readonly modelSnapshots = new Map<string, ConversationModels>();
  /** 以 `conversationId` 映射模式快照。 */
  private readonly modeSnapshots = new Map<string, ConversationMode>();
  /** 本地 finish 监听器，用于 Team 协作回流等服务内逻辑。 */
  private readonly finishHandlers = new Set<
    (event: { conversationId: string; status: Conversation['status'] }) => void | Promise<void>
  >();
  /** 本地 agent event 监听器，用于 Team 回流等服务内逻辑。 */
  private readonly agentEventHandlers = new Set<(event: AgentEvent) => void | Promise<void>>();

  constructor(
    private readonly repo: ConversationRepositoryPort,
    private readonly events: EventBus,
    private readonly dataDir: string,
    private readonly workspaceService?: WorkspaceService,
    private readonly attachmentsRepo?: AttachmentRepositoryPort,
    private readonly attachmentService?: AttachmentService
  ) {
    this.memoryContext = new MemoryContextService(repo);
  }

  /**
   * 创建新 Conversation，并绑定已有或对话工作区。
   *
   * @param input.backend    - Agent 后端类型（claude / codex）
   * @param input.workspaceId - 工作区 ID；不传则创建对话工作区
   * @param input.name       - 显示名称，默认为 `<backend> conversation`
   * @param input.mcpServers - 可选的 MCP server 配置，会随 runtime 一同启动
   */
  create(input: {
    backend: AgentBackend;
    workspaceId?: string;
    name?: string;
    model?: string;
    mcpServers?: ConversationMcpServer[];
  }): ConversationSummary {
    const now = Date.now();
    const workspace = input.workspaceId
      ? this.requireWorkspace(input.workspaceId)
      : this.resolveOrCreateWorkspace(undefined);
    const conversation = this.repo.createConversation({
      id: createId(),
      backend: input.backend,
      name: input.name || `${input.backend} conversation`,
      workspaceId: workspace.id,
      model: input.model?.trim() || undefined,
      status: 'idle',
      acpSessionId: undefined,
      sessionMode: undefined,
      currentModelId: input.model?.trim() || undefined,
      lastTurnId: undefined,
      lastStopReason: undefined,
      lastError: undefined,
      usageSize: undefined,
      usageUsed: undefined,
      usageRatio: undefined,
      usageUpdatedAt: undefined,
      sessionRestoreStatus: undefined,
      sessionRestoreMethod: undefined,
      sessionRestoreError: undefined,
      sessionRestoredAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
    if (input.mcpServers?.length) {
      this.repo.replaceConversationMcpServers(conversation.id, input.mcpServers);
      this.mcpServers.set(conversation.id, input.mcpServers);
    }
    this.logger.info('conversation_create', {
      conversationId: conversation.id,
      backend: conversation.backend,
      model: conversation.model,
      workspaceId: conversation.workspaceId,
      workspacePath: workspace.path,
      hasMcpServers: Boolean(input.mcpServers?.length),
    });
    return this.toConversationSummary(conversation, workspace);
  }

  /**
   * 更新指定 Conversation 的 MCP server 配置。
   * 仅在 runtime 尚未启动时有效；已启动的 runtime 不会重新加载配置。
   */
  setMcpServers(conversationId: string, mcpServers: ConversationMcpServer[]): void {
    this.repo.replaceConversationMcpServers(conversationId, mcpServers);
    this.mcpServers.set(conversationId, mcpServers);
  }

  /**
   * 启动时修复异常退出遗留的运行态，避免 UI 恢复后继续显示不存在的 runtime。
   */
  recoverStaleRuntimeState(): void {
    const running = this.repo.listConversationsByStatus('running');
    for (const conversation of running) {
      const message = '应用重启，上一轮运行时已丢失';
      this.repo.finalizeStreamingMessages({
        conversationId: conversation.id,
        stopReason: 'stopped',
      });
      this.repo.finalizeInterruptedConversation({
        conversationId: conversation.id,
        lastTurnId: conversation.lastTurnId,
        reason: 'app_restarted',
        message,
      });
      this.events.emit('conversation.status', {
        conversationId: conversation.id,
        status: 'stopped',
        error: message,
      });
    }
  }

  /** 返回所有 Conversation 列表。 */
  list(input: ConversationListInput = {}): ConversationListResult {
    if (typeof this.repo.listConversationSummaries === 'function') {
      return this.repo.listConversationSummaries(input);
    }
    const data = this.repo.listConversations().flatMap((conversation) => {
      const workspace = this.requireWorkspace(conversation.workspaceId);
      return [this.toConversationSummary(conversation, workspace)];
    });
    return { data };
  }

  /** 返回单个 Conversation 快照。 */
  get(conversationId: string): Conversation | null {
    return this.repo.getConversation(conversationId);
  }

  /** 返回单个带工作区详情的 Conversation 快照。 */
  getWithWorkspace(conversationId: string): ConversationWithWorkspace | null {
    return this.getConversationWithWorkspace(conversationId);
  }

  /** 返回指定 Conversation 的历史消息。 */
  messages(conversationId: string): ChatMessage[] {
    return this.withMessageAttachments(this.repo.listMessages(conversationId));
  }

  /** 返回指定 Conversation 的标准化 Agent 事件历史，默认最近 200 条。 */
  agentEvents(conversationId: string, limit = 200): AgentEvent[] {
    return this.repo.listAgentEvents(conversationId, limit);
  }

  /** 返回指定 Conversation 的可用命令快照。 */
  commands(conversationId: string): ConversationCommands | null {
    const snapshot = this.commandSnapshots.get(conversationId);
    if (snapshot) return snapshot;
    if (typeof this.repo.getConversationCommands !== 'function') return null;
    const persisted = this.repo.getConversationCommands(conversationId);
    if (persisted) this.commandSnapshots.set(conversationId, persisted);
    return persisted;
  }

  /** 返回指定 Conversation 的模型快照。 */
  models(conversationId: string): ConversationModels | null {
    const snapshot = this.modelSnapshots.get(conversationId);
    if (snapshot) return snapshot;
    if (typeof this.repo.getConversationModels === 'function') {
      const persisted = this.repo.getConversationModels(conversationId);
      if (persisted) {
        this.modelSnapshots.set(conversationId, persisted);
        return persisted;
      }
    }
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation?.currentModelId) return null;
    return {
      conversationId,
      currentModelId: conversation.currentModelId,
      models: [],
      updatedAt: conversation.updatedAt,
    };
  }

  /** 返回指定 Conversation 的模式快照。 */
  mode(conversationId: string): ConversationMode | null {
    const snapshot = this.modeSnapshots.get(conversationId);
    if (snapshot) return snapshot;
    if (typeof this.repo.getConversationMode === 'function') {
      const persisted = this.repo.getConversationMode(conversationId);
      if (persisted) {
        this.modeSnapshots.set(conversationId, persisted);
        return persisted;
      }
    }
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation?.sessionMode) return null;
    return {
      conversationId,
      mode: conversation.sessionMode,
      updatedAt: conversation.updatedAt,
    };
  }

  /**
   * 订阅 conversation.finish 本地回调。
   *
   * 这是服务内协作钩子，不依赖 WebSocket 广播层。
   */
  onFinish(
    handler: (event: { conversationId: string; status: Conversation['status'] }) => void | Promise<void>
  ): () => void {
    this.finishHandlers.add(handler);
    return () => this.finishHandlers.delete(handler);
  }

  /**
   * 订阅 conversation.agentEvent 本地回调。
   *
   * 这是服务内协作钩子，不依赖 WebSocket 广播层。
   */
  onAgentEvent(handler: (event: AgentEvent) => void | Promise<void>): () => void {
    this.agentEventHandlers.add(handler);
    return () => this.agentEventHandlers.delete(handler);
  }

  /**
   * 向指定 Conversation 发送用户消息。
   *
   * 消息先写库并 emit `conversation.stream`，再通过 `AcpRuntime.send` 触发 ACP prompt。
   * 运行时的流式响应通过事件回调持续推送。
   */
  async sendMessage(input: { conversationId: string; content: string; files?: string[] }): Promise<void> {
    const startedAt = Date.now();
    const conversation = this.repo.getConversation(input.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);
    this.logger.info('conversation_send_start', {
      conversationId: conversation.id,
      backend: conversation.backend,
      model: conversation.model,
      contentLength: input.content.length,
      filesCount: input.files?.length ?? 0,
    });
    const attachments = this.resolveAttachments(input.files ?? []);

    const userMessage = this.repo.addMessage({
      id: createId(),
      conversationId: conversation.id,
      role: 'user',
      type: 'text',
      content: input.content,
      createdAt: Date.now(),
      status: 'done',
      sequence: 0,
    });
    this.attachmentsRepo?.linkMessageAttachments(
      userMessage.id,
      attachments.map((item) => item.id)
    );
    this.events.emit('conversation.stream', {
      conversationId: conversation.id,
      message: { ...userMessage, attachments: attachments.map(toAttachmentRef) },
    });

    try {
      const runtime = this.getRuntime(conversation);
      const restoreContext = this.memoryContext.buildRestoreContext({
        conversationId: conversation.id,
        beforeSequence: userMessage.sequence,
        maxMessages: 20,
        maxChars: 12000,
      });
      await runtime.send({
        text: input.content,
        attachments,
        restoreContext,
      });
      this.logger.info('conversation_send_done', {
        conversationId: conversation.id,
        ms: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.warn('conversation_send_failed', {
        conversationId: conversation.id,
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 向指定 Conversation 发送运行时包装 prompt。
   *
   * `prompt` 是发给模型的完整内容，`displayMessage` 是写入消息历史并广播给前端的可见文本。
   */
  async sendRuntimePrompt(input: {
    conversationId: string;
    prompt: string;
    displayMessage?: string;
    files?: string[];
  }): Promise<void> {
    const startedAt = Date.now();
    const conversation = this.repo.getConversation(input.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);

    this.logger.info('runtime_prompt_send_start', {
      conversationId: conversation.id,
      backend: conversation.backend,
      model: conversation.model,
      prompt: summarizeLogText(input.prompt),
      displayMessage: input.displayMessage ? summarizeLogText(input.displayMessage) : undefined,
      filesCount: input.files?.length ?? 0,
    });

    const visibleMessage = input.displayMessage?.trim();
    const attachments = this.resolveAttachments(input.files ?? []);
    let beforeSequence: number | undefined;
    if (visibleMessage || attachments.length > 0) {
      const userMessage = this.repo.addMessage({
        id: createId(),
        conversationId: conversation.id,
        role: 'user',
        type: 'text',
        content: visibleMessage ?? '',
        createdAt: Date.now(),
        status: 'done',
        sequence: 0,
      });
      this.attachmentsRepo?.linkMessageAttachments(
        userMessage.id,
        attachments.map((item) => item.id)
      );
      this.events.emit('conversation.stream', {
        conversationId: conversation.id,
        message: { ...userMessage, attachments: attachments.map(toAttachmentRef) },
      });
      beforeSequence = userMessage.sequence;
    }

    try {
      const runtime = this.getRuntime(conversation);
      const restoreContext = this.memoryContext.buildRestoreContext({
        conversationId: conversation.id,
        beforeSequence,
        maxMessages: 20,
        maxChars: 12000,
      });
      await runtime.send({
        text: input.prompt,
        attachments,
        restoreContext,
      });
      this.logger.info('runtime_prompt_send_done', {
        conversationId: conversation.id,
        ms: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.warn('runtime_prompt_send_failed', {
        conversationId: conversation.id,
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 响应挂起的权限请求，支持用户选择授权选项或取消本次授权。
   */
  respondPermission(input: { conversationId: string; callId: string } & PermissionResponse): { accepted: boolean; error?: string } {
    const runtime = this.runtimes.get(input.conversationId);
    if (!runtime) {
      this.logger.warn('permission_response_runtime_missing', {
        conversationId: input.conversationId,
        callId: input.callId,
        outcome: input.outcome.outcome,
      });
      return { accepted: false, error: 'runtime not found' };
    }

    const accepted = runtime.respondPermission(input.callId, input);
    if (!accepted) {
      this.logger.warn('permission_response_call_missing', {
        conversationId: input.conversationId,
        callId: input.callId,
        outcome: input.outcome.outcome,
      });
      return { accepted: false, error: 'permission request not found' };
    }

    return { accepted: true };
  }

  /**
   * 兼容旧的确认接口，等价于选择一个权限选项。
   */
  confirmPermission(input: { conversationId: string; callId: string; optionId: string }): { accepted: boolean; error?: string } {
    return this.respondPermission({
      conversationId: input.conversationId,
      callId: input.callId,
      outcome: { outcome: 'selected', optionId: input.optionId },
    });
  }

  /**
   * 取消指定 Conversation 当前正在执行的 ACP prompt turn。
   */
  async cancelCurrentTurn(input: { conversationId: string }): Promise<{ accepted: boolean; error?: string }> {
    const runtime = this.runtimes.get(input.conversationId);
    if (!runtime) {
      this.logger.warn('conversation_cancel_runtime_missing', {
        conversationId: input.conversationId,
      });
      const conversation = this.repo.getConversation(input.conversationId);
      if (conversation?.status === 'running') {
        this.finalizeMissingRuntime(input.conversationId);
      } else {
        this.markConversationIdle(input.conversationId);
      }
      return { accepted: true };
    }

    try {
      const accepted = await runtime.cancelCurrentTurn();
      if (!accepted) {
        this.markConversationIdle(input.conversationId);
        return { accepted: true };
      }
      return { accepted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('conversation_cancel_failed', {
        conversationId: input.conversationId,
        error: message,
      });
      this.repo.updateConversationTurnResult(input.conversationId, {
        lastStopReason: 'failed',
        lastError: message,
      });
      runtime.stop('idle');
      this.runtimes.delete(input.conversationId);
      return { accepted: false, error: message };
    }
  }

  /** 修改会话绑定的工作区，并重置依赖 cwd 的 ACP session。 */
  setConversationWorkspace(input: { conversationId: string; workspaceId: string }): ConversationSummary {
    const workspace = this.requireWorkspace(input.workspaceId);
    const runtime = this.runtimes.get(input.conversationId);
    if (runtime?.isActivePrompt()) {
      throw new Error('Cannot change workspace while prompt is running');
    }

    runtime?.stop('stopped');
    this.runtimes.delete(input.conversationId);

    const updated = this.repo.updateConversationWorkspace({
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
    });
    if (!updated) throw new Error(`Conversation not found: ${input.conversationId}`);

    this.events.emit('conversation.updated', updated);
    return this.toConversationSummary(updated, workspace);
  }

  /** 将 Conversation 对外状态恢复为空闲，用于取消请求已无可用 runtime 的恢复路径。 */
  private markConversationIdle(conversationId: string): void {
    this.repo.updateConversationStatus(conversationId, 'idle');
    this.events.emit('conversation.status', { conversationId, status: 'idle' });
  }

  /** 删除单条消息，并清理不再被引用的附件文件。 */
  async deleteMessage(input: { messageId: string }): Promise<{ deleted: true }> {
    const attachments = this.attachmentsRepo?.deleteMessage(input.messageId) ?? [];
    await this.attachmentService?.deleteStoredFiles(attachments);
    return { deleted: true };
  }

  /** 删除单条消息上的一个附件关联，并清理孤立附件文件。 */
  async deleteMessageAttachment(input: { messageId: string; attachmentId: string }): Promise<{ deleted: true }> {
    const attachments = this.attachmentsRepo?.deleteMessageAttachment(input.messageId, input.attachmentId) ?? [];
    await this.attachmentService?.deleteStoredFiles(attachments);
    return { deleted: true };
  }

  /** 删除指定工作区下的全部 Conversation，并先停止仍在内存中的运行态。 */
  deleteByWorkspace(workspaceId: string): { deleted: number } {
    const conversations = this.repo.listConversationsByWorkspace(workspaceId);
    for (const conversation of conversations) {
      this.stop(conversation.id);
    }

    const deleted = this.repo.deleteConversationsByWorkspace(workspaceId);
    this.logger.info('conversation_delete_by_workspace', {
      workspaceId,
      deleted,
    });
    return { deleted };
  }

  /**
   * 停止指定 Conversation 的 ACP 进程并释放 runtime。
   */
  stop(conversationId: string): void {
    this.logger.info('conversation_stop', {
      conversationId,
      hadRuntime: this.runtimes.has(conversationId),
    });
    this.runtimes.get(conversationId)?.stop();
    this.runtimes.delete(conversationId);
    this.commandSnapshots.delete(conversationId);
    this.modelSnapshots.delete(conversationId);
    this.modeSnapshots.delete(conversationId);
  }

  /**
   * 让指定 Conversation 的 runtime 下次以最新 MCP 配置重新启动。
   * 当前实现采用 stop + delete，等待下一次 sendMessage 时重新构建 runtime。
   */
  restart(conversationId: string): void {
    this.stop(conversationId);
  }

  /**
   * 更新指定 Conversation 的模型配置，并重启 runtime 以在下次发送消息时重新初始化。
   */
  setModel(input: { conversationId: string; model: string }): Conversation {
    const conversation = this.repo.getConversation(input.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);

    const model = input.model.trim();
    if (!model) throw new Error('model is required');
    if (conversation.model === model) return conversation;

    this.logger.info('conversation_model_set', {
      conversationId: conversation.id,
      previousModel: conversation.model,
      model,
    });
    this.repo.updateConversationModel(conversation.id, model);
    this.repo.updateConversationRuntimeState(conversation.id, {
      currentModelId: model,
    });
    this.restart(conversation.id);
    const now = Date.now();
    this.commandSnapshots.delete(conversation.id);
    this.modelSnapshots.delete(conversation.id);
    this.modeSnapshots.delete(conversation.id);
    this.persistConversationCommands(conversation.id, { conversationId: conversation.id, commands: [], updatedAt: now });
    this.persistConversationModels(conversation.id, {
      conversationId: conversation.id,
      currentModelId: model,
      models: [],
      updatedAt: now,
    });

    this.events.emit('conversation.commands', {
      conversationId: conversation.id,
      commands: [],
      updatedAt: now,
    });

    this.events.emit('conversation.models', {
      conversationId: conversation.id,
      currentModelId: model,
      models: [],
      updatedAt: now,
    });

    return this.repo.getConversation(conversation.id) ?? { ...conversation, model, updatedAt: now };
  }

  /** 切换指定 Conversation 当前运行时的权限模式并持久化。 */
  async setMode(input: { conversationId: string; mode: string }): Promise<ConversationMode> {
    const conversation = this.repo.getConversation(input.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);

    const mode = input.mode.trim();
    if (!mode) throw new Error('mode is required');
    this.assertPermissionModeAllowed(conversation.backend, mode);

    this.logger.info('conversation_mode_set', {
      conversationId: conversation.id,
      backend: conversation.backend,
      mode,
    });

    const runtime = this.getRuntime(conversation);
    const snapshot = await runtime.setSessionMode(mode);
    this.repo.updateConversationRuntimeState(conversation.id, {
      sessionMode: snapshot.mode,
    });
    this.persistConversationMode(conversation.id, snapshot);

    if (this.modeSnapshots.get(conversation.id) !== snapshot) {
      this.modeSnapshots.set(conversation.id, snapshot);
      this.events.emit('conversation.mode', snapshot);
    }

    return snapshot;
  }

  /** 校验权限模式是否属于指定后端实际支持的 mode id。 */
  private assertPermissionModeAllowed(backend: AgentBackend, mode: string): void {
    const allowed = ALLOWED_PERMISSION_MODES[backend];
    if (!allowed.includes(mode)) {
      throw new Error(`Unsupported permission mode for ${backend}: ${mode}. Allowed modes: ${allowed.join(', ')}`);
    }
  }

  /**
   * 获取或创建指定 Conversation 的 `AcpRuntime`。
   *
   * 首次创建时注册四类事件转发：
   * - `message`    → `conversation.stream`（含数据库持久化）
   * - `agentEvent` → `conversation.agentEvent`
   * - `permission` → `conversation.permission`
   * - `status`     → `conversation.status`（同步更新数据库）
   * - `finish`     → `conversation.finish`
   */
  private getRuntime(conversation: Conversation): AcpRuntime {
    const existing = this.runtimes.get(conversation.id);
    if (existing) return existing;

    const mcpServers = this.getConversationMcpServers(conversation.id);
    const workspace = this.resolveConversationWorkspace(conversation);
    this.logger.info('runtime_create', {
      conversationId: conversation.id,
      backend: conversation.backend,
      model: conversation.currentModelId ?? conversation.model,
      startupMode: conversation.sessionMode,
      workspaceId: conversation.workspaceId,
      workspacePath: workspace.path,
      mcpServerCount: mcpServers.length,
    });
    const runtime = new AcpRuntime({
      conversationId: conversation.id,
      backend: conversation.backend,
      workspacePath: workspace.path,
      model: conversation.currentModelId ?? conversation.model,
      startupMode: conversation.sessionMode,
      mcpServers,
      resumeSessionId: conversation.acpSessionId,
    });
    runtime.on('session', ({ sessionId, status, method, fallbackReason, updatedAt }) => {
      const updated = this.repo.updateConversationSessionRestoreState(conversation.id, {
        acpSessionId: sessionId,
        sessionRestoreStatus: status,
        sessionRestoreMethod: method,
        sessionRestoreError: fallbackReason,
        sessionRestoredAt: updatedAt,
      });
      this.logger.info('conversation_acp_session_persisted', {
        conversationId: conversation.id,
        sessionId,
        sessionRestoreStatus: status,
        sessionRestoreMethod: method,
      });
      if (updated) {
        this.events.emit('conversation.updated', updated);
      }
    });
    runtime.on('message', (message) => {
      const known = this.repo.messageExists(message.id);
      const streamMessage = known ? message : this.repo.addMessage(message);
      if (known) this.repo.updateMessage(message);
      this.events.emit('conversation.stream', { conversationId: conversation.id, message: streamMessage });
    });
    runtime.on('agentEvent', (event: AgentEvent) => {
      const policy = classifyAgentEvent(event);
      let eventForEmit = event;

      if (policy.persist) {
        eventForEmit = this.repo.addAgentEvent(event);
      }

      if (eventForEmit.type === 'agent.done') {
        this.repo.updateConversationTurnResult(conversation.id, {
          lastTurnId: eventForEmit.turnId,
          lastStopReason: eventForEmit.stopReason ?? normalizeStatusToStopReason(eventForEmit.status),
          lastError: undefined,
        });
      }

      if (eventForEmit.type === 'agent.error') {
        this.repo.updateConversationTurnResult(conversation.id, {
          lastTurnId: eventForEmit.turnId,
          lastStopReason: 'failed',
          lastError: eventForEmit.message,
        });
      }

      if (policy.realtime) {
        this.events.emit('conversation.agentEvent', eventForEmit);
      }

      for (const handler of this.agentEventHandlers) {
        Promise.resolve(handler(eventForEmit)).catch((error) => {
          this.logger.warn('agent_event_handler_failed', {
            conversationId: conversation.id,
            eventType: eventForEmit.type,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
    runtime.on('usage', (usage: ConversationUsage) => {
      this.repo.updateConversationRuntimeState(conversation.id, {
        usageSize: usage.size,
        usageUsed: usage.used,
        usageRatio: usage.ratio,
        usageUpdatedAt: usage.updatedAt,
      });
      this.events.emit('conversation.usage', usage);
    });
    runtime.on('commands', (snapshot: ConversationCommands) => {
      this.commandSnapshots.set(conversation.id, snapshot);
      this.persistConversationCommands(conversation.id, snapshot);
      this.events.emit('conversation.commands', snapshot);
    });
    runtime.on('models', (snapshot: ConversationModels) => {
      this.modelSnapshots.set(conversation.id, snapshot);
      this.repo.updateConversationRuntimeState(conversation.id, {
        currentModelId: snapshot.currentModelId,
      });
      this.persistConversationModels(conversation.id, snapshot);
      this.events.emit('conversation.models', snapshot);
    });
    runtime.on('mode', (snapshot: ConversationMode) => {
      this.modeSnapshots.set(conversation.id, snapshot);
      this.repo.updateConversationRuntimeState(conversation.id, {
        sessionMode: snapshot.mode,
      });
      this.persistConversationMode(conversation.id, snapshot);
      this.events.emit('conversation.mode', snapshot);
    });
    runtime.on('permission', (request) => this.events.emit('conversation.permission', request));
    runtime.on('status', (status, error) => {
      this.repo.updateConversationStatus(conversation.id, status);
      this.events.emit('conversation.status', { conversationId: conversation.id, status, error });
    });
    runtime.on('finish', (status) => {
      const event = { conversationId: conversation.id, status };
      this.events.emit('conversation.finish', event);
      for (const handler of this.finishHandlers) {
        Promise.resolve(handler(event)).catch((error) => {
          this.logger.warn('finish_handler_failed', {
            conversationId: conversation.id,
            status,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
    this.runtimes.set(conversation.id, runtime);
    return runtime;
  }

  private resolveAttachments(ids: string[]): StoredAttachment[] {
    return this.attachmentsRepo?.listAttachments(ids) ?? [];
  }

  private withMessageAttachments(messages: ChatMessage[]): ChatMessage[] {
    if (!this.attachmentsRepo || messages.length === 0) return messages;
    const byMessageId = this.attachmentsRepo.listMessageAttachmentsForMessages(messages.map((item) => item.id));
    return messages.map((message) => ({
      ...message,
      attachments: byMessageId[message.id] ?? [],
    }));
  }

  /** 运行态缺失时结束持久化 running 状态，供重启后取消等兜底路径使用。 */
  private finalizeMissingRuntime(conversationId: string): void {
    const message = '运行时已丢失，当前轮次已停止';
    this.repo.finalizeStreamingMessages({ conversationId, stopReason: 'stopped' });
    this.repo.finalizeInterruptedConversation({
      conversationId,
      reason: 'runtime_missing',
      message,
    });
    this.events.emit('conversation.status', { conversationId, status: 'stopped', error: message });
  }

  /** 优先使用内存中的 MCP 配置；重启后从数据库快照恢复。 */
  private getConversationMcpServers(conversationId: string): ConversationMcpServer[] {
    const memory = this.mcpServers.get(conversationId);
    if (memory) return memory;

    if (typeof this.repo.listConversationMcpServers !== 'function') return [];

    const persisted = this.repo.listConversationMcpServers(conversationId);
    if (persisted.length) {
      this.mcpServers.set(conversationId, persisted);
    }
    return persisted;
  }

  /** 解析或创建工作区，生产路径使用 WorkspaceService。 */
  private resolveOrCreateWorkspace(workspaceId?: string): Workspace {
    if (this.workspaceService) {
      return this.workspaceService.resolveOrCreate({
        workspaceId,
        createTemporaryWhenMissing: true,
      });
    }

    if (workspaceId) return this.requireWorkspace(workspaceId);

    const now = Date.now();
    const id = createId();
    const workspace: Workspace = {
      id,
      name: '对话',
      path: path.join(this.dataDir, 'workspaces', id),
      kind: 'temporary',
      isTemporary: true,
      existsOnDisk: true,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.fallbackWorkspaces.set(id, workspace);
    return workspace;
  }

  /** 读取工作区，生产路径走 WorkspaceService，测试 fallback 走内存表。 */
  private requireWorkspace(workspaceId: string): Workspace {
    const workspace = this.workspaceService?.getRequired(workspaceId) ?? this.fallbackWorkspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return workspace;
  }

  /** 根据 conversation.workspaceId 解析真实工作区路径。 */
  private resolveConversationWorkspace(conversation: Conversation): Workspace {
    const withWorkspace = this.getConversationWithWorkspace(conversation.id);
    if (withWorkspace) return withWorkspace.workspace;
    return this.requireWorkspace(conversation.workspaceId);
  }

  /** 将持久化会话和工作区组合为列表摘要。 */
  private toConversationSummary(conversation: Conversation, workspace: Workspace): ConversationSummary {
    return {
      id: conversation.id,
      name: conversation.name,
      preview: '',
      status: conversation.status,
      backend: conversation.backend,
      model: conversation.currentModelId ?? conversation.model,
      workspace,
      lastStopReason: conversation.lastStopReason,
      lastError: conversation.lastError,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private getConversationWithWorkspace(conversationId: string): ConversationWithWorkspace | null {
    if (typeof this.repo.getConversationWithWorkspace !== 'function') return null;
    return this.repo.getConversationWithWorkspace(conversationId);
  }

  /** 持久化命令快照；测试替身缺少该方法时跳过。 */
  private persistConversationCommands(conversationId: string, snapshot: ConversationCommands): void {
    if (typeof this.repo.replaceConversationCommands !== 'function') return;
    this.repo.replaceConversationCommands(conversationId, snapshot.commands, snapshot.updatedAt);
  }

  /** 持久化模型快照；测试替身缺少该方法时跳过。 */
  private persistConversationModels(conversationId: string, snapshot: ConversationModels): void {
    if (typeof this.repo.replaceConversationModels !== 'function') return;
    this.repo.replaceConversationModels(conversationId, snapshot);
  }

  /** 持久化当前模式快照；测试替身缺少该方法时跳过。 */
  private persistConversationMode(conversationId: string, snapshot: ConversationMode): void {
    if (typeof this.repo.replaceConversationMode !== 'function') return;
    this.repo.replaceConversationMode(conversationId, snapshot);
  }
}

/** 写入结构化日志前截断过长的 prompt/log 文本。 */
function summarizeLogText(text: string, maxLength = 240): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

/** 将 runtime 状态转换为最近一轮 stop reason。 */
function normalizeStatusToStopReason(status?: string): StopReason {
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
  return 'done';
}
