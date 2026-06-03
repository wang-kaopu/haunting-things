import type {
  AcpSessionRestoreMethod,
  AcpSessionRestoreStatus,
  AcpAvailableCommand,
  AcpModelInfo,
  AgentEvent,
  ChatMessage,
  Conversation,
  ConversationCommands,
  ConversationWithWorkspace,
  ConversationMcpServer,
  ConversationMode,
  ConversationModels,
  StopReason,
} from '@shared/types';
import type { Db } from '@server/db/connection';
import { rowToAgentEvent, rowToConversation, rowToConversationWithWorkspace, rowToMessage } from '@server/db/mappers';

/** 负责会话、消息和 Agent 事件的持久化，是聊天流恢复的主仓库。 */
export class ConversationRepository {
  constructor(private readonly db: Db) {}

  /** 插入一条 conversation 记录。 */
  createConversation(conversation: Conversation): Conversation {
    this.db
      .prepare(
        `INSERT INTO conversations (
          id, backend, name, workspace_id, model, status,
          acp_session_id, session_mode, current_model_id,
          last_turn_id, last_stop_reason, last_error,
          usage_size, usage_used, usage_ratio, usage_updated_at,
          session_restore_status, session_restore_method,
          session_restore_error, session_restored_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        conversation.id,
        conversation.backend,
        conversation.name,
        conversation.workspaceId,
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
        conversation.sessionRestoreStatus ?? null,
        conversation.sessionRestoreMethod ?? null,
        conversation.sessionRestoreError ?? null,
        conversation.sessionRestoredAt ?? null,
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

  /** 持久化 ACP session 的恢复结果，便于 UI 展示和排查上下文恢复路径。 */
  updateConversationSessionRestoreState(
    id: string,
    patch: {
      acpSessionId: string;
      sessionRestoreStatus: AcpSessionRestoreStatus;
      sessionRestoreMethod: AcpSessionRestoreMethod;
      sessionRestoreError?: string;
      sessionRestoredAt: number;
    }
  ): Conversation | null {
    this.db
      .prepare(
        `UPDATE conversations
         SET acp_session_id = ?,
             session_restore_status = ?,
             session_restore_method = ?,
             session_restore_error = ?,
             session_restored_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.acpSessionId,
        patch.sessionRestoreStatus,
        patch.sessionRestoreMethod,
        patch.sessionRestoreError ?? null,
        patch.sessionRestoredAt,
        Date.now(),
        id
      );
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

  /** 按状态列出会话，用于应用启动时修复异常退出遗留的运行态。 */
  listConversationsByStatus(status: Conversation['status']): Conversation[] {
    const rows = this.db
      .prepare('SELECT * FROM conversations WHERE status = ? ORDER BY updated_at DESC')
      .all(status) as any[];
    return rows.map(rowToConversation);
  }

  /** 读取单个会话，用于发送前确认会话仍存在。 */
  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    return row ? rowToConversation(row) : null;
  }

  /** 读取带工作区详情的单个会话。 */
  getConversationWithWorkspace(id: string): ConversationWithWorkspace | null {
    const row = this.db.prepare(conversationWithWorkspaceSql('WHERE c.id = ?')).get(id) as any;
    return row ? rowToConversationWithWorkspace(row) : null;
  }

  /** 列出带工作区详情的会话，按最近更新时间优先。 */
  listConversationsWithWorkspace(): ConversationWithWorkspace[] {
    const rows = this.db.prepare(conversationWithWorkspaceSql('ORDER BY c.updated_at DESC')).all() as any[];
    return rows.map(rowToConversationWithWorkspace);
  }

  /** 切换会话工作区，并重置依赖 cwd 的 ACP session 状态。 */
  updateConversationWorkspace(input: { conversationId: string; workspaceId: string }): Conversation | null {
    this.db
      .prepare(
        `UPDATE conversations
         SET workspace_id = ?,
             acp_session_id = NULL,
             session_restore_status = NULL,
             session_restore_method = NULL,
             session_restore_error = NULL,
             session_restored_at = NULL,
             last_stop_reason = 'stopped',
             last_error = 'Workspace changed; ACP session was reset',
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.workspaceId, Date.now(), input.conversationId);
    return this.getConversation(input.conversationId);
  }

  /** 将异常退出的会话标记为已停止，并记录停止原因。 */
  finalizeInterruptedConversation(input: {
    conversationId: string;
    lastTurnId?: string;
    reason: 'app_restarted' | 'runtime_missing';
    message: string;
  }): void {
    const current = this.getConversation(input.conversationId);
    if (!current) return;

    this.db
      .prepare(
        `UPDATE conversations
         SET status = 'stopped',
             last_turn_id = ?,
             last_stop_reason = 'stopped',
             last_error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.lastTurnId ?? current.lastTurnId ?? null,
        `${input.message} (${input.reason})`,
        Date.now(),
        input.conversationId
      );
  }

  /** 结束仍处于 streaming 的消息，避免重启后 UI 继续显示未完成状态。 */
  finalizeStreamingMessages(input: { conversationId: string; stopReason: StopReason }): void {
    this.db
      .prepare(
        `UPDATE messages
         SET status = 'done',
             stop_reason = ?
         WHERE conversation_id = ?
           AND status = 'streaming'`
      )
      .run(input.stopReason, input.conversationId);
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

  /** 替换会话级 MCP server 快照，确保重启后工具环境可恢复。 */
  replaceConversationMcpServers(conversationId: string, servers: ConversationMcpServer[]): void {
    const now = Date.now();
    const replace = this.db.transaction((items: ConversationMcpServer[]) => {
      this.db.prepare('DELETE FROM conversation_mcp_server_args WHERE conversation_id = ?').run(conversationId);
      this.db.prepare('DELETE FROM conversation_mcp_server_env WHERE conversation_id = ?').run(conversationId);
      this.db.prepare('DELETE FROM conversation_mcp_servers WHERE conversation_id = ?').run(conversationId);

      const insertServer = this.db.prepare(
        `INSERT INTO conversation_mcp_servers (
          conversation_id, server_id, name, command, enabled, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const insertArg = this.db.prepare(
        `INSERT INTO conversation_mcp_server_args (
          conversation_id, server_id, arg_index, value
        ) VALUES (?, ?, ?, ?)`
      );
      const insertEnv = this.db.prepare(
        `INSERT INTO conversation_mcp_server_env (
          conversation_id, server_id, name, value
        ) VALUES (?, ?, ?, ?)`
      );

      items.forEach((server, index) => {
        const serverId = conversationMcpServerId(server, index);
        insertServer.run(
          conversationId,
          serverId,
          server.name,
          server.command,
          server.enabled === false ? 0 : 1,
          index,
          now
        );
        (server.args ?? []).forEach((arg, argIndex) => {
          insertArg.run(conversationId, serverId, argIndex, arg);
        });
        (server.env ?? []).forEach((env) => {
          insertEnv.run(conversationId, serverId, env.name, env.value);
        });
      });
    });

    replace(servers);
  }

  /** 读取会话级 MCP server 快照，按创建时顺序还原。 */
  listConversationMcpServers(conversationId: string): ConversationMcpServer[] {
    const servers = this.db
      .prepare(
        `SELECT *
         FROM conversation_mcp_servers
         WHERE conversation_id = ?
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all(conversationId) as Array<{
        server_id: string;
        name: string;
        command: string;
        enabled: number;
      }>;

    return servers.map((server) => {
      const args = this.db
        .prepare(
          `SELECT value
           FROM conversation_mcp_server_args
           WHERE conversation_id = ?
             AND server_id = ?
           ORDER BY arg_index ASC`
        )
        .all(conversationId, server.server_id) as Array<{ value: string }>;
      const env = this.db
        .prepare(
          `SELECT name, value
           FROM conversation_mcp_server_env
           WHERE conversation_id = ?
             AND server_id = ?
           ORDER BY name ASC`
        )
        .all(conversationId, server.server_id) as Array<{ name: string; value: string }>;

      return {
        id: server.server_id,
        name: server.name,
        command: server.command,
        enabled: server.enabled !== 0,
        args: args.map((item) => item.value),
        env,
      };
    });
  }

  /** 替换可用命令快照，供重启后在 runtime 启动前恢复 UI 下拉内容。 */
  replaceConversationCommands(conversationId: string, commands: AcpAvailableCommand[], updatedAt: number): void {
    const replace = this.db.transaction((items: AcpAvailableCommand[]) => {
      this.db.prepare('DELETE FROM conversation_commands WHERE conversation_id = ?').run(conversationId);
      const insert = this.db.prepare(
        `INSERT INTO conversation_commands (
          conversation_id, name, description, input_schema, updated_at
        ) VALUES (?, ?, ?, ?, ?)`
      );
      items.forEach((command) => {
        insert.run(
          conversationId,
          command.name,
          command.description ?? null,
          command.input == null ? null : JSON.stringify(command.input),
          updatedAt
        );
      });
    });

    replace(commands);
  }

  /** 读取持久化命令快照。 */
  getConversationCommands(conversationId: string): ConversationCommands | null {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM conversation_commands
         WHERE conversation_id = ?
         ORDER BY name ASC`
      )
      .all(conversationId) as Array<{
        name: string;
        description: string | null;
        input_schema: string | null;
        updated_at: number;
      }>;

    if (rows.length === 0) return null;

    return {
      conversationId,
      commands: rows.map((row) => ({
        name: row.name,
        description: row.description ?? undefined,
        input: parseJsonValue(row.input_schema),
      })),
      updatedAt: Math.max(...rows.map((row) => row.updated_at)),
    };
  }

  /** 替换模型列表快照，并标记当前模型。 */
  replaceConversationModels(conversationId: string, snapshot: ConversationModels): void {
    const replace = this.db.transaction((models: AcpModelInfo[]) => {
      this.db.prepare('DELETE FROM conversation_models WHERE conversation_id = ?').run(conversationId);
      const insert = this.db.prepare(
        `INSERT INTO conversation_models (
          conversation_id, model_id, name, description, is_current, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );
      const ids = new Set(models.map((model) => model.id));
      const rows = snapshot.currentModelId && !ids.has(snapshot.currentModelId)
        ? [{ id: snapshot.currentModelId }, ...models]
        : models;

      rows.forEach((model) => {
        insert.run(
          conversationId,
          model.id,
          model.name ?? null,
          model.description ?? null,
          model.id === snapshot.currentModelId ? 1 : 0,
          snapshot.updatedAt
        );
      });
    });

    replace(snapshot.models);
  }

  /** 读取持久化模型列表快照。 */
  getConversationModels(conversationId: string): ConversationModels | null {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM conversation_models
         WHERE conversation_id = ?
         ORDER BY is_current DESC, model_id ASC`
      )
      .all(conversationId) as Array<{
        model_id: string;
        name: string | null;
        description: string | null;
        is_current: number;
        updated_at: number;
      }>;

    if (rows.length === 0) return null;

    return {
      conversationId,
      currentModelId: rows.find((row) => row.is_current === 1)?.model_id,
      models: rows.map((row) => ({
        id: row.model_id,
        name: row.name ?? undefined,
        description: row.description ?? undefined,
      })),
      updatedAt: Math.max(...rows.map((row) => row.updated_at)),
    };
  }

  /** 替换当前 mode 快照；当前协议只暴露活跃 mode，不持久化完整 mode 列表。 */
  replaceConversationMode(conversationId: string, snapshot: ConversationMode): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_modes WHERE conversation_id = ?').run(conversationId);
      this.db
        .prepare(
          `INSERT INTO conversation_modes (
            conversation_id, mode_id, is_current, updated_at
          ) VALUES (?, ?, 1, ?)`
        )
        .run(conversationId, snapshot.mode, snapshot.updatedAt);
    })();
  }

  /** 读取持久化当前 mode 快照。 */
  getConversationMode(conversationId: string): ConversationMode | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM conversation_modes
         WHERE conversation_id = ?
           AND is_current = 1
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(conversationId) as { mode_id: string; updated_at: number } | undefined;

    if (!row) return null;

    return {
      conversationId,
      mode: row.mode_id,
      updatedAt: row.updated_at,
    };
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

/** 生成会话内唯一的 MCP server id，未显式提供时使用名称和顺序兜底。 */
function conversationMcpServerId(server: ConversationMcpServer, index: number): string {
  return server.id?.trim() || `${server.name.trim() || 'server'}-${index + 1}`;
}

/** 解析动态命令输入 schema，旧数据损坏时返回 null 避免启动失败。 */
function parseJsonValue(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export type ConversationRepositoryPort = Pick<
  ConversationRepository,
  | 'createConversation'
  | 'updateConversationModel'
  | 'updateConversationStatus'
  | 'updateConversationAcpSession'
  | 'updateConversationSessionRestoreState'
  | 'updateConversationRuntimeState'
  | 'updateConversationTurnResult'
  | 'listConversations'
  | 'listConversationsByStatus'
  | 'getConversation'
  | 'getConversationWithWorkspace'
  | 'listConversationsWithWorkspace'
  | 'updateConversationWorkspace'
  | 'finalizeInterruptedConversation'
  | 'finalizeStreamingMessages'
  | 'addMessage'
  | 'updateMessage'
  | 'listMessages'
  | 'messageExists'
  | 'addAgentEvent'
  | 'listAgentEvents'
  | 'replaceConversationMcpServers'
  | 'listConversationMcpServers'
  | 'replaceConversationCommands'
  | 'getConversationCommands'
  | 'replaceConversationModels'
  | 'getConversationModels'
  | 'replaceConversationMode'
  | 'getConversationMode'
>;

/** 构造会话与工作区 join 查询，避免多个读取方法重复列清单。 */
function conversationWithWorkspaceSql(tail: string): string {
  return `
    SELECT
      c.*,
      w.id AS workspace__id,
      w.name AS workspace__name,
      w.path AS workspace__path,
      w.kind AS workspace__kind,
      w.is_temporary AS workspace__is_temporary,
      w.exists_on_disk AS workspace__exists_on_disk,
      w.last_opened_at AS workspace__last_opened_at,
      w.created_at AS workspace__created_at,
      w.updated_at AS workspace__updated_at
    FROM conversations c
    JOIN workspaces w ON w.id = c.workspace_id
    ${tail}
  `;
}
