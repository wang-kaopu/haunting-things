import type { Db } from './connection';

export function initializeSchema(db: Db): void {
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

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      url TEXT NOT NULL,
      sha256 TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      message_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (message_id, attachment_id)
    );

    CREATE TABLE IF NOT EXISTS mailbox_attachments (
      mailbox_message_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (mailbox_message_id, attachment_id)
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
  `);

  ensureColumn(db, 'conversations', 'model', 'TEXT');
  ensureColumn(db, 'teams', 'leader_slot_id', "TEXT NOT NULL DEFAULT 'leader'");
  ensureColumn(db, 'teams', 'agents', "TEXT NOT NULL DEFAULT '[]'");
  db.prepare("UPDATE teams SET leader_slot_id = 'leader' WHERE leader_slot_id IS NULL OR leader_slot_id = ''").run();
  db.prepare("UPDATE teams SET agents = '[]' WHERE agents IS NULL OR agents = '' OR agents = 'undefined'").run();
  ensureColumn(db, 'mailbox', 'summary', 'TEXT');
  ensureColumn(db, 'mailbox', 'read', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_conversation ON agent_events(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_turn ON agent_events(turn_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mailbox_unread ON mailbox(team_id, to_agent_id, read, created_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_kind ON attachments(kind);
    CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_attachment_id ON message_attachments(attachment_id);
    CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_message_id ON mailbox_attachments(mailbox_message_id);
    CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_attachment_id ON mailbox_attachments(attachment_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status, updated_at);
  `);
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}
