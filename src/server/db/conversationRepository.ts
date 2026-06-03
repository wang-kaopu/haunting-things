import type { AgentEvent, ChatMessage, Conversation, StopReason } from '../../shared/types';
import type { Db } from './connection';
import { rowToAgentEvent, rowToConversation, rowToMessage } from './mappers';

/** 负责会话、消息和 Agent 事件的持久化，是聊天流恢复的主仓库。 */
export class ConversationRepository {
  constructor(private readonly db: Db) {}

  /** 插入一条 conversation 记录。 */
  createConversation(conversation: Conversation): Conversation {
    this.db
      .prepare(
        `INSERT INTO conversations (
          id, backend, name, workspace, model, status,
          acp_session_id, session_mode, current_model_id,
          last_turn_id, last_stop_reason, last_error,
          usage_size, usage_used, usage_ratio, usage_updated_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        conversation.id,
        conversation.backend,
        conversation.name,
        conversation.workspace,
        conversation.model ?? null,
        conversation.status,
        conversation.acpSessionId ?? null,
        conversation.sessionMode ?? null,
        conversation.currentModelId ?? null,
        conversation.lastTurnId ?? null,
        conversation.lastStopReason ?? null,
        conversation.lastError ?? null,
        conversation.usageSize ?? null,
        conversation.usageUsed ?? null,
        conversation.usageRatio ?? null,
        conversation.usageUpdatedAt ?? null,
        conversation.createdAt,
        conversation.updatedAt
      );
    return conversation;
  }

  /** 更新会话当前模型，供前端模型选择和运行时状态保持一致。 */
  updateConversationModel(id: string, model: string | undefined): void {
    this.db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(model ?? null, Date.now(), id);
  }

  /** 更新会话运行状态，驱动侧边栏和聊天头部的状态展示。 */
  updateConversationStatus(id: string, status: Conversation['status']): void {
    this.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  }

  /** 持久化 ACP session id，便于会话运行态恢复和排查。 */
  updateConversationAcpSession(id: string, acpSessionId: string): Conversation | null {
    this.db
      .prepare('UPDATE conversations SET acp_session_id = ?, updated_at = ? WHERE id = ?')
      .run(acpSessionId, Date.now(), id);
    return this.getConversation(id);
  }

  /** 持久化模型、权限模式和 usage 等运行态快照。 */
  updateConversationRuntimeState(
    id: string,
    patch: {
      sessionMode?: string;
      currentModelId?: string;
      usageSize?: number;
      usageUsed?: number;
      usageRatio?: number;
      usageUpdatedAt?: number;
    }
  ): Conversation | null {
    const current = this.getConversation(id);
    if (!current) return null;

    this.db
      .prepare(
        `UPDATE conversations
         SET session_mode = ?,
             current_model_id = ?,
             usage_size = ?,
             usage_used = ?,
             usage_ratio = ?,
             usage_updated_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.sessionMode ?? current.sessionMode ?? null,
        patch.currentModelId ?? current.currentModelId ?? null,
        patch.usageSize ?? current.usageSize ?? null,
        patch.usageUsed ?? current.usageUsed ?? null,
        patch.usageRatio ?? current.usageRatio ?? null,
        patch.usageUpdatedAt ?? current.usageUpdatedAt ?? null,
        Date.now(),
        id
      );

    return this.getConversation(id);
  }

  /** 持久化最近一轮 turn 结果。 */
  updateConversationTurnResult(
    id: string,
    patch: {
      lastTurnId?: string;
      lastStopReason?: StopReason;
      lastError?: string;
    }
  ): Conversation | null {
    const current = this.getConversation(id);
    if (!current) return null;

    this.db
      .prepare(
        `UPDATE conversations
         SET last_turn_id = ?,
             last_stop_reason = ?,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.lastTurnId ?? current.lastTurnId ?? null,
        patch.lastStopReason ?? current.lastStopReason ?? null,
        patch.lastError ?? current.lastError ?? null,
        Date.now(),
        id
      );

    return this.getConversation(id);
  }

  /** 列出所有会话快照，按最近更新时间优先。 */
  listConversations(): Conversation[] {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as any[];
    return rows.map(rowToConversation);
  }

  /** 读取单个会话，用于发送前确认会话仍存在。 */
  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    return row ? rowToConversation(row) : null;
  }

  /** 追加聊天消息，流式 assistant 消息会先以空内容入库。 */
  addMessage(message: ChatMessage): ChatMessage {
    const sequence = this.nextMessageSequence(message.conversationId);
    this.db
      .prepare(
        `INSERT INTO messages (
          id, conversation_id, role, type, content, status,
          turn_id, source_event_id, stop_reason,
          tool_call_id, permission_call_id, parent_message_id,
          sequence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        message.type,
        message.content,
        message.status ?? null,
        message.turnId ?? null,
        message.sourceEventId ?? null,
        message.stopReason ?? null,
        message.toolCallId ?? null,
        message.permissionCallId ?? null,
        message.parentMessageId ?? null,
        sequence,
        message.createdAt
      );
    return { ...message, sequence };
  }

  /** 更新消息正文和状态，用于流式内容增量落库。 */
  updateMessage(message: ChatMessage): void {
    this.db
      .prepare(
        `UPDATE messages
         SET content = ?,
             status = ?,
             type = ?,
             turn_id = ?,
             source_event_id = ?,
             stop_reason = ?,
             tool_call_id = ?,
             permission_call_id = ?,
             parent_message_id = ?
         WHERE id = ?`
      )
      .run(
        message.content,
        message.status ?? null,
        message.type,
        message.turnId ?? null,
        message.sourceEventId ?? null,
        message.stopReason ?? null,
        message.toolCallId ?? null,
        message.permissionCallId ?? null,
        message.parentMessageId ?? null,
        message.id
      );
  }

  /** 读取会话消息历史，按创建顺序还原聊天记录。 */
  listMessages(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC, created_at ASC')
      .all(conversationId) as any[];
    return rows.map(rowToMessage);
  }

  /** 判断消息是否已经入库，避免流式更新反复扫描完整历史。 */
  messageExists(messageId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM messages WHERE id = ? LIMIT 1').get(messageId);
    return Boolean(row);
  }

  /** 记录 Agent 运行事件，用于思考/工具调用/错误等状态回放。 */
  addAgentEvent(event: AgentEvent): AgentEvent {
    const sequence = this.nextAgentEventSequence(event.conversationId);
    const normalized: AgentEvent = { ...event, sequence };
    this.db
      .prepare(
        `INSERT INTO agent_events (
          id, conversation_id, turn_id, type,
          status, stop_reason, tool_call_id, permission_call_id, message_id,
          sequence, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        normalized.id,
        normalized.conversationId,
        normalized.turnId,
        normalized.type,
        normalized.status ?? null,
        normalized.stopReason ?? null,
        normalized.toolCallId ?? null,
        normalized.permissionCallId ?? null,
        normalized.messageId ?? null,
        sequence,
        JSON.stringify(normalized),
        normalized.at
      );
    return normalized;
  }

  /** 读取最近的 Agent 事件，并限制数量避免前端初始化负载过大。 */
  listAgentEvents(conversationId: string, limit = 200): AgentEvent[] {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);

    const rows = this.db
      .prepare(
        `SELECT *
        FROM agent_events
        WHERE conversation_id = ?
        ORDER BY sequence DESC, created_at DESC
        LIMIT ?`
      )
      .all(conversationId, safeLimit) as any[];

    return rows.reverse().map(rowToAgentEvent);
  }

  private nextMessageSequence(conversationId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { next: number };
    return row.next;
  }

  private nextAgentEventSequence(conversationId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM agent_events WHERE conversation_id = ?')
      .get(conversationId) as { next: number };
    return row.next;
  }
}

export type ConversationRepositoryPort = Pick<
  ConversationRepository,
  | 'createConversation'
  | 'updateConversationModel'
  | 'updateConversationStatus'
  | 'updateConversationAcpSession'
  | 'updateConversationRuntimeState'
  | 'updateConversationTurnResult'
  | 'listConversations'
  | 'getConversation'
  | 'addMessage'
  | 'updateMessage'
  | 'listMessages'
  | 'messageExists'
  | 'addAgentEvent'
  | 'listAgentEvents'
>;
