import type { Db } from '@server/db/connection';

/**
 * 初始化并迁移应用数据库 schema。
 *
 * 当前 workspace_id 方案不兼容旧 workspace TEXT schema，检测到旧列时直接失败。
 */
export function initializeSchema(db: Db): void {
  assertNoLegacyWorkspaceSchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      is_temporary INTEGER NOT NULL DEFAULT 0,
      exists_on_disk INTEGER NOT NULL DEFAULT 1,
      last_opened_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

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
      workspace_id TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL,
      acp_session_id TEXT,
      session_mode TEXT,
      current_model_id TEXT,
      last_turn_id TEXT,
      last_stop_reason TEXT,
      last_error TEXT,
      usage_size INTEGER,
      usage_used INTEGER,
      usage_ratio REAL,
      usage_updated_at INTEGER,
      session_restore_status TEXT,
      session_restore_method TEXT,
      session_restore_error TEXT,
      session_restored_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT,
      turn_id TEXT,
      source_event_id TEXT,
      stop_reason TEXT,
      tool_call_id TEXT,
      permission_call_id TEXT,
      parent_message_id TEXT,
      sequence INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT,
      stop_reason TEXT,
      tool_call_id TEXT,
      permission_call_id TEXT,
      message_id TEXT,
      sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      leader_slot_id TEXT NOT NULL,
      agents TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
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

    CREATE TABLE IF NOT EXISTS conversation_mcp_servers (
      conversation_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, server_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_mcp_server_args (
      conversation_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      arg_index INTEGER NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (conversation_id, server_id, arg_index),
      FOREIGN KEY (conversation_id, server_id) REFERENCES conversation_mcp_servers(conversation_id, server_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_mcp_server_env (
      conversation_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (conversation_id, server_id, name),
      FOREIGN KEY (conversation_id, server_id) REFERENCES conversation_mcp_servers(conversation_id, server_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_commands (
      conversation_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      input_schema TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, name),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_models (
      conversation_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      name TEXT,
      description TEXT,
      is_current INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, model_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_modes (
      conversation_id TEXT NOT NULL,
      mode_id TEXT NOT NULL,
      name TEXT,
      description TEXT,
      is_current INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, mode_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  ensureColumn(db, 'conversations', 'session_restore_status', 'TEXT');
  ensureColumn(db, 'conversations', 'session_restore_method', 'TEXT');
  ensureColumn(db, 'conversations', 'session_restore_error', 'TEXT');
  ensureColumn(db, 'conversations', 'session_restored_at', 'INTEGER');
  ensureColumn(db, 'teams', 'leader_slot_id', "TEXT NOT NULL DEFAULT 'leader'");
  ensureColumn(db, 'teams', 'agents', "TEXT NOT NULL DEFAULT '[]'");
  db.prepare("UPDATE teams SET leader_slot_id = 'leader' WHERE leader_slot_id IS NULL OR leader_slot_id = ''").run();
  db.prepare("UPDATE teams SET agents = '[]' WHERE agents IS NULL OR agents = '' OR agents = 'undefined'").run();
  ensureColumn(db, 'mailbox', 'summary', 'TEXT');
  ensureColumn(db, 'mailbox', 'read', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_acp_session_id ON conversations(acp_session_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_last_turn_id ON conversations(last_turn_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_session_restore ON conversations(session_restore_status, session_restored_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence ON messages(conversation_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_messages_turn_id ON messages(turn_id);
    CREATE INDEX IF NOT EXISTS idx_messages_source_event_id ON messages(source_event_id);
    CREATE INDEX IF NOT EXISTS idx_messages_tool_call_id ON messages(tool_call_id);
    CREATE INDEX IF NOT EXISTS idx_messages_permission_call_id ON messages(permission_call_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_conversation ON agent_events(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_conversation_sequence ON agent_events(conversation_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_agent_events_turn ON agent_events(turn_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_turn_id ON agent_events(turn_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(type, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_stop_reason ON agent_events(stop_reason);
    CREATE INDEX IF NOT EXISTS idx_mailbox_unread ON mailbox(team_id, to_agent_id, read, created_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_kind ON attachments(kind);
    CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_attachment_id ON message_attachments(attachment_id);
    CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_message_id ON mailbox_attachments(mailbox_message_id);
    CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_attachment_id ON mailbox_attachments(attachment_id);
    CREATE INDEX IF NOT EXISTS idx_workspaces_kind_updated ON workspaces(kind, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened ON workspaces(last_opened_at);
    CREATE INDEX IF NOT EXISTS idx_workspaces_path ON workspaces(path);
    CREATE INDEX IF NOT EXISTS idx_teams_workspace_id ON teams(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_mcp_servers_conversation ON conversation_mcp_servers(conversation_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_conversation_commands_conversation ON conversation_commands(conversation_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_models_conversation ON conversation_models(conversation_id, is_current, updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_modes_conversation ON conversation_modes(conversation_id, is_current, updated_at);
  `);
}

/**
 * 当前分支不支持旧 workspace TEXT schema 自动迁移。
 *
 * 旧库需要由开发者删除后重新初始化，避免把旧路径数据静默回填成新工作区实体。
 */
function assertNoLegacyWorkspaceSchema(db: Db): void {
  const conversationColumns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>;
  const teamColumns = db.prepare('PRAGMA table_info(teams)').all() as Array<{ name: string }>;
  const hasLegacyConversationWorkspace = conversationColumns.some((column) => column.name === 'workspace');
  const hasLegacyTeamWorkspace = teamColumns.some((column) => column.name === 'workspace');

  if (!hasLegacyConversationWorkspace && !hasLegacyTeamWorkspace) return;

  throw new Error(
    [
      'Incompatible database schema: legacy workspace TEXT column detected.',
      'This branch does not support workspace schema migration.',
      'Delete the local database and restart the app.',
    ].join(' ')
  );
}

/** 在迁移过程中确保指定列存在，不存在时追加列定义。 */
function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}
