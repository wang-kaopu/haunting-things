import type { AgentEvent, ChatMessage, Conversation } from '../../shared/types';
import type { Db } from './connection';
import { rowToAgentEvent, rowToConversation, rowToMessage } from './mappers';

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

  updateConversationModel(id: string, model: string | undefined): void {
    this.db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(model ?? null, Date.now(), id);
  }

  updateConversationStatus(id: string, status: Conversation['status']): void {
    this.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  }

  listConversations(): Conversation[] {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as any[];
    return rows.map(rowToConversation);
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    return row ? rowToConversation(row) : null;
  }

  addMessage(message: ChatMessage): ChatMessage {
    this.db
      .prepare('INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(message.id, message.conversationId, message.role, message.content, message.status ?? null, message.createdAt);
    return message;
  }

  updateMessage(message: ChatMessage): void {
    this.db
      .prepare('UPDATE messages SET content = ?, status = ? WHERE id = ?')
      .run(message.content, message.status ?? null, message.id);
  }

  listMessages(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as any[];
    return rows.map(rowToMessage);
  }

  addAgentEvent(event: AgentEvent): AgentEvent {
    this.db
      .prepare(
        'INSERT INTO agent_events (id, conversation_id, turn_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(event.id, event.conversationId, event.turnId, event.type, JSON.stringify(event), event.at);
    return event;
  }

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
