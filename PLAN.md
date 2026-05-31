检查当前代码后，这两个问题都成立：

`logger.ts` 现在固定输出 `JSON.stringify(payload)`，所以日志天然是单行 JSON，可读性差。
`index.ts` 只在 `server_listening`、重置密码、初始密码等少数地方打日志，WebBridge 注册的大量业务 API 没有统一入口日志。
`WebBridge.handleMessage()` 现在只负责调用 handler 和返回结果，成功/失败都没有记录调用名、耗时、错误。
`TeamService` 里创建 Team、添加 Agent、投递消息、唤醒 Agent、停止 Team 等关键业务流程也没有 logger。   

## 总体改法

不要把日志改回零散 `console.log`，而是把现有 logger 升级成：

```text
开发环境：默认输出易读 pretty log
生产环境：可切换 JSON log
业务调用：统一在 WebBridge 入口记录 invoke start / success / error
核心异步流程：在 TeamService / ConversationService / AcpRuntime 内补少量关键日志
```

这样既解决可读性，也解决业务调用不可追踪。

---

## 1. 改造 `logger.ts`：支持 pretty / json 两种格式

当前 logger 只有 JSON 输出。建议增加 `LOG_FORMAT`：

```text
LOG_FORMAT=pretty  本地开发默认，易读
LOG_FORMAT=json    生产/采集系统使用
```

改 `src/server/logger.ts`：

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;
type LogFormat = 'pretty' | 'json';

class Logger {
  constructor(private readonly scope: string) {}

  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') return;

    const payload = {
      time: new Date().toISOString(),
      level,
      scope: this.scope,
      event,
      ...sanitizeLogFields(fields),
    };

    const format = getLogFormat();
    const line = format === 'json' ? JSON.stringify(payload) : formatPrettyLog(payload);

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'debug') console.debug(line);
    else console.log(line);
  }
}

function getLogFormat(): LogFormat {
  if (process.env.LOG_FORMAT === 'json') return 'json';
  if (process.env.LOG_FORMAT === 'pretty') return 'pretty';

  // 本地开发默认 pretty，生产可以显式 LOG_FORMAT=json
  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
}

function formatPrettyLog(payload: Record<string, unknown>): string {
  const time = String(payload.time ?? '').slice(11, 19);
  const level = String(payload.level ?? 'info').toUpperCase().padEnd(5);
  const scope = String(payload.scope ?? 'app');
  const event = String(payload.event ?? 'event');

  const fields = Object.entries(payload)
    .filter(([key]) => !['time', 'level', 'scope', 'event'].includes(key))
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');

  return fields
    ? `[${time}] ${level} ${scope} ${event} ${fields}`
    : `[${time}] ${level} ${scope} ${event}`;
}

function formatValue(value: unknown): string {
  if (value == null) return String(value);

  if (typeof value === 'string') {
    if (value.length > 160) return JSON.stringify(`${value.slice(0, 157)}...`);
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    const text = JSON.stringify(value);
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  } catch {
    return '[unserializable]';
  }
}
```

效果从：

```json
{"time":"2026-05-31T10:12:33.100Z","level":"info","scope":"server","event":"server_listening","host":"127.0.0.1","port":14567}
```

变成：

```text
[10:12:33] INFO  server server_listening host="127.0.0.1" port=14567
```

需要机器解析时再用：

```bash
LOG_FORMAT=json npm start
```

---

## 2. 给 `WebBridge` 加统一业务调用日志

这是最划算的改动。因为大部分前端业务调用都会经过 `bridge.register(...)`。现在 `WebBridge` 只调用 handler，不记录成功、失败、耗时。

改 `src/server/webBridge.ts`：

```ts
import { createLogger } from './logger';

export class WebBridge {
  private readonly handlers = new Map<string, BridgeHandler<any>>();
  private readonly logger = createLogger('bridge');

  // existing...
}
```

在 `handleMessage()` 中加调用日志：

```ts
private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
  let message: BridgeClientMessage;

  try {
    message = JSON.parse(raw);
  } catch {
    this.logger.warn('invalid_message_json', {
      size: raw.length,
    });
    return;
  }

  if (message.type !== 'invoke') return;

  const handler = this.handlers.get(message.name);
  if (!handler) {
    this.logger.warn('invoke_unknown', {
      invokeId: message.id,
      name: message.name,
    });

    this.send(socket, {
      id: message.id,
      type: 'result',
      name: message.name,
      error: `Unknown API: ${message.name}`,
    });
    return;
  }

  const startedAt = Date.now();

  this.logger.info('invoke_start', {
    invokeId: message.id,
    name: message.name,
    params: summarizeInvokeParams(message.name, message.data),
  });

  try {
    const data = await handler(message.data as never);
    this.logger.info('invoke_success', {
      invokeId: message.id,
      name: message.name,
      ms: Date.now() - startedAt,
      result: summarizeInvokeResult(message.name, data),
    });

    this.send(socket, {
      id: message.id,
      type: 'result',
      name: message.name,
      data,
    } as BridgeResultMessage);
  } catch (error) {
    this.logger.warn('invoke_error', {
      invokeId: message.id,
      name: message.name,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });

    this.send(socket, {
      id: message.id,
      type: 'result',
      name: message.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

再加摘要函数，避免把 prompt、密码、完整消息刷到日志里：

```ts
function summarizeInvokeParams(name: string, data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const input = data as Record<string, unknown>;

  switch (name) {
    case 'conversation.sendMessage':
    case 'team.sendMessage':
    case 'team.sendMessageToAgent':
      return {
        ...pick(input, ['conversationId', 'teamId', 'slotId']),
        contentLength: typeof input.content === 'string' ? input.content.length : undefined,
        filesCount: Array.isArray(input.files) ? input.files.length : 0,
      };

    case 'conversation.setModel':
    case 'team.setAgentModel':
      return pick(input, ['conversationId', 'teamId', 'slotId', 'model']);

    case 'conversation.confirmPermission':
      return pick(input, ['conversationId', 'callId', 'optionId']);

    case 'team.create':
      return pick(input, ['name', 'workspace', 'leaderBackend', 'leaderModel']);

    case 'team.addAgent':
      return pick(input, ['teamId', 'name', 'backend', 'model']);

    default:
      return redactObject(input);
  }
}

function summarizeInvokeResult(name: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;

  if (Array.isArray(result)) {
    return { count: result.length };
  }

  const output = result as Record<string, unknown>;

  switch (name) {
    case 'conversation.create':
      return pick(output, ['id', 'backend', 'model', 'status']);

    case 'team.create':
      return pick(output, ['id', 'name', 'leaderSlotId']);

    case 'team.addAgent':
      return pick(output, ['slotId', 'conversationId', 'backend', 'model', 'status']);

    default:
      return summarizeObject(output);
  }
}

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in input).map((key) => [key, input[key]]));
}

function summarizeObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value === 'string' && value.length > 160) {
        return [key, `${value.slice(0, 157)}...`];
      }
      if (Array.isArray(value)) {
        return [key, { count: value.length }];
      }
      return [key, value];
    })
  );
}

function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(['password', 'currentPassword', 'newPassword', 'token', 'authorization']);
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      blocked.has(key) ? '***' : value,
    ])
  );
}
```

这样无需在每个 `bridge.register(...)` 外层手写日志，就能覆盖 `conversation.sendMessage`、`team.create`、`team.addAgent`、`team.sendMessage` 等大多数业务调用。

---

## 3. 给 `TeamService` 补关键异步流程日志

WebBridge 只能记录“前端调用”。但 Team 内部还有很多异步动作，不会从 WebBridge 触发，比如：

```text
deliver → scheduleWakeAgent → runWakeCycle → wakeAgent
teammate reply.done 自动回流 leader
MCP session start/stop/restart
```

这些现在基本没有日志。`TeamService` 当前也没有引入 logger。

加：

```ts
import { createLogger } from './logger';
```

类字段：

```ts
private readonly logger = createLogger('team');
```

### 3.1 Team 创建 / 添加 / 删除

```ts
async create(input: {...}): Promise<Team> {
  this.logger.info('team_create_start', {
    name: input.name,
    leaderBackend: input.leaderBackend,
    leaderModel: input.leaderModel,
    hasWorkspace: Boolean(input.workspace),
  });

  const team = this.repo.createTeam(...);

  await this.ensureSession(team.id);

  this.logger.info('team_create_done', {
    teamId: team.id,
    leaderSlotId: leader.slotId,
    workspace: team.workspace,
  });

  return team;
}
```

`addAgent()` 里：

```ts
this.logger.info('agent_add_start', {
  teamId: input.teamId,
  name: input.name,
  backend: input.backend,
  model: input.model,
});

this.logger.info('agent_add_done', {
  teamId: updated.id,
  slotId: agent.slotId,
  conversationId: agent.conversationId,
});
```

### 3.2 deliver / wake 日志

`deliver()` 是 Team 消息流关键点。现在只写 mailbox、emit 前端、排队唤醒。

补：

```ts
private async deliver(message: MailboxMessage): Promise<void> {
  const team = this.requireTeam(message.teamId);
  await this.ensureSession(team.id);

  this.logger.info('mailbox_deliver', {
    teamId: message.teamId,
    messageId: message.id,
    fromAgentId: message.fromAgentId,
    toAgentId: message.toAgentId,
    contentLength: message.content.length,
  });

  // existing...
}
```

`scheduleWakeAgent()`：

```ts
private scheduleWakeAgent(teamId: string, slotId: string): void {
  const key = `${teamId}:${slotId}`;

  if (this.pendingWakeups.has(key) || this.activeWakeups.has(key)) {
    this.logger.debug('wake_skip_already_queued', { teamId, slotId });
    return;
  }

  this.logger.debug('wake_scheduled', { teamId, slotId });

  // existing...
}
```

`runWakeCycle()`：

```ts
private async runWakeCycle(teamId: string, slotId: string): Promise<void> {
  const startedAt = Date.now();
  const key = `${teamId}:${slotId}`;

  if (this.activeWakeups.has(key)) {
    this.logger.debug('wake_skip_active', { teamId, slotId });
    return;
  }

  this.activeWakeups.add(key);

  try {
    this.logger.info('wake_start', { teamId, slotId });
    await this.wakeAgent(teamId, slotId);
    this.logger.info('wake_done', {
      teamId,
      slotId,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    this.logger.warn('wake_failed', {
      teamId,
      slotId,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // existing...
  }
}
```

`wakeAgent()` 里记录 unread 数量。当前它会读未读消息后发送给 conversation。

```ts
const messages = this.repo.readUnreadAndMark(teamId, slotId);

this.logger.info('agent_prompt_send', {
  teamId,
  slotId,
  conversationId: agent.conversationId,
  unreadCount: messages.length,
  promptLength: content.length,
});
```

### 3.3 自动回流日志

`handleConversationAgentEvent()` 现在自动把 teammate 的 `agent.reply.done` 回流给 leader。

加日志：

```ts
if (alreadyReplied) {
  this.logger.debug('auto_reply_skip_explicit_reply', {
    teamId: team.id,
    slotId: agent.slotId,
    conversationId: event.conversationId,
    messageId: event.messageId,
  });
  return;
}

if (this.autoRepliedAssistantMessages.get(event.conversationId) === event.messageId) {
  this.logger.debug('auto_reply_skip_duplicate', {
    teamId: team.id,
    slotId: agent.slotId,
    messageId: event.messageId,
  });
  return;
}

this.logger.info('auto_reply_to_leader', {
  teamId: team.id,
  fromSlotId: agent.slotId,
  toSlotId: team.leaderSlotId,
  messageId: event.messageId,
  contentLength: content.length,
});
```

---

## 4. 给 `ConversationService` 补业务日志

`ConversationService` 现在只在 handler 失败时打日志。

补关键入口：

### 4.1 create

```ts
create(input: {...}): Conversation {
  const conversation = this.repo.createConversation(...);

  this.logger.info('conversation_create', {
    conversationId: conversation.id,
    backend: conversation.backend,
    model: conversation.model,
    workspace: conversation.workspace,
    hasMcpServers: Boolean(input.mcpServers?.length),
  });

  return conversation;
}
```

### 4.2 sendMessage

`sendMessage()` 当前写用户消息、emit stream、启动 runtime。

```ts
async sendMessage(input: { conversationId: string; content: string; files?: string[] }): Promise<void> {
  const startedAt = Date.now();
  const conversation = this.repo.getConversation(input.conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);

  this.logger.info('conversation_send_start', {
    conversationId: conversation.id,
    backend: conversation.backend,
    model: conversation.model,
    contentLength: input.content.length,
    filesCount: input.files?.length ?? 0,
  });

  // existing...

  try {
    const runtime = this.getRuntime(conversation);
    await runtime.send(input.content);

    this.logger.info('conversation_send_done', {
      conversationId: conversation.id,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    this.logger.warn('conversation_send_failed', {
      conversationId: conversation.id,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

### 4.3 runtime 创建

`getRuntime()` 首次创建 `AcpRuntime` 时打：

```ts
this.logger.info('runtime_create', {
  conversationId: conversation.id,
  backend: conversation.backend,
  model: conversation.model,
  workspace: conversation.workspace,
  mcpServerCount: this.mcpServers.get(conversation.id)?.length ?? 0,
});
```

### 4.4 setModel / stop

```ts
this.logger.info('conversation_model_set', {
  conversationId: conversation.id,
  previousModel: conversation.model,
  model,
});
```

`stop()`：

```ts
this.logger.info('conversation_stop', {
  conversationId,
  hadRuntime: this.runtimes.has(conversationId),
});
```

---

## 5. `AcpRuntime` 日志再补生命周期点

现在 `AcpRuntime` 已经有 `bridge_stderr`、`runtime_error`、未知 sessionUpdate 等日志。 

再补这些：

### 5.1 bridge 启动

在 `spawn` 后：

```ts
this.logger.info('bridge_start', {
  conversationId: this.input.conversationId,
  backend: this.input.backend,
  bridgePackage,
  cwd,
  model: this.input.model,
  mcpServerCount: this.input.mcpServers?.length ?? 0,
});
```

### 5.2 session 创建完成

`newSession` 后：

```ts
this.logger.info('session_new_done', {
  conversationId: this.input.conversationId,
  sessionId: this.sessionId,
});
```

### 5.3 prompt 开始 / 结束

在 `send()` 开始生成 `activeTurnId` 后：

```ts
this.logger.info('prompt_start', {
  conversationId: this.input.conversationId,
  turnId: this.activeTurnId,
  contentLength: content.length,
});
```

成功结束：

```ts
this.logger.info('prompt_done', {
  conversationId: this.input.conversationId,
  turnId: this.activeTurnId,
  status: 'idle',
  replyLength: this.assistantMessage?.content.length ?? 0,
});
```

失败 catch 已有 `runtime_error`，可以加 `turnId`：

```ts
this.logger.error('prompt_failed', {
  conversationId: this.input.conversationId,
  turnId: this.activeTurnId,
  error: message,
});
```

---

## 6. 避免业务日志刷屏：只记“边界事件”

这次不要给每个 `agent.reply.delta` 打日志，也不要给每个 WebSocket 广播打日志。原则是：

```text
记录：入口、出口、错误、状态转折、异步调度、外部进程生命周期
不记录：token delta、每条 WebSocket emit、每个 usage_update
```

推荐日志事件命名规范：

```text
模块_动作_阶段
```

例如：

```text
conversation_send_start
conversation_send_done
conversation_send_failed
team_create_start
team_create_done
agent_add_start
agent_add_done
mailbox_deliver
wake_scheduled
wake_start
wake_done
wake_failed
bridge_start
session_new_done
prompt_start
prompt_done
prompt_failed
invoke_start
invoke_success
invoke_error
```

---

## 7. 最小落地顺序

一次性改动按这个顺序做：

```text
1. logger.ts 支持 LOG_FORMAT=pretty/json。
2. WebBridge 加统一 invoke_start / invoke_success / invoke_error。
3. ConversationService 补 create/sendMessage/getRuntime/setModel/stop 日志。
4. TeamService 补 create/addAgent/deliver/wake/autoReply/restartSession/stop 日志。
5. AcpRuntime 补 bridge_start/session_new_done/prompt_start/prompt_done。
6. 确认敏感字段不直接输出：password、token、完整 content、rawInput。
```

---

## 推荐提交信息

```text
feat(logs): 增加可读日志格式与业务调用埋点
```

或者拆成两个提交：

```text
feat(logs): 支持 pretty/json 双日志格式
feat(logs): 增加桥接调用与 Team 业务日志
```

核心思路一句话：**logger 继续保留结构化能力，但本地默认 pretty；业务调用不要靠每个 handler 手写，先在 WebBridge 统一埋入口日志，再在 TeamService / ConversationService / AcpRuntime 补异步链路关键节点日志。**
