import type { AgentEvent, ChatMessage, Conversation } from '../../shared/types';
import type { Db } from './connection';
import { rowToAgentEvent, rowToConversation, rowToMessage } from './mappers';

/** 负责会话、消息和 Agent 事件的持久化，是聊天流恢复的主仓库。 */
export class ConversationRepository {
  constructor(private readonly db: Db) {}

  /** 插入一条 conversation 记录。 */
  createConversation(conversation: Conversation): Conversation {
    this.db
      .prepare(
        'INSERT INTO conversations (id, backend, name, workspace, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        conversation.id,
        conversation.backend,
        conversation.name,
        conversation.workspace,
        conversation.model ?? null,
        conversation.status,
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
    this.db
      .prepare('INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(message.id, message.conversationId, message.role, message.content, message.status ?? null, message.createdAt);
    return message;
  }

  /** 更新消息正文和状态，用于流式内容增量落库。 */
  updateMessage(message: ChatMessage): void {
    this.db
      .prepare('UPDATE messages SET content = ?, status = ? WHERE id = ?')
      .run(message.content, message.status ?? null, message.id);
  }

  /** 读取会话消息历史，按创建顺序还原聊天记录。 */
  listMessages(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as any[];
    return rows.map(rowToMessage);
  }

  /** 记录 Agent 运行事件，用于思考/工具调用/错误等状态回放。 */
  addAgentEvent(event: AgentEvent): AgentEvent {
    this.db
      .prepare(
        'INSERT INTO agent_events (id, conversation_id, turn_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(event.id, event.conversationId, event.turnId, event.type, JSON.stringify(event), event.at);
    return event;
  }

  /** 读取最近的 Agent 事件，并限制数量避免前端初始化负载过大。 */
  listAgentEvents(conversationId: string, limit = 200): AgentEvent[] {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);

    const rows = this.db
      .prepare(
        `SELECT payload FROM agent_events
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
      )
      .all(conversationId, safeLimit) as Array<{ payload: string }>;

    return rows.reverse().map(rowToAgentEvent);
  }
}

export type ConversationRepositoryPort = Pick<
  ConversationRepository,
  | 'createConversation'
  | 'updateConversationModel'
  | 'updateConversationStatus'
  | 'listConversations'
  | 'getConversation'
  | 'addMessage'
  | 'updateMessage'
  | 'listMessages'
  | 'addAgentEvent'
  | 'listAgentEvents'
>;
