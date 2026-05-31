import Database from 'better-sqlite3';
import type { AgentEvent, ChatMessage, Conversation, MailboxMessage, Team, TeamTask, User } from '../shared/types';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      jwt_secret TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login INTEGER
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      backend TEXT NOT NULL,
      name TEXT NOT NULL,
      workspace TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace TEXT NOT NULL,
      leader_slot_id TEXT NOT NULL,
      agents TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mailbox (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      from_agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      created_by_slot_id TEXT,
      assigned_slot_id TEXT,
      completed_by_slot_id TEXT,
      completion_summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_conversation ON agent_events(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_turn ON agent_events(turn_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mailbox_unread ON mailbox(team_id, to_agent_id, read, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status, updated_at);
  `);
  ensureColumn(db, 'conversations', 'model', 'TEXT');
  return db;
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
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

  getAnyUser(): (User & { passwordHash: string; jwtSecret: string }) | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, jwt_secret FROM users ORDER BY created_at ASC LIMIT 1')
      .get() as { id: string; username: string; password_hash: string; jwt_secret: string } | undefined;
    return row
      ? { id: row.id, username: row.username, passwordHash: row.password_hash, jwtSecret: row.jwt_secret }
      : null;
  }

  createUser(input: { id: string; username: string; passwordHash: string; jwtSecret: string }): User {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, jwt_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(input.id, input.username, input.passwordHash, input.jwtSecret, now, now);
    return { id: input.id, username: input.username };
  }

  updateLastLogin(userId: string): void {
    this.db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), userId);
  }

  updatePassword(userId: string, passwordHash: string, jwtSecret: string): void {
    this.db
      .prepare('UPDATE users SET password_hash = ?, jwt_secret = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, jwtSecret, Date.now(), userId);
  }

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

  listAgentEvents(conversationId: string): AgentEvent[] {
    const rows = this.db
      .prepare('SELECT payload FROM agent_events WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as Array<{ payload: string }>;
    return rows.map(rowToAgentEvent);
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
    agents: JSON.parse(row.agents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
