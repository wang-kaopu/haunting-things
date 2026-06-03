# `haunting-things` 对话记忆改造编码方案

## 0. 当前基础判断

`haunting-things` 现在已经有三张核心表：`conversations`、`messages`、`agent_events`，其中 `messages` 目前只有 `role/content/status/created_at`，`agent_events` 目前主要通过 `payload TEXT` 保存完整事件。

当前 `ConversationRepository` 已经负责会话、消息、Agent 事件的增删查改，但写入字段还比较少。比如 `addMessage()` 只写入 `id/conversation_id/role/content/status/created_at`，`addAgentEvent()` 只写入 `id/conversation_id/turn_id/type/payload/created_at`。

`AcpRuntime` 已经有完整的运行态字段，例如 `sessionId`、`activeTurnId`、`assistantMessage`、`cancelRequested`、`usageSnapshot`、`modelsSnapshot`、`modeSnapshot`。这些正好可以持久化到数据库。

`session/cancel` 也已经实现了：`AcpRuntime.cancelCurrentTurn()` 内部调用 `this.connection.cancel({ sessionId: this.sessionId })`，并且注释明确说明这里只发送 `session/cancel` notification，不关闭 ACP 子进程。 所以后续不要重写取消逻辑，只需要把取消结果和本轮状态持久化。

---

# 1. 总体目标

本次改造要实现：

```txt id="xhk1ru"
1. 刷新页面后恢复 messages。
2. 切换会话后恢复 agent_events。
3. 重启应用后保留 conversation 的 ACP session 信息。
4. 持久化当前模型、权限模式、上下文 usage。
5. 持久化最近一轮 turnId、stopReason、错误信息。
6. session/cancel 后保留已流式输出内容。
7. session/cancel 后将本轮 stopReason 记录为 cancelled。
8. 前端历史回放时避免 DB 旧内容覆盖流式新内容。
9. 关键业务字段全部列化，不塞进 JSON。
```

设计原则：

```txt id="yez1x4"
会查询、排序、过滤、展示、恢复状态、参与业务判断的字段，必须是独立列。
只有原始 ACP 事件、工具输入输出、权限选项这类动态结构，才允许放 JSON。
```

---

# 2. 数据库 schema 改造

修改文件：

```txt id="wtq4l9"
src/server/db/schema.ts
```

本轮不做旧 schema 兼容迁移。新记忆字段直接写入 `CREATE TABLE IF NOT EXISTS` 的表结构定义；调用点必须按新类型写入必填字段。

## 2.1 conversations 增加运行态列

在 `conversations` 表结构中直接新增：

```sql id="b9cgo6"
acp_session_id TEXT,
session_mode TEXT,
current_model_id TEXT,
last_turn_id TEXT,
last_stop_reason TEXT,
last_error TEXT,
usage_size INTEGER,
usage_used INTEGER,
usage_ratio REAL,
usage_updated_at INTEGER
```

含义：

```txt id="l8zzmg"
acp_session_id      ACP sessionId，用于后续恢复或调试
session_mode        当前权限/执行模式，例如 auto、read-only、full-access
current_model_id    当前模型 id
last_turn_id        最近一轮 Agent turn id
last_stop_reason    最近一轮停止原因：done/cancelled/failed/stopped
last_error          最近一次失败原因
usage_size          上下文窗口大小
usage_used          已使用上下文数量
usage_ratio         使用比例
usage_updated_at    usage 快照更新时间
```

## 2.2 messages 增加消息关联列

在 `messages` 表结构中直接新增：

```sql id="zv2iel"
type TEXT NOT NULL,
turn_id TEXT,
source_event_id TEXT,
stop_reason TEXT,
tool_call_id TEXT,
permission_call_id TEXT,
parent_message_id TEXT,
sequence INTEGER NOT NULL
```

含义：

```txt id="7g8f36"
type                  text/thinking/tool_call/tool_result/plan/permission/system
turn_id               归属哪个 Agent turn
source_event_id       由哪个 agent_event 派生出来
stop_reason           如果这条消息是最终消息，可记录 done/cancelled/failed
tool_call_id          关联工具调用
permission_call_id    关联权限请求
parent_message_id     父消息 id，后续可用于消息树
sequence              会话内顺序号，优先用它排序
```

## 2.3 agent_events 增加核心索引列

保留 `payload TEXT NOT NULL`，但不要只依赖 payload。

在 `agent_events` 表结构中直接新增：

```sql id="eoyrb6"
status TEXT,
stop_reason TEXT,
tool_call_id TEXT,
permission_call_id TEXT,
message_id TEXT,
sequence INTEGER NOT NULL
```

含义：

```txt id="q7nezv"
status                事件状态，例如 running/done/failed
stop_reason           done/cancelled/failed/stopped
tool_call_id          工具调用 id
permission_call_id    权限请求 id
message_id            关联 assistant message id
sequence              会话内事件顺序
payload               原始标准化 AgentEvent JSON，保留用于回放和排查
```

## 2.4 新增索引

在 `db.exec()` 里新增：

```sql id="uc3cue"
CREATE INDEX IF NOT EXISTS idx_conversations_status
ON conversations(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_conversations_acp_session_id
ON conversations(acp_session_id);

CREATE INDEX IF NOT EXISTS idx_conversations_last_turn_id
ON conversations(last_turn_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence
ON messages(conversation_id, sequence);

CREATE INDEX IF NOT EXISTS idx_messages_turn_id
ON messages(turn_id);

CREATE INDEX IF NOT EXISTS idx_messages_source_event_id
ON messages(source_event_id);

CREATE INDEX IF NOT EXISTS idx_messages_tool_call_id
ON messages(tool_call_id);

CREATE INDEX IF NOT EXISTS idx_messages_permission_call_id
ON messages(permission_call_id);

CREATE INDEX IF NOT EXISTS idx_agent_events_conversation_sequence
ON agent_events(conversation_id, sequence);

CREATE INDEX IF NOT EXISTS idx_agent_events_turn_id
ON agent_events(turn_id, sequence);

CREATE INDEX IF NOT EXISTS idx_agent_events_type
ON agent_events(type, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_events_stop_reason
ON agent_events(stop_reason);
```

---

# 3. shared types 改造

修改文件：

```txt id="5ff31i"
src/shared/types/conversation.ts
```

当前 `Conversation` 只有 `id/backend/name/workspace/model/status/createdAt/updatedAt`。 当前 `ChatMessage` 也只有基础字段。

## 3.1 扩展停止原因类型

```ts id="lwci1m"
export type StopReason = "done" | "cancelled" | "failed" | "stopped";
```

## 3.2 扩展 Conversation

```ts id="hpunhb"
export type Conversation = {
  id: string;
  backend: AgentBackend;
  name: string;
  workspace: string;
  model?: string;
  status: ConversationStatus;

  acpSessionId?: string;
  sessionMode?: PermissionModeId;
  currentModelId?: string;

  lastTurnId?: string;
  lastStopReason?: StopReason;
  lastError?: string;

  usageSize?: number;
  usageUsed?: number;
  usageRatio?: number;
  usageUpdatedAt?: number;

  createdAt: number;
  updatedAt: number;
};
```

## 3.3 增加 ChatMessageType

```ts id="4gxwvm"
export type ChatMessageType =
  | "text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "plan"
  | "permission"
  | "system";
```

## 3.4 扩展 ChatMessage

```ts id="xt5hqc"
export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  type: ChatMessageType;

  content: string;
  attachments?: AttachmentRef[];
  createdAt: number;
  status?: "streaming" | "done" | "error";

  turnId?: string;
  sourceEventId?: string;
  stopReason?: StopReason;

  toolCallId?: string;
  permissionCallId?: string;
  parentMessageId?: string;

  sequence: number;
};
```

不做兼容兜底：调用点必须显式传 `type` 和 `sequence`；repository 只负责在新增时分配最终会话内顺序。

---

# 4. mappers 改造

修改文件：

```txt id="gspov2"
src/server/db/mappers.ts
```

## 4.1 rowToConversation

```ts id="fcm80b"
export function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    backend: row.backend,
    name: row.name,
    workspace: row.workspace,
    model: row.model ?? undefined,
    status: row.status,

    acpSessionId: row.acp_session_id ?? undefined,
    sessionMode: row.session_mode ?? undefined,
    currentModelId: row.current_model_id ?? undefined,

    lastTurnId: row.last_turn_id ?? undefined,
    lastStopReason: row.last_stop_reason ?? undefined,
    lastError: row.last_error ?? undefined,

    usageSize: row.usage_size ?? undefined,
    usageUsed: row.usage_used ?? undefined,
    usageRatio: row.usage_ratio ?? undefined,
    usageUpdatedAt: row.usage_updated_at ?? undefined,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

## 4.2 rowToMessage

```ts id="2yash3"
export function rowToMessage(row: any): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    type: row.type ?? "text",
    content: row.content,
    status: row.status ?? undefined,
    createdAt: row.created_at,

    turnId: row.turn_id ?? undefined,
    sourceEventId: row.source_event_id ?? undefined,
    stopReason: row.stop_reason ?? undefined,

    toolCallId: row.tool_call_id ?? undefined,
    permissionCallId: row.permission_call_id ?? undefined,
    parentMessageId: row.parent_message_id ?? undefined,

    sequence: row.sequence ?? 0,
  };
}
```

## 4.3 rowToAgentEvent

继续解析 `payload`，但要让 repository 在写入时同步列化核心字段。

```ts id="qhy2ny"
export function rowToAgentEvent(row: any): AgentEvent {
  const payload = JSON.parse(row.payload) as AgentEvent;

  return {
    ...payload,
    id: row.id ?? payload.id,
    conversationId: row.conversation_id ?? payload.conversationId,
    turnId: row.turn_id ?? payload.turnId,
    type: row.type ?? payload.type,
    status: row.status ?? payload.status,
    stopReason: row.stop_reason ?? payload.stopReason,
    toolCallId: row.tool_call_id ?? payload.toolCallId,
    permissionCallId: row.permission_call_id ?? payload.permissionCallId,
    messageId: row.message_id ?? payload.messageId,
    sequence: row.sequence ?? payload.sequence ?? 0,
  };
}
```

---

# 5. ConversationRepository 改造

修改文件：

```txt id="c5agv4"
src/server/db/conversationRepository.ts
```

## 5.1 createConversation 写入新增列

```ts id="3tow55"
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
```

## 5.2 新增状态更新方法

```ts id="syp0oc"
updateConversationAcpSession(id: string, acpSessionId: string): Conversation | null {
  this.db
    .prepare('UPDATE conversations SET acp_session_id = ?, updated_at = ? WHERE id = ?')
    .run(acpSessionId, Date.now(), id);

  return this.getConversation(id);
}
```

```ts id="tb62c6"
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
```

```ts id="c0k4hp"
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
```

## 5.3 消息 sequence 生成

新增私有方法：

```ts id="q962px"
private nextMessageSequence(conversationId: string): number {
  const row = this.db
    .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM messages WHERE conversation_id = ?')
    .get(conversationId) as { next: number };

  return row.next;
}
```

## 5.4 addMessage 写入列化字段

```ts id="b1wqh7"
addMessage(message: ChatMessage): ChatMessage {
  const sequence = message.sequence || this.nextMessageSequence(message.conversationId);

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
      message.type ?? 'text',
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
```

## 5.5 updateMessage 更新列化字段

```ts id="r1qajl"
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
      message.type ?? 'text',
      message.turnId ?? null,
      message.sourceEventId ?? null,
      message.stopReason ?? null,
      message.toolCallId ?? null,
      message.permissionCallId ?? null,
      message.parentMessageId ?? null,
      message.id
    );
}
```

## 5.6 listMessages 改成 sequence 排序

当前按 `created_at ASC` 排序。 改成：

```ts id="l2b4ue"
listMessages(conversationId: string): ChatMessage[] {
  const rows = this.db
    .prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ?
       ORDER BY sequence ASC, created_at ASC`
    )
    .all(conversationId) as any[];

  return rows.map(rowToMessage);
}
```

## 5.7 agent event sequence 生成

```ts id="f06nyc"
private nextAgentEventSequence(conversationId: string): number {
  const row = this.db
    .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM agent_events WHERE conversation_id = ?')
    .get(conversationId) as { next: number };

  return row.next;
}
```

## 5.8 addAgentEvent 同步写入核心列

```ts id="7mup4z"
addAgentEvent(event: AgentEvent): AgentEvent {
  const sequence = event.sequence || this.nextAgentEventSequence(event.conversationId);
  const normalized = { ...event, sequence };

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
```

## 5.9 listAgentEvents 查询更多列

```ts id="zyvxug"
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
```

## 5.10 Port 增加方法

```ts id="x4t7mt"
export type ConversationRepositoryPort = Pick<
  ConversationRepository,
  | "createConversation"
  | "updateConversationModel"
  | "updateConversationStatus"
  | "updateConversationAcpSession"
  | "updateConversationRuntimeState"
  | "updateConversationTurnResult"
  | "listConversations"
  | "getConversation"
  | "addMessage"
  | "updateMessage"
  | "listMessages"
  | "addAgentEvent"
  | "listAgentEvents"
>;
```

---

# 6. AcpRuntime 改造

修改文件：

```txt id="vg0awa"
src/server/runtime/acpRuntime.ts
```

当前 runtime 已经在 `ensureStarted()` 里 `connection.newSession()`，随后设置 `this.sessionId = sessionResult.sessionId`。 这里要把 sessionId 向上层发出去，让 service 持久化。

## 6.1 Runtime 事件增加 session

```ts id="xf3mm8"
type AcpRuntimeEvents = {
  message: [ChatMessage];
  agentEvent: [AgentEvent];
  usage: [ConversationUsage];
  commands: [ConversationCommands];
  models: [ConversationModels];
  mode: [ConversationMode];
  permission: [PermissionRequest];
  status: [ConversationStatus, string?];
  finish: [ConversationStatus];

  session: [{ conversationId: string; sessionId: string; updatedAt: number }];
};
```

## 6.2 构造参数预留 resumeSessionId

```ts id="i6mgid"
constructor(
  private readonly input: {
    conversationId: string;
    backend: AgentBackend;
    workspace: string;
    model?: string;
    mcpServers?: McpServer[];
    resumeSessionId?: string;
  }
) {
  super();
  this.logger = createLogger(`acp.${input.backend}`);
}
```

当前实现已经接入 ACP session 恢复：

```txt id="yjcdvn"
1. 如果 conversation.acpSessionId 存在且 Agent 声明 loadSession，则优先调用 session/load。
2. 如果不支持 loadSession 但声明 sessionCapabilities.resume，则调用实验性的 session/resume。
3. 如果恢复请求返回 `Resource not found`，说明持久化 sessionId 在 Agent 端已失效；记录 `session_restore_missing` 并创建新 session。
4. 其它恢复请求失败仍然直接暴露错误，不静默创建新 session。
5. 如果 Agent 没有恢复能力，则记录 session_restore_unavailable 并创建新 session。
```

`session/load` / `session/resume` 成功后继续使用已持久化的 `acp_session_id` 作为后续 `session/prompt`、`session/cancel` 的 sessionId；只有创建新 session 时才写入新的 sessionId。

## 6.3 newSession 后 emit session

在：

```ts id="scw0xl"
this.sessionId = sessionResult.sessionId;
```

后面加：

```ts id="xl3wxv"
this.emit("session", {
  conversationId: this.input.conversationId,
  sessionId: this.sessionId,
  updatedAt: Date.now(),
});
```

## 6.4 assistantMessage 补充 type/turnId/sequence

当前 assistant message 创建时只有 `id/conversationId/role/content/createdAt/status`。 改成：

```ts id="rsw0j8"
this.assistantMessage = {
  id: createId(),
  conversationId: this.input.conversationId,
  role: "assistant",
  type: "text",
  content: "",
  createdAt: Date.now(),
  status: "streaming",
  turnId: this.activeTurnId ?? undefined,
  sequence: 0,
};
```

调用点传入 `sequence: 0` 表示本条消息尚未分配顺序；repository 在新增时生成最终 sequence。

## 6.5 emitAgentEvent 补充核心字段

找到 `emitAgentEvent()`，统一把输入事件标准化成：

```ts id="z7wsub"
const event: AgentEvent = {
  id: createId(),
  conversationId: this.input.conversationId,
  turnId: this.activeTurnId ?? undefined,
  type: input.type,
  status: readStatus(input),
  stopReason: readStopReason(input),
  toolCallId: readToolCallId(input),
  permissionCallId: readPermissionCallId(input),
  messageId: readMessageId(input),
  sequence: 0,
  at: Date.now(),
  ...input,
};
```

重点：

```txt id="aickhh"
agent.reply.delta / agent.reply.done  -> messageId = assistantMessage.id
agent.tool.call / update / result     -> toolCallId
agent.permission.request              -> permissionCallId = callId
agent.done                            -> status + stopReason
```

## 6.6 cancel 不改协议，只补状态

当前 cancel 已经是正确方案。保留：

```ts id="qsfw0t"
await this.connection.cancel({ sessionId: this.sessionId });
```

这就是 ACP 的 `session/cancel` notification 封装。

只需要保证 `finalizeCancelledTurn()` 中：

```ts id="lb12ku"
this.emitAgentEvent({
  type: "agent.done",
  status: "idle",
  stopReason: "cancelled",
});
```

继续保留。当前已经有这行逻辑。

建议额外把 assistant 消息也标记：

```ts id="spqegb"
this.assistantMessage = {
  ...this.assistantMessage,
  status: "done",
  stopReason: "cancelled",
};
```

---

# 7. ConversationService 改造

修改文件：

```txt id="wz5fef"
src/server/services/conversationService.ts
```

当前 `ConversationService` 已经负责创建 conversation、发送消息、创建 runtime、持久化 runtime message、持久化 agentEvent。

## 7.1 create 初始化新增字段

当前 `create()` 只写基础字段。 改成：

```ts id="g7nl1o"
const conversation = this.repo.createConversation({
  id: createId(),
  backend: input.backend,
  name: input.name || `${input.backend} conversation`,
  workspace,
  model: input.model?.trim() || undefined,
  status: "idle",

  acpSessionId: undefined,
  sessionMode: undefined,
  currentModelId: input.model?.trim() || undefined,

  lastTurnId: undefined,
  lastStopReason: undefined,
  lastError: undefined,

  usageSize: undefined,
  usageUsed: undefined,
  usageRatio: undefined,
  usageUpdatedAt: undefined,

  createdAt: now,
  updatedAt: now,
});
```

## 7.2 用户消息补充 type/sequence

当前 `sendMessage()` 写用户消息时只有基础字段。 改成：

```ts id="kqg380"
const userMessage = this.repo.addMessage({
  id: createId(),
  conversationId: conversation.id,
  role: "user",
  type: "text",
  content: input.content,
  createdAt: Date.now(),
  status: "done",
  sequence: 0,
});
```

`sendRuntimePrompt()` 里的 visible message 同样补上 `type: 'text'`、`sequence: 0`。

## 7.3 创建 runtime 时传入 resumeSessionId

当前 `getRuntime()` 创建 `AcpRuntime` 时没有传 sessionId。 改成：

```ts id="kzxz6b"
const runtime = new AcpRuntime({
  conversationId: conversation.id,
  backend: conversation.backend,
  workspace: conversation.workspace,
  model: conversation.model,
  mcpServers: this.mcpServers.get(conversation.id),
  resumeSessionId: conversation.acpSessionId,
});
```

## 7.4 监听 session 并持久化

在 `getRuntime()` 里加：

```ts id="jqw09n"
runtime.on("session", ({ sessionId }) => {
  const updated = this.repo.updateConversationAcpSession(
    conversation.id,
    sessionId,
  );

  this.logger.info("conversation_acp_session_persisted", {
    conversationId: conversation.id,
    sessionId,
  });

  if (updated) {
    this.events.emit("conversation.updated", updated);
  }
});
```

## 7.5 runtime message 事件保持更新逻辑

当前代码每次收到 runtime message，会查已有消息，存在则 update，不存在则 add。 保留这个行为，但不要每次 `listMessages().some()`，后续可以优化成 repository 方法：

```ts id="qhhxru"
messageExists(messageId: string): boolean
```

暂时最小改造可以不做性能优化。

## 7.6 agent.done 持久化最近 turn 结果

当前 `agentEvent` 事件只是按策略持久化和实时广播。 在里面加：

```ts id="m8wags"
if (event.type === "agent.done") {
  this.repo.updateConversationTurnResult(conversation.id, {
    lastTurnId: event.turnId,
    lastStopReason:
      event.stopReason ?? normalizeStatusToStopReason(event.status),
    lastError: undefined,
  });
}
```

辅助函数：

```ts id="b3wbvi"
function normalizeStatusToStopReason(status?: string): StopReason {
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  return "done";
}
```

如果 event 是 `agent.error`：

```ts id="q8upcb"
if (event.type === "agent.error") {
  this.repo.updateConversationTurnResult(conversation.id, {
    lastTurnId: event.turnId,
    lastStopReason: "failed",
    lastError: event.message,
  });
}
```

## 7.7 usage 持久化

当前 usage 只 emit 给前端。 改成：

```ts id="roggaf"
runtime.on("usage", (usage: ConversationUsage) => {
  this.repo.updateConversationRuntimeState(conversation.id, {
    usageSize: usage.size,
    usageUsed: usage.used,
    usageRatio: usage.ratio,
    usageUpdatedAt: usage.updatedAt,
  });

  this.events.emit("conversation.usage", usage);
});
```

## 7.8 models 持久化

当前 models 只保存在内存 snapshot 并 emit。 改成：

```ts id="imxyy4"
runtime.on("models", (snapshot: ConversationModels) => {
  this.modelSnapshots.set(conversation.id, snapshot);

  this.repo.updateConversationRuntimeState(conversation.id, {
    currentModelId: snapshot.currentModelId,
  });

  this.events.emit("conversation.models", snapshot);
});
```

## 7.9 mode 持久化

当前 `setMode()` 注释写的是“不持久化到数据库”。 现在要改成持久化。

runtime mode 事件：

```ts id="jpr3zo"
runtime.on("mode", (snapshot: ConversationMode) => {
  this.modeSnapshots.set(conversation.id, snapshot);

  this.repo.updateConversationRuntimeState(conversation.id, {
    sessionMode: snapshot.mode,
  });

  this.events.emit("conversation.mode", snapshot);
});
```

`setMode()` 调用成功后也可以立即持久化，避免等事件延迟：

```ts id="0kf5yq"
const snapshot = await runtime.setSessionMode(mode);

this.repo.updateConversationRuntimeState(conversation.id, {
  sessionMode: snapshot.mode,
});
```

## 7.10 cancelCurrentTurn 保留现有入口

当前 service 已有 `cancelCurrentTurn()`，会调用 runtime 的 `cancelCurrentTurn()`。 这块不重写，只补取消失败时持久化错误：

```ts id="tcqinj"
this.repo.updateConversationTurnResult(input.conversationId, {
  lastStopReason: "failed",
  lastError: message,
});
```

---

# 8. bridge/API 改造

当前前端 hook 已经调用：

```ts id="hdj5ew"
bridge.invoke("conversation.messages", { conversationId });
bridge.invoke("conversation.agentEvents", { conversationId, limit: 200 });
bridge.invoke("conversation.cancel", { conversationId });
```

这些入口在 hook 中已经实际使用。

建议新增一个读取单个 conversation 的 bridge：

```txt id="dby0q4"
conversation.get
```

服务层新增：

```ts id="2bt7q4"
get(conversationId: string): Conversation | null {
  return this.repo.getConversation(conversationId);
}
```

bridge 注册：

```ts id="no57wf"
bridge.register("conversation.get", ({ conversationId }) =>
  conversations.get(conversationId),
);
```

用途：

```txt id="lr7l2p"
1. 前端展示当前 sessionMode/currentModelId。
2. 前端展示 lastStopReason。
3. 调试 acpSessionId。
4. 页面刷新后恢复 usage。
```

当前前端 `useRuntimeSnapshots()` 已经在切换 active conversation 时调用 `conversation.get`，并把持久化的 `currentModelId/sessionMode/usage_*` 转换为现有 toolbar 使用的 `ConversationModels`、`ConversationMode`、`ConversationUsage` 快照。

---

# 9. 前端 hook 改造

修改文件：

```txt id="thv8u5"
src/renderer/shared/hooks/useConversationStream.ts
src/renderer/shared/utils/backendData.ts
```

当前前端实时流的合并策略是：按 message.id 找到旧消息，然后直接用 event.message 替换。 历史加载时也直接 `setMessages(normalizeMessageList(items))`。 这会有一个问题：流式输出中如果 DB 回放的是旧内容，可能覆盖前端更长的新内容。

## 9.1 抽取消息合并函数

```ts id="5oieo2"
function mergeStreamMessage(
  current: ChatMessage[],
  incoming: ChatMessage,
): ChatMessage[] {
  const index = current.findIndex((item) => item.id === incoming.id);
  if (index < 0) {
    return [...current, incoming].sort(sortMessage);
  }

  const next = [...current];
  next[index] = preferRicherMessage(current[index], incoming);
  return next.sort(sortMessage);
}
```

## 9.2 防止旧消息覆盖新消息

```ts id="3kqvli"
function preferRicherMessage(
  oldMessage: ChatMessage,
  newMessage: ChatMessage,
): ChatMessage {
  if (
    oldMessage.status === "streaming" &&
    newMessage.content.length < oldMessage.content.length
  ) {
    return oldMessage;
  }

  if (
    oldMessage.status === "done" &&
    newMessage.status === "streaming" &&
    newMessage.content.length < oldMessage.content.length
  ) {
    return oldMessage;
  }

  return newMessage;
}
```

## 9.3 使用 sequence 排序

```ts id="n2hzky"
function sortMessage(a: ChatMessage, b: ChatMessage): number {
  const aSeq = a.sequence ?? 0;
  const bSeq = b.sequence ?? 0;

  if (aSeq !== bSeq) return aSeq - bSeq;
  return a.createdAt - b.createdAt;
}
```

## 9.4 替换实时流处理

把当前：

```ts id="mdn583"
setMessages((current) => {
  const index = current.findIndex((item) => item.id === event.message.id);
  if (index < 0) return [...current, event.message];
  const next = [...current];
  next[index] = event.message;
  return next;
});
```

改成：

```ts id="g5h5a6"
setMessages((current) => mergeStreamMessage(current, event.message));
```

## 9.5 替换历史加载处理

把：

```ts id="fmsfh0"
setMessages(normalizeMessageList(items));
```

改成：

```ts id="btfx9o"
const loaded = normalizeMessageList(items);

setMessages((current) => {
  if (activeConversationRef.current !== conversationId) {
    return loaded.sort(sortMessage);
  }

  const byId = new Map<string, ChatMessage>();

  for (const item of loaded) {
    byId.set(item.id, item);
  }

  for (const item of current) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? preferRicherMessage(existing, item) : item);
  }

  return Array.from(byId.values()).sort(sortMessage);
});
```

## 9.6 agentEvents 内存上限统一

当前实时事件只保留 80 条，历史加载取 200 条。 建议统一：

```ts id="b8t0r7"
const MAX_AGENT_EVENTS_IN_MEMORY = 200;
```

实时追加：

```ts id="zv9pn8"
[event.conversationId]: [...list, event].slice(-MAX_AGENT_EVENTS_IN_MEMORY)
```

---

# 10. JSON 使用边界

允许 JSON：

```txt id="z5zg4m"
agent_events.payload        原始标准化 AgentEvent
tool input/output           工具参数、工具结果
permission options          权限选项
attachments 扩展元数据       如果以后需要复杂结构
```

不允许只放 JSON 的字段：

```txt id="z0ip33"
acp_session_id
session_mode
current_model_id
last_turn_id
last_stop_reason
last_error
usage_size
usage_used
usage_ratio
usage_updated_at
message.type
message.turn_id
message.stop_reason
message.sequence
agent_event.status
agent_event.stop_reason
agent_event.tool_call_id
agent_event.permission_call_id
agent_event.message_id
agent_event.sequence
```

---

# 11. 测试方案

建议新增或修改：

```txt id="vets4b"
src/server/db/conversationRepository.test.ts
src/server/services/conversationService.test.ts
src/server/runtime/acpRuntime.test.ts
src/renderer/shared/hooks/useConversationStream.test.ts
```

## 11.1 Repository 测试

覆盖：

```txt id="kx3ntd"
1. createConversation 能写入 acpSessionId/sessionMode/currentModelId 等列。
2. updateConversationAcpSession 能更新 acp_session_id。
3. updateConversationRuntimeState 能更新 mode/model/usage。
4. updateConversationTurnResult 能更新 last_turn_id/last_stop_reason/last_error。
5. addMessage 能自动生成 sequence。
6. listMessages 按 sequence 排序。
7. addAgentEvent 能把 payload 和核心列都写入。
8. listAgentEvents 按 sequence 恢复顺序。
```

## 11.2 Runtime 测试

覆盖：

```txt id="ii6w00"
1. newSession 后 emit session 事件。
2. cancelCurrentTurn 会调用 connection.cancel({ sessionId })。
3. cancelled prompt response 会进入 finalizeCancelledTurn。
4. cancel 后 assistant 已输出内容保留。
5. agent.done 的 stopReason 为 cancelled。
```

## 11.3 Service 测试

覆盖：

```txt id="mzhd6m"
1. runtime session 事件会写入 conversations.acp_session_id。
2. runtime usage 事件会写入 usage_size/usage_used/usage_ratio。
3. runtime mode 事件会写入 session_mode。
4. runtime models 事件会写入 current_model_id。
5. agent.done(cancelled) 会写入 last_stop_reason=cancelled。
6. agent.error 会写入 last_error。
```

## 11.4 前端测试

覆盖：

```txt id="tpdywk"
1. 流式消息按 id 合并。
2. DB 旧内容不会覆盖前端更长的 streaming 内容。
3. 历史消息按 sequence 排序。
4. agentEvents 实时和历史上限统一为 200。
5. cancelCurrentTurn 成功后 phase 设置为 done。
```

---

# 12. 推荐提交拆分

按阶段提交，方便 review 和回滚。

## 第 1 次提交：schema + types

```txt id="a9j76k"
feat: 列化会话记忆状态字段
```

包含：

```txt id="tiq8re"
src/server/db/schema.ts
src/shared/types/conversation.ts
```

## 第 2 次提交：repository + mapper

```txt id="f2wbae"
feat: 持久化消息和事件关联字段
```

包含：

```txt id="dsehug"
src/server/db/conversationRepository.ts
src/server/db/mappers.ts
```

## 第 3 次提交：runtime session 持久化事件

```txt id="q6ggje"
feat: 暴露 ACP 会话运行态事件
```

包含：

```txt id="qzbyb4"
src/server/runtime/acpRuntime.ts
```

## 第 4 次提交：service 运行态落库

```txt id="9g7nyl"
feat: 持久化对话运行态快照
```

包含：

```txt id="htd0pf"
src/server/services/conversationService.ts
bridge handler 相关文件
```

## 第 5 次提交：前端历史回放合并

```txt id="4ysfdy"
feat: 优化对话历史回放合并逻辑
```

包含：

```txt id="3fa85b"
src/renderer/shared/hooks/useConversationStream.ts
src/renderer/shared/utils/backendData.ts
```

## 第 6 次提交：测试

```txt id="ftb1pp"
test: 补充对话记忆持久化测试
```

---

# 13. 最终验收标准

完成后检查：

```txt id="qx2p5v"
1. 新建会话后 conversations 新增列为空或默认值正确。
2. 发送第一条消息后 acp_session_id 被写入。
3. 流式 assistant 消息刷新页面后可以恢复。
4. agent_events 能恢复 thinking/tool/plan/done 过程。
5. 切换模型后 current_model_id 被写入。
6. 切换 mode 后 session_mode 被写入。
7. usage_update 后 usage_size/usage_used/usage_ratio 被写入。
8. 点击取消时仍然走 session/cancel，不杀 ACP 子进程。
9. 取消后 assistant 已输出内容保留。
10. 取消后 last_stop_reason = cancelled。
11. 历史加载不会覆盖正在流式输出的更长内容。
12. npm run typecheck 通过。
13. npm test 通过。
```

最终设计一句话：

> `haunting-things` 保留现有 SQLite + ConversationService + AcpRuntime 架构，在 `conversations/messages/agent_events` 中把 session、turn、mode、model、usage、stopReason、toolCall、permission、sequence 等关键记忆列化；`payload JSON` 只用于保存原始 AgentEvent，`session/cancel` 继续走现有 ACP cancel 通道，并补齐取消后的状态持久化和前端历史合并。
