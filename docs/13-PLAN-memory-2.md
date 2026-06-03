下面按 `haunting-things feat/memory` 的最新代码来对比 AionUi，并给出下一阶段编码方案。

# 1. 现在 `feat/memory` 已经做到的部分

`feat/memory` 已经完成了之前建议里的大部分“列化记忆”改造：

1. `conversations` 已经有 `acp_session_id`、`session_mode`、`current_model_id`、`last_turn_id`、`last_stop_reason`、`usage_size/usage_used/usage_ratio` 等列；`messages` 也有 `type/turn_id/stop_reason/tool_call_id/permission_call_id/sequence`；`agent_events` 也有 `status/stop_reason/tool_call_id/permission_call_id/message_id/sequence`。

2. Repository 已经能写入这些列化字段，并按 `sequence` 恢复 messages 和 agent_events。

3. Runtime 已经支持 `resumeSessionId`，并且在 `startSession()` 里优先尝试 `session/load`，其次尝试实验性的 `session/resume`，失败时才创建新 session。

4. Service 创建 runtime 时已经把 `conversation.acpSessionId` 传入，并监听 `session/models/mode/usage/agent.done` 等事件落库。

5. 前端已经能从 DB 加载历史 messages、agentEvents，并且有“防止旧 DB 快照覆盖更长流式内容”的合并逻辑。

所以现在不是“没有记忆”，而是：

> 已经有 UI 历史恢复、事件回放、ACP sessionId 恢复，但还缺少“重启后可靠恢复运行态”和“session 恢复失败后的上下文兜底重建”。

---

# 2. 和 AionUi 相比还欠缺什么

## 2.1 重启后只能恢复 UI 历史，不一定恢复模型上下文

`haunting-things` 当前会优先 `session/load` / `session/resume`，但如果后端 bridge 不支持恢复，或者 session 资源丢失，就会创建新 session。代码里对缺失 session 的处理是记录 warn 后 `createNewSession()`。

问题是：**创建新 session 后，只会把当前用户这一次 prompt 发给模型，不会把 DB 里的历史 messages 重新拼成上下文注入给模型。**

结果就是：

```txt
用户看到历史记录还在；
但是模型其实已经失忆，只知道当前这一条消息。
```

AionUi 也保存 ACP session id、session mode、current model id、token usage 等运行态字段，用于会话恢复。 同时它会从 DB 加载大量历史消息，并在前端合并时保留更完整的流式版本，避免刷新时丢内容。

`haunting-things` 现在缺的不是“显示历史”，而是：

> 当 ACP session 无法恢复时，用历史 messages 构造一个兜底上下文。

---

## 2.2 持久化了 `sessionMode/currentModelId`，但 runtime 启动时没有真正优先使用它们

Service 现在 `getRuntime()` 传的是：

```ts
model: conversation.model,
resumeSessionId: conversation.acpSessionId,
```

没有把 `conversation.currentModelId` 和 `conversation.sessionMode` 传给 runtime。

Runtime 启动后又会：

```ts
if (this.input.model?.trim()) {
  await this.setSessionModel(this.input.model.trim());
}
await this.setSessionMode(this.getStartupMode());
```

而 `getStartupMode()` 对 claude/codex 返回默认值。

这意味着：即使 DB 里保存了用户上次选择的 mode/model，重启后也可能被默认值覆盖。

AionUi 的会话 extra 里明确保存了 `session_mode` 和 `current_model_id` 作为 resume 支持字段。 `haunting-things` 也保存了列，但还没完全应用到启动策略。

---

## 2.3 commands / config options 没有持久化

`haunting-things` 的 `commands()` 当前只读内存里的 `commandSnapshots`，重启后直接丢失。

AionUi 有全局 ACP 缓存，例如 cached initialize result、cached config options、cached modes。

这会影响：

```txt
1. 重启后模型列表 / mode 列表 / slash commands 为空；
2. 必须再次启动 runtime 才能恢复 UI 可选项；
3. 新建或恢复会话时无法提前展示上次可用配置。
```

---

## 2.4 MCP server 配置没有随 conversation 持久化

`ConversationService` 目前把 `mcpServers` 放在内存 Map 里：

```ts
private readonly mcpServers = new Map<string, any[]>();
```

创建会话时如果传入 MCP，只写进内存，不写数据库。

重启后 `mcpServers` 会丢，下一次 session/load 或 newSession 时传给 bridge 的 MCP 列表为空。AionUi 在会话 extra 里保存了 `mcp_server_ids`、`mcp_servers`、`session_mcp_servers` 等会话级 MCP 快照。

这会导致：

```txt
UI 历史还在，但恢复后的 Agent 工具环境不同。
```

---

## 2.5 应用重启时没有清理“僵尸 running 状态”

如果程序在 Agent 正在执行时崩溃或被关闭，DB 里的 conversation 可能仍是 `running`。目前没有看到启动时扫描并修正 running 会话的逻辑。

这会导致重启后：

```txt
1. 侧边栏显示还在运行；
2. 前端 activePhase 可能恢复为 thinking / tool_calling；
3. 但实际 runtime 已经不存在；
4. cancel 时只能走 runtime missing 的兜底逻辑。
```

AionUi 的会话类型里区分了持久化 status 和 runtime summary，runtime 是当前进程态，不等同于历史任务状态。

`haunting-things` 也应该区分：

```txt
conversation.status      持久化状态
runtime 是否存在          当前进程状态
last_stop_reason         上一轮最终结果
```

---

## 2.6 thinking / tool / permission 只存 agent_events，没有投影到统一消息时间线

`haunting-things` 当前的 `messages` 支持 `thinking/tool_call/tool_result/plan/permission` 类型，但 runtime 实际只创建 user text 和 assistant text；thinking/tool/plan/permission 主要进入 `agent_events`。

AionUi 的消息合并能力更细：它为 `msg_id`、`tool_call.call_id`、`acp_tool_call.update.tool_call_id`、`permission.call_id` 建索引，并把 thinking、plan、tool、permission 都当成消息流的一部分做合并。

`haunting-things` 现在能回放事件，但如果目标是 AionUi 那种完整对话过程卡片流，还差一个：

```txt
agent_events -> timeline item / message projection
```

---

# 3. 下一步编码方案

## 阶段一：补“重启状态修复”

### 目标

应用启动时，把上次异常退出遗留的 running 状态修正成 stopped，并补充 lastStopReason。

### 修改文件

```txt
src/server/db/conversationRepository.ts
src/server/services/conversationService.ts
src/server/app/xxx 初始化入口
```

### Repository 新增方法

```ts
listConversationsByStatus(status: Conversation['status']): Conversation[];

finalizeInterruptedConversation(input: {
  conversationId: string;
  lastTurnId?: string;
  reason: 'app_restarted' | 'runtime_missing';
  message: string;
}): void;

finalizeStreamingMessages(input: {
  conversationId: string;
  stopReason: StopReason;
}): void;
```

### SQL 逻辑

```sql
UPDATE conversations
SET status = 'stopped',
    last_stop_reason = 'stopped',
    last_error = ?,
    updated_at = ?
WHERE status = 'running';
```

```sql
UPDATE messages
SET status = 'done',
    stop_reason = 'stopped'
WHERE conversation_id = ?
  AND status = 'streaming';
```

### Service 启动恢复

```ts
recoverStaleRuntimeState(): void {
  const running = this.repo.listConversationsByStatus('running');

  for (const conversation of running) {
    this.repo.finalizeStreamingMessages({
      conversationId: conversation.id,
      stopReason: 'stopped',
    });

    this.repo.finalizeInterruptedConversation({
      conversationId: conversation.id,
      lastTurnId: conversation.lastTurnId,
      reason: 'app_restarted',
      message: '应用重启，上一轮运行时已丢失',
    });

    this.events.emit('conversation.status', {
      conversationId: conversation.id,
      status: 'stopped',
      error: '应用重启，上一轮运行时已丢失',
    });
  }
}
```

启动入口在创建 `ConversationService` 后调用一次：

```ts
conversations.recoverStaleRuntimeState();
```

提交信息：

```txt
feat: 启动时修复僵尸会话状态
```

---

## 阶段二：让持久化 mode/model 真正参与 runtime 启动

### 目标

重启后优先使用：

```txt
conversation.currentModelId ?? conversation.model
conversation.sessionMode ?? backend 默认 mode
```

### 修改 `AcpRuntime` 构造参数

```ts
constructor(
  private readonly input: {
    conversationId: string;
    backend: AgentBackend;
    workspace: string;
    model?: string;
    startupMode?: string;
    mcpServers?: McpServer[];
    resumeSessionId?: string;
  }
) {}
```

### 修改 `ConversationService.getRuntime()`

```ts
const runtime = new AcpRuntime({
  conversationId: conversation.id,
  backend: conversation.backend,
  workspace: conversation.workspace,
  model: conversation.currentModelId ?? conversation.model,
  startupMode: conversation.sessionMode,
  mcpServers: this.getConversationMcpServers(conversation.id),
  resumeSessionId: conversation.acpSessionId,
});
```

### 修改 `AcpRuntime.ensureStarted()`

把：

```ts
await this.setSessionMode(this.getStartupMode());
```

改成：

```ts
await this.setSessionMode(
  this.input.startupMode?.trim() || this.getStartupMode(),
);
```

模型也使用：

```ts
const startupModel = this.input.model?.trim();
if (startupModel) {
  await this.setSessionModel(startupModel);
}
```

提交信息：

```txt
feat: 恢复会话启动模型和权限模式
```

---

## 阶段三：增加 session 恢复状态列

### 目标

现在 runtime 只 emit `sessionId`，Service 不知道这次到底是 restored 还是 fallback new session。需要把恢复结果持久化，方便 UI 和调试。

### schema 新增列

```ts
ensureColumn(db, "conversations", "session_restore_status", "TEXT");
ensureColumn(db, "conversations", "session_restore_method", "TEXT");
ensureColumn(db, "conversations", "session_restore_error", "TEXT");
ensureColumn(db, "conversations", "session_restored_at", "INTEGER");
```

含义：

```txt
session_restore_status    restored / new / fallback / unavailable / failed
session_restore_method    session/load / session/resume / session/new
session_restore_error     恢复失败原因
session_restored_at       最近一次恢复时间
```

### Runtime session 事件扩展

```ts
session: [{
  conversationId: string;
  sessionId: string;
  restored: boolean;
  method: 'session/load' | 'session/resume' | 'session/new';
  fallbackReason?: string;
  updatedAt: number;
}];
```

### startSession 返回结构扩展

```ts
type AcpSessionStartupResult = {
  sessionId: string;
  modeSource?: unknown;
  modelSource?: unknown;
  restored: boolean;
  method: "session/load" | "session/resume" | "session/new";
  fallbackReason?: string;
};
```

### Repository 新增方法

```ts
updateConversationSessionRestoreState(id: string, patch: {
  acpSessionId: string;
  sessionRestoreStatus: 'restored' | 'new' | 'fallback' | 'unavailable' | 'failed';
  sessionRestoreMethod: string;
  sessionRestoreError?: string;
  sessionRestoredAt: number;
}): Conversation | null;
```

提交信息：

```txt
feat: 记录 ACP session 恢复状态
```

---

## 阶段四：补“session 恢复失败后的上下文兜底注入”

### 目标

当 `session/load` / `session/resume` 不可用或失败，并且创建了新 session 时，自动把最近历史消息拼成一个恢复上下文，随下一条用户消息一起发给 Agent。

### 新增文件

```txt
src/server/services/memoryContextService.ts
```

### 核心接口

```ts
export type MemoryContextBuildInput = {
  conversationId: string;
  beforeSequence?: number;
  maxMessages?: number;
  maxChars?: number;
};

export class MemoryContextService {
  constructor(private readonly repo: ConversationRepositoryPort) {}

  buildRestoreContext(input: MemoryContextBuildInput): string | null {
    const messages = this.repo
      .listMessages(input.conversationId)
      .filter(
        (message) =>
          message.sequence < (input.beforeSequence ?? Number.MAX_SAFE_INTEGER),
      )
      .filter((message) => message.type === "text")
      .filter((message) => message.content.trim())
      .filter((message) => message.status !== "streaming")
      .slice(-(input.maxMessages ?? 20));

    if (!messages.length) return null;

    const lines = messages.map((message) => {
      const role =
        message.role === "user"
          ? "用户"
          : message.role === "assistant"
            ? "助手"
            : message.role;
      const suffix =
        message.stopReason === "cancelled" ? "（上次回复被用户中断）" : "";
      return `${role}${suffix}: ${message.content.trim()}`;
    });

    const body = lines.join("\n\n");
    const maxChars = input.maxChars ?? 12000;

    return [
      "以下是当前会话在本地数据库中恢复出的历史上下文。",
      "这些内容用于在 ACP 后端 session 无法恢复时帮助你接续对话。",
      "不要逐字复述历史，除非用户要求。",
      "",
      body.length > maxChars ? body.slice(-maxChars) : body,
    ].join("\n");
  }
}
```

### 修改 `RuntimePromptInput`

```ts
export type RuntimePromptInput = {
  text: string;
  attachments?: StoredAttachment[];
  restoreContext?: string | null;
};
```

### Runtime 中增加字段

```ts
private sessionStartup: AcpSessionStartupResult | null = null;
private restoreContextInjected = false;
```

在 `ensureStarted()` 中保存：

```ts
const sessionResult = await this.startSession(connection, cwd, initResult);
this.sessionStartup = sessionResult;
```

在 `send()` 中构造 prompt 前：

```ts
let text = runtimeInput.text;

if (
  this.sessionStartup &&
  !this.sessionStartup.restored &&
  !this.restoreContextInjected &&
  runtimeInput.restoreContext?.trim()
) {
  text = [
    runtimeInput.restoreContext.trim(),
    "",
    "现在用户的新消息是：",
    runtimeInput.text,
  ].join("\n\n");

  this.restoreContextInjected = true;
}

const prompt = await this.buildPromptBlocks({
  ...runtimeInput,
  text,
});
```

### 修改 `ConversationService.sendMessage()`

现在 user message 是先落库的，所以 build context 时要排除当前这条 user message：

```ts
const userMessage = this.repo.addMessage(...);

const restoreContext = this.memoryContext.buildRestoreContext({
  conversationId: conversation.id,
  beforeSequence: userMessage.sequence,
  maxMessages: 20,
  maxChars: 12000,
});

await runtime.send({
  text: input.content,
  attachments,
  restoreContext,
});
```

### 效果

```txt
1. ACP session 成功恢复：不注入历史，避免重复上下文。
2. ACP session 不支持恢复：新 session 第一轮自动带历史摘要。
3. ACP session 资源丢失：fallback new session 后也能接续上下文。
4. 新 conversation 没历史：restoreContext 为 null，不影响新会话。
```

提交信息：

```txt
feat: 增加会话历史上下文兜底恢复
```

---

## 阶段五：持久化 MCP server 快照

### 目标

重启后恢复同一个会话的工具环境。

### schema 新增表

```sql
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
  PRIMARY KEY (conversation_id, server_id, arg_index)
);

CREATE TABLE IF NOT EXISTS conversation_mcp_server_env (
  conversation_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (conversation_id, server_id, name)
);
```

### Repository 新增

```ts
replaceConversationMcpServers(conversationId: string, servers: McpServer[]): void;
listConversationMcpServers(conversationId: string): McpServer[];
```

### Service 改造

创建会话时：

```ts
if (input.mcpServers?.length) {
  this.repo.replaceConversationMcpServers(conversation.id, input.mcpServers);
  this.mcpServers.set(conversation.id, input.mcpServers);
}
```

创建 runtime 时：

```ts
private getConversationMcpServers(conversationId: string): any[] {
  const memory = this.mcpServers.get(conversationId);
  if (memory) return memory;

  const persisted = this.repo.listConversationMcpServers(conversationId);
  if (persisted.length) {
    this.mcpServers.set(conversationId, persisted);
  }

  return persisted;
}
```

提交信息：

```txt
feat: 持久化会话 MCP 配置快照
```

---

## 阶段六：持久化 commands / model list / mode list 快照

### 目标

重启后不启动 runtime，也能显示上次可用命令、模型列表和 mode 列表。

### 建议表

```sql
CREATE TABLE IF NOT EXISTS conversation_commands (
  conversation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  input_schema TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, name)
);

CREATE TABLE IF NOT EXISTS conversation_models (
  conversation_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, model_id)
);

CREATE TABLE IF NOT EXISTS conversation_modes (
  conversation_id TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, mode_id)
);
```

`input_schema` 可以保留 JSON，因为这是动态 schema，不参与核心业务判断。

### Service 改造

`runtime.on('commands')`：

```ts
this.commandSnapshots.set(conversation.id, snapshot);
this.repo.replaceConversationCommands(
  conversation.id,
  snapshot.commands,
  snapshot.updatedAt,
);
this.events.emit("conversation.commands", snapshot);
```

`commands(conversationId)`：

```ts
const memory = this.commandSnapshots.get(conversationId);
if (memory) return memory;

const persisted = this.repo.listConversationCommands(conversationId);
if (!persisted.length) return null;

return {
  conversationId,
  commands: persisted,
  updatedAt: Math.max(...persisted.map((item) => item.updatedAt)),
};
```

models/modes 同理。

提交信息：

```txt
feat: 持久化会话配置快照
```

---

## 阶段七：把 agent_events 投影成统一时间线

### 目标

不一定要把 thinking/tool/permission 复制进 `messages` 表，但前端应该有一个统一 timeline，可以像 AionUi 那样恢复思考、工具调用、权限确认过程。

### 推荐方案

不要直接把 agent_events 复制到 messages，而是新增组合接口：

```txt
conversation.timeline
```

### Service 新增

```ts
timeline(conversationId: string): ConversationTimelineItem[] {
  const messages = this.messages(conversationId);
  const events = this.agentEvents(conversationId, 500);

  return mergeMessagesAndAgentEvents(messages, events);
}
```

### Timeline 类型

```ts
export type ConversationTimelineItem =
  | { kind: "message"; message: ChatMessage; sequence: number; at: number }
  | { kind: "thinking"; event: AgentEvent; sequence: number; at: number }
  | { kind: "plan"; event: AgentEvent; sequence: number; at: number }
  | { kind: "tool"; event: AgentEvent; sequence: number; at: number }
  | { kind: "permission"; event: AgentEvent; sequence: number; at: number }
  | { kind: "error"; event: AgentEvent; sequence: number; at: number };
```

### 排序策略

由于 messages 和 agent_events 各自有独立 sequence，建议加一个统一列：

```sql
ALTER TABLE messages ADD COLUMN timeline_sequence INTEGER;
ALTER TABLE agent_events ADD COLUMN timeline_sequence INTEGER;
```

再新增 repository 方法：

```ts
nextTimelineSequence(conversationId: string): number;
```

这样 UI 可以稳定还原“用户消息 -> thinking -> tool -> assistant delta -> done”的完整过程。

提交信息：

```txt
feat: 增加会话统一时间线回放
```

---

## 阶段八：修复 usage 节流导致最终快照不落库的问题

现在 `handleUsageUpdate()` 会 1 秒节流；如果最后一次 usage_update 被节流掉，Service 就不会持久化最新 usage。

### Runtime 增加强制 flush

```ts
private flushUsageSnapshot(): void {
  if (!this.usageSnapshot) return;
  this.lastUsageEmitAt = Date.now();
  this.emit('usage', this.usageSnapshot);
}
```

在以下位置调用：

```ts
prompt done 前
finalizeCancelledTurn() 前
catch failed 前
child exit 未完成 turn 前
```

提交信息：

```txt
fix: 确保最终 usage 快照持久化
```

---

# 4. 优先级建议

最应该先做这四个：

```txt
P0：启动时修复僵尸 running 状态
P0：session 恢复失败后注入历史上下文
P1：用持久化 sessionMode/currentModelId 启动 runtime
P1：持久化 MCP server 快照
```

commands/model list/mode list 快照和统一 timeline 可以放到下一轮。

---

# 5. 最终验收标准

完成后应该满足：

```txt
1. 应用在 running 中被关闭，重启后不会继续显示 running。
2. 重启后打开旧会话，messages 和 agent_events 都能恢复。
3. 如果 ACP session/load 成功，模型继续使用原 ACP session。
4. 如果 ACP session/load 失败或 bridge 不支持恢复，下一条消息会自动带上历史上下文。
5. 重启后继续使用上次选择的 model 和 mode，而不是默认值。
6. 重启后 MCP 工具环境不丢。
7. 取消后的 assistant 已输出内容保留，last_stop_reason = cancelled。
8. usage 最终值能稳定落库。
9. npm run typecheck 通过。
10. npm test 通过。
```

一句话总结：

> `feat/memory` 现在已经完成了“持久化记录”和“尝试恢复 ACP session”；下一步要补的是“进程级恢复兜底”：重启时修正僵尸状态、用持久化 mode/model/MCP 重新启动 runtime，并在 ACP session 无法恢复时，把本地历史消息压缩成上下文注入新 session。
