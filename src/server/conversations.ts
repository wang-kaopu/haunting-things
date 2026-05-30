import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AgentBackend, ChatMessage, Conversation } from '../shared/types';
import type { Repository } from './db';
import type { EventBus } from './events';
import { AcpRuntime } from './acpRuntime';

/**
 * 管理所有 Conversation 的创建、消息收发和 ACP 运行时生命周期。
 *
 * 每个 Conversation 对应一个懒加载的 `AcpRuntime` 实例（首次 `sendMessage` 时启动）。
 * MCP 配置通过 `setMcpServers` 在启动前注入，启动后更新不会影响已有进程。
 *
 * 事件转发：`AcpRuntime` 的 message / permission / status / finish 事件
 * 经由 `EventBus` 广播给所有 WebSocket 客户端。
 */
export class ConversationService {
  /** conversationId → 运行时实例（懒加载）。 */
  private readonly runtimes = new Map<string, AcpRuntime>();
  /** conversationId → 待注入的 MCP server 配置列表。 */
  private readonly mcpServers = new Map<string, any[]>();
  /** 本地 finish 监听器，用于 Team 协作回流等服务内逻辑。 */
  private readonly finishHandlers = new Set<
    (event: { conversationId: string; status: Conversation['status'] }) => void | Promise<void>
  >();

  constructor(
    private readonly repo: Repository,
    private readonly events: EventBus,
    private readonly dataDir: string
  ) {}

  /**
   * 创建新 Conversation，自动初始化工作目录。
   *
   * @param input.backend    - Agent 后端类型（claude / codex）
   * @param input.workspace  - 工作目录；不传则在 dataDir/workspaces 下自动创建
   * @param input.name       - 显示名称，默认为 `<backend> conversation`
   * @param input.mcpServers - 可选的 MCP server 配置，会随 runtime 一同启动
   */
  create(input: { backend: AgentBackend; workspace?: string; name?: string; mcpServers?: any[] }): Conversation {
    const now = Date.now();
    const workspace = input.workspace?.trim() || path.join(this.dataDir, 'workspaces', crypto.randomUUID());
    mkdirSync(workspace, { recursive: true });
    const conversation = this.repo.createConversation({
      id: crypto.randomUUID(),
      backend: input.backend,
      name: input.name || `${input.backend} conversation`,
      workspace,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    });
    if (input.mcpServers) this.mcpServers.set(conversation.id, input.mcpServers);
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
    return this.repo.listMessages(conversationId);
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
   * 向指定 Conversation 发送用户消息。
   *
   * 消息先写库并 emit `conversation.stream`，再通过 `AcpRuntime.send` 触发 ACP prompt。
   * Runtime 的流式响应通过事件回调持续推送。
   */
  async sendMessage(input: { conversationId: string; content: string; files?: string[] }): Promise<void> {
    const conversation = this.repo.getConversation(input.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);

    const userMessage = this.repo.addMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      content: input.content,
      createdAt: Date.now(),
      status: 'done',
    });
    this.events.emit('conversation.stream', { conversationId: conversation.id, message: userMessage });

    const runtime = this.getRuntime(conversation);
    await runtime.send(input.content);
  }

  /**
   * 响应挂起的权限请求，转发给对应 runtime 的 `confirmPermission`。
   */
  confirmPermission(input: { conversationId: string; callId: string; optionId: string }): void {
    this.runtimes.get(input.conversationId)?.confirmPermission(input.callId, input.optionId);
  }

  /**
   * 停止指定 Conversation 的 ACP 进程并释放 runtime。
   */
  stop(conversationId: string): void {
    this.runtimes.get(conversationId)?.stop();
    this.runtimes.delete(conversationId);
  }

  /**
   * 让指定 Conversation 的 runtime 下次以最新 MCP 配置重新启动。
   * 当前实现采用 stop + delete，等待下一次 sendMessage 时重新构建 runtime。
   */
  restart(conversationId: string): void {
    this.stop(conversationId);
  }

  /**
   * 获取或创建指定 Conversation 的 `AcpRuntime`。
   *
   * 首次创建时注册四类事件转发：
   * - `message`    → `conversation.stream`（含数据库持久化）
   * - `permission` → `conversation.permission`
   * - `status`     → `conversation.status`（同步更新数据库）
   * - `finish`     → `conversation.finish`
   */
  private getRuntime(conversation: Conversation): AcpRuntime {
    const existing = this.runtimes.get(conversation.id);
    if (existing) return existing;

    const runtime = new AcpRuntime({
      conversationId: conversation.id,
      backend: conversation.backend,
      workspace: conversation.workspace,
      mcpServers: this.mcpServers.get(conversation.id),
    });
    runtime.on('message', (message) => {
      const known = this.repo.listMessages(message.conversationId).some((item) => item.id === message.id);
      if (known) this.repo.updateMessage(message);
      else this.repo.addMessage(message);
      this.events.emit('conversation.stream', { conversationId: conversation.id, message });
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
          console.warn(`[ConversationService] finish handler failed for ${conversation.id}:`, error);
        });
      }
    });
    this.runtimes.set(conversation.id, runtime);
    return runtime;
  }
}
