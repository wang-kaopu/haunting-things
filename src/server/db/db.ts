import Database from 'better-sqlite3';
import type { AgentEvent, ChatMessage, Conversation, MailboxMessage, Team, TeamTask, User } from '../../shared/types';
import { initializeSchema } from './schema';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);
  return db;
}

export class Repository {
  constructor(private readonly db: Db) {}

  getUserByUsername(username: string): (User & { passwordHash: string; jwtSecret: string }) | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, jwt_secret FROM users WHERE username = ?')
      .get(username) as { id: string; username: string; password_hash: string; jwt_secret: string } | undefined;
    return row
      ? { id: row.id, username: row.username, passwordHash: row.password_hash, jwtSecret: row.jwt_secret }
      : null;
  }

  /** 获取首个用户，用于单管理员初始化和密码流程。 */
  getAnyUser(): (User & { passwordHash: string; jwtSecret: string }) | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, jwt_secret FROM users ORDER BY created_at ASC LIMIT 1')
      .get() as { id: string; username: string; password_hash: string; jwt_secret: string } | undefined;
    return row
      ? { id: row.id, username: row.username, passwordHash: row.password_hash, jwtSecret: row.jwt_secret }
      : null;
  }

  /** 持久化新用户，并返回公开字段。 */
  createUser(input: { id: string; username: string; passwordHash: string; jwtSecret: string }): User {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, jwt_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(input.id, input.username, input.passwordHash, input.jwtSecret, now, now);
    return { id: input.id, username: input.username };
  }

  /** 认证成功后更新最近登录元数据。 */
  updateLastLogin(userId: string): void {
    this.db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), userId);
  }

  /** 替换用户密码哈希和 JWT secret，使旧 token 失效。 */
  updatePassword(userId: string, passwordHash: string, jwtSecret: string): void {
    this.db
      .prepare('UPDATE users SET password_hash = ?, jwt_secret = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, jwtSecret, Date.now(), userId);
  }

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

  createTeam(team: Team): Team {
    this.db
      .prepare(
        'INSERT INTO teams (id, name, workspace, leader_slot_id, agents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(team.id, team.name, team.workspace, team.leaderSlotId, JSON.stringify(team.agents), team.createdAt, team.updatedAt);
    return team;
  }

  updateTeam(team: Team): void {
    this.db
      .prepare('UPDATE teams SET name = ?, workspace = ?, leader_slot_id = ?, agents = ?, updated_at = ? WHERE id = ?')
      .run(team.name, team.workspace, team.leaderSlotId, JSON.stringify(team.agents), Date.now(), team.id);
  }

  getTeam(id: string): Team | null {
    const row = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as any;
    return row ? rowToTeam(row) : null;
  }

  listTeams(): Team[] {
    const rows = this.db.prepare('SELECT * FROM teams ORDER BY updated_at DESC').all() as any[];
    return rows.map(rowToTeam);
  }

  deleteTeam(id: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }

  writeMailbox(message: MailboxMessage): MailboxMessage {
    this.db
      .prepare(
        'INSERT INTO mailbox (id, team_id, to_agent_id, from_agent_id, content, summary, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        message.id,
        message.teamId,
        message.toAgentId,
        message.fromAgentId,
        message.content,
        message.summary ?? null,
        message.read ? 1 : 0,
        message.createdAt
      );
    return message;
  }

  readUnreadAndMark(teamId: string, toAgentId: string): MailboxMessage[] {
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT * FROM mailbox WHERE team_id = ? AND to_agent_id = ? AND read = 0 ORDER BY created_at ASC')
        .all(teamId, toAgentId) as any[];
      this.db.prepare('UPDATE mailbox SET read = 1 WHERE team_id = ? AND to_agent_id = ? AND read = 0').run(teamId, toAgentId);
      return rows.map(rowToMailbox);
    });
    return tx();
  }

  listUnreadMailbox(teamId: string, toAgentId: string): MailboxMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM mailbox WHERE team_id = ? AND to_agent_id = ? AND read = 0 ORDER BY created_at ASC')
      .all(teamId, toAgentId) as any[];
    return rows.map(rowToMailbox);
  }

  listMailbox(teamId: string): MailboxMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM mailbox WHERE team_id = ? ORDER BY created_at ASC')
      .all(teamId) as any[];
    return rows.map(rowToMailbox);
  }

  createTask(task: TeamTask): TeamTask {
    this.db
      .prepare(
        'INSERT INTO tasks (id, team_id, title, description, status, created_by_slot_id, assigned_slot_id, completed_by_slot_id, completion_summary, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        task.id,
        task.teamId,
        task.title,
        task.description ?? null,
        task.status,
        task.createdBySlotId ?? null,
        task.assignedSlotId ?? null,
        task.completedBySlotId ?? null,
        task.completionSummary ?? null,
        task.createdAt,
        task.updatedAt,
        task.completedAt ?? null
      );
    return task;
  }

  /** 更新任务可变字段，包括完成相关元数据。 */
  updateTask(task: TeamTask): void {
    this.db
      .prepare(
        'UPDATE tasks SET title = ?, description = ?, status = ?, created_by_slot_id = ?, assigned_slot_id = ?, completed_by_slot_id = ?, completion_summary = ?, updated_at = ?, completed_at = ? WHERE id = ?'
      )
      .run(
        task.title,
        task.description ?? null,
        task.status,
        task.createdBySlotId ?? null,
        task.assignedSlotId ?? null,
        task.completedBySlotId ?? null,
        task.completionSummary ?? null,
        task.updatedAt,
        task.completedAt ?? null,
        task.id
      );
  }

  getTask(id: string): TeamTask | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    return row ? rowToTask(row) : null;
  }

  listTasks(teamId: string): TeamTask[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE team_id = ? ORDER BY updated_at DESC').all(teamId) as any[];
    return rows.map(rowToTask);
  }
}

function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    backend: row.backend,
    name: row.name,
    workspace: row.workspace,
    model: row.model ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 将 `messages` 表行映射为共享领域类型。 */
function rowToMessage(row: any): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    status: row.status ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToAgentEvent(row: any): AgentEvent {
  return JSON.parse(row.payload) as AgentEvent;
}

function rowToTeam(row: any): Team {
  return {
    id: row.id,
    name: row.name,
    workspace: row.workspace,
    leaderSlotId: row.leader_slot_id,
    agents: parseTeamAgents(row.agents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseTeamAgents(value: unknown): Team['agents'] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Team['agents']) : [];
  } catch {
    return [];
  }
}

function rowToMailbox(row: any): MailboxMessage {
  return {
    id: row.id,
    teamId: row.team_id,
    toAgentId: row.to_agent_id,
    fromAgentId: row.from_agent_id,
    content: row.content,
    summary: row.summary ?? undefined,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

function rowToTask(row: any): TeamTask {
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    createdBySlotId: row.created_by_slot_id ?? undefined,
    assignedSlotId: row.assigned_slot_id ?? undefined,
    completedBySlotId: row.completed_by_slot_id ?? undefined,
    completionSummary: row.completion_summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}
