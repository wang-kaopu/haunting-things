import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentBackend,
  AgentEvent,
  ChatMessage,
  Conversation,
  ConversationCommands,
  ConversationModels,
  ConversationMode,
  ConversationUsage,
  PermissionResponse,
  StoredAttachment,
} from '../../shared/types';
import { classifyAgentEvent } from '../agentEventPolicy';
import type { AttachmentRepositoryPort } from '../db/attachmentRepository';
import type { ConversationRepositoryPort } from '../db/conversationRepository';
import { toAttachmentRef } from '../db/mappers';
import type { EventBus } from '../events';
import { createId } from '../id';
import { createLogger } from '../utils/logger';
import type { AttachmentService } from './attachmentService';
import { AcpRuntime } from '../runtime/acpRuntime';

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
  /** 以 `conversationId` 映射运行时实例（懒加载）。 */
  private readonly runtimes = new Map<string, AcpRuntime>();
  /** 以 `conversationId` 映射待注入的 MCP server 配置列表。 */
  private readonly mcpServers = new Map<string, any[]>();
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
    private readonly attachmentsRepo?: AttachmentRepositoryPort,
    private readonly attachmentService?: AttachmentService
  ) {}

  /**
   * 创建新 Conversation，自动初始化工作目录。
   *
   * @param input.backend    - Agent 后端类型（claude / codex）
   * @param input.workspace  - 工作目录；不传则在 dataDir/workspaces 下自动创建
   * @param input.name       - 显示名称，默认为 `<backend> conversation`
   * @param input.mcpServers - 可选的 MCP server 配置，会随 runtime 一同启动
   */
  create(input: {
    backend: AgentBackend;
    workspace?: string;
    name?: string;
    model?: string;
    mcpServers?: any[];
  }): Conversation {
    const now = Date.now();
    const workspace = input.workspace?.trim() || path.join(this.dataDir, 'workspaces', createId());
    mkdirSync(workspace, { recursive: true });
    const conversation = this.repo.createConversation({
      id: createId(),
      backend: input.backend,
      name: input.name || `${input.backend} conversation`,
      workspace,
      model: input.model?.trim() || undefined,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    });
    if (input.mcpServers) this.mcpServers.set(conversation.id, input.mcpServers);
    this.logger.info('conversation_create', {
      conversationId: conversation.id,
      backend: conversation.backend,
      model: conversation.model,
      workspace: conversation.workspace,
      hasMcpServers: Boolean(input.mcpServers?.length),
    });
    return conversation;
  }

  /**
   * 更新指定 Conversation 的 MCP server 配置。
   * 仅在 runtime 尚未启动时有效；已启动的 runtime 不会重新加载配置。
   */
  setMcpServers(conversationId: string, mcpServers: any[]): void {
    this.mcpServers.set(conversationId, mcpServers);
  }

  /** 返回所有 Conversation 列表。 */
  list(): Conversation[] {
    return this.repo.listConversations();
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
    return this.commandSnapshots.get(conversationId) ?? null;
  }

  /** 返回指定 Conversation 的模型快照。 */
  models(conversationId: string): ConversationModels | null {
    return this.modelSnapshots.get(conversationId) ?? null;
  }

  /** 返回指定 Conversation 的模式快照。 */
  mode(conversationId: string): ConversationMode | null {
    return this.modeSnapshots.get(conversationId) ?? null;
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
      content: input.content,
      createdAt: Date.now(),
      status: 'done',
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
      await runtime.send(attachments.length > 0 ? { text: input.content, attachments } : input.content);
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
    if (visibleMessage || attachments.length > 0) {
      const userMessage = this.repo.addMessage({
        id: createId(),
        conversationId: conversation.id,
        role: 'user',
        content: visibleMessage ?? '',
        createdAt: Date.now(),
        status: 'done',
      });
      this.attachmentsRepo?.linkMessageAttachments(
        userMessage.id,
        attachments.map((item) => item.id)
      );
      this.events.emit('conversation.stream', {
        conversationId: conversation.id,
        message: { ...userMessage, attachments: attachments.map(toAttachmentRef) },
      });
    }

    try {
      const runtime = this.getRuntime(conversation);
      await runtime.send(attachments.length > 0 ? { text: input.prompt, attachments } : input.prompt);
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

  async deleteMessage(input: { messageId: string }): Promise<{ deleted: true }> {
    const attachments = this.attachmentsRepo?.deleteMessage(input.messageId) ?? [];
    await this.attachmentService?.deleteStoredFiles(attachments);
    return { deleted: true };
  }

  async deleteMessageAttachment(input: { messageId: string; attachmentId: string }): Promise<{ deleted: true }> {
    const attachments = this.attachmentsRepo?.deleteMessageAttachment(input.messageId, input.attachmentId) ?? [];
    await this.attachmentService?.deleteStoredFiles(attachments);
    return { deleted: true };
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
    this.restart(conversation.id);
    const now = Date.now();
    this.commandSnapshots.delete(conversation.id);
    this.modelSnapshots.delete(conversation.id);
    this.modeSnapshots.delete(conversation.id);

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

  /** 切换指定 Conversation 当前运行时的权限模式，不持久化到数据库。 */
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

    this.logger.info('runtime_create', {
      conversationId: conversation.id,
      backend: conversation.backend,
      model: conversation.model,
      workspace: conversation.workspace,
      mcpServerCount: this.mcpServers.get(conversation.id)?.length ?? 0,
    });
    const runtime = new AcpRuntime({
      conversationId: conversation.id,
      backend: conversation.backend,
      workspace: conversation.workspace,
      model: conversation.model,
      mcpServers: this.mcpServers.get(conversation.id),
    });
    runtime.on('message', (message) => {
      const known = this.repo.listMessages(message.conversationId).some((item) => item.id === message.id);
      if (known) this.repo.updateMessage(message);
      else this.repo.addMessage(message);
      this.events.emit('conversation.stream', { conversationId: conversation.id, message });
    });
    runtime.on('agentEvent', (event: AgentEvent) => {
      const policy = classifyAgentEvent(event);

      if (policy.persist) {
        this.repo.addAgentEvent(event);
      }

      if (policy.realtime) {
        this.events.emit('conversation.agentEvent', event);
      }

      for (const handler of this.agentEventHandlers) {
        Promise.resolve(handler(event)).catch((error) => {
          this.logger.warn('agent_event_handler_failed', {
            conversationId: conversation.id,
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
    runtime.on('usage', (usage: ConversationUsage) => {
      this.events.emit('conversation.usage', usage);
    });
    runtime.on('commands', (snapshot: ConversationCommands) => {
      this.commandSnapshots.set(conversation.id, snapshot);
      this.events.emit('conversation.commands', snapshot);
    });
    runtime.on('models', (snapshot: ConversationModels) => {
      this.modelSnapshots.set(conversation.id, snapshot);
      this.events.emit('conversation.models', snapshot);
    });
    runtime.on('mode', (snapshot: ConversationMode) => {
      this.modeSnapshots.set(conversation.id, snapshot);
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
}

/** 写入结构化日志前截断过长的 prompt/log 文本。 */
function summarizeLogText(text: string, maxLength = 240): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}
