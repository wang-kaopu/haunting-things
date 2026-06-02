# 权限模式默认值与前端选择器编码方案

## 目标

实现两个功能：

1. Claude 启动 ACP session 后默认切换到 `default` 权限模式，Codex 启动 ACP session 后默认切换到 `auto` 权限模式。
2. 在聊天输入框工具栏中，模型、权限模式和可用命令都使用直接可见的下拉选择组件；命令下拉选中后会在消息框最前面插入 `/{command_name} `。

## 实现状态

已实现。当前版本新增了 `conversation.setMode` bridge 调用链，`AcpRuntime` 在 `newSession` 和可选模型切换后会按 backend 默认调用 `setSessionMode()`：Claude 使用 `default`，Codex 使用 `auto`。聊天输入框工具栏会直接展示模型、权限模式和可用命令下拉选择器。

权限模式仍按运行时状态处理，不写入数据库；模型切换导致 runtime 重启后会重新回到该 backend 的默认权限模式。如果某个 ACP bridge 不支持指定 mode，后端会抛出 `Current ACP bridge does not support session mode switching` 或 bridge 自身错误，前端选择器会在下拉组件下方展示错误。

模型列表和可用命令都按 backend 写入 renderer 本地缓存；切换 Agent 时如果服务端暂时没有运行时快照，会先用缓存填充工具栏。空模型/命令快照不会覆盖已有缓存，避免 runtime 重启时把上一次有效列表清掉。

后端会按 backend 校验允许的 mode id，防止把另一个 backend 的权限模式透传给当前会话：

| Backend | 允许的 mode id |
| ------- | -------------- |
| Claude | `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions` |
| Codex | `read-only`, `auto`, `full-access` |

## 一、整体设计

### 1. 后端新增能力

新增 `conversation.setMode` 调用链：

```text
前端 PermissionModePicker
  -> bridge.invoke('conversation.setMode', { conversationId, mode })
  -> registerBridgeHandlers
  -> ConversationService.setMode()
  -> AcpRuntime.setSessionMode()
  -> ACP bridge setSessionMode
  -> bridge 上报 current_mode_update
  -> ConversationService 缓存 mode snapshot
  -> WebSocket 推送 conversation.mode
  -> 前端 UI 更新
```

### 2. 默认模式策略

按 backend 选择默认权限模式：

```ts
claude: 'default';
codex: 'auto';
```

启动顺序建议：

```text
initialize
-> newSession
-> handleNewSessionModels
-> setSessionModel，如果用户选择了模型
-> setSessionMode(getStartupMode())
```

原因：某些 bridge 的可用 mode 可能和模型有关，先设置模型再切 mode 更稳。

### 3. 前端展示策略

在当前：

```tsx
<ModelPicker ... />
```

右边新增：

```tsx
<PermissionModePicker ... />
```

原来的只读：

```tsx
<span className="mode-chip">模式：{mode.mode}</span>
```

可以删除，或者改为由 `PermissionModePicker` 内部显示当前模式。

---

## 二、类型定义改造

### 1. 新增权限模式类型

修改：

```text
src/shared/types/conversation.ts
```

新增：

```ts
/** ACP 权限模式。 */
export type PermissionModeId =
  | "read-only"
  | "auto"
  | "full-access"
  | "bypassPermissions"
  | string;
```

然后修改 `ConversationMode`：

```ts
/** Conversation 的实时模式快照。 */
export type ConversationMode = {
  conversationId: string;
  mode: PermissionModeId;
  updatedAt: number;
};
```

保留 `string` 兜底是为了兼容不同 ACP bridge 的 mode id。

### 2. 扩展 InvokeMap

修改：

```text
src/shared/types/bridge.ts
```

在 `InvokeMap` 中新增：

```ts
'conversation.setMode': {
  params: { conversationId: string; mode: string };
  result: ConversationMode;
};
```

位置建议放在：

```ts
"conversation.setModel";
```

后面，和 `conversation.mode` 保持语义接近。

---

## 三、AcpRuntime 改造

修改：

```text
src/server/runtime/acpRuntime.ts
```

### 1. 添加默认启动模式

在类中新增：

```ts
private getStartupMode(): string {
  switch (this.input.backend) {
    case 'claude':
      return 'default';
    case 'codex':
      return 'auto';
    default:
      return 'auto';
  }
}
```

### 2. 在 ensureStarted 中设置默认模式

当前 `ensureStarted()` 已经在 `newSession` 后调用了：

```ts
this.handleNewSessionModels(sessionResult);

if (this.input.model?.trim()) {
  await this.setSessionModel(this.input.model.trim());
}
```

在其后追加：

```ts
await this.setSessionMode(this.getStartupMode());
```

完整逻辑：

```ts
this.handleNewSessionModels(sessionResult);

if (this.input.model?.trim()) {
  await this.setSessionModel(this.input.model.trim());
}

await this.setSessionMode(this.getStartupMode());
```

### 3. 新增 setSessionMode 方法

参考已有 `setSessionModel()` 的写法，新增：

```ts
async setSessionMode(mode: string): Promise<ConversationMode> {
  const modeId = mode.trim();
  if (!modeId) throw new Error('mode is required');

  await this.ensureStarted();

  if (!this.connection || !this.sessionId) {
    throw new Error('ACP session is not ready');
  }

  const connection = this.connection as ClientSideConnection & {
    unstable_setSessionMode?: (params: { sessionId: string; modeId: string }) => Promise<unknown>;
    setSessionMode?: (params: { sessionId: string; modeId: string }) => Promise<unknown>;
    setSessionConfigOption?: (params: {
      sessionId: string;
      configId: string;
      optionId: string;
    }) => Promise<unknown>;
  };

  const setMode =
    connection.unstable_setSessionMode ??
    connection.setSessionMode;

  if (typeof setMode === 'function') {
    await this.runConnectionRequest(() =>
      setMode.call(connection, {
        sessionId: this.sessionId!,
        modeId,
      })
    );
  } else if (typeof connection.setSessionConfigOption === 'function') {
    await this.runConnectionRequest(() =>
      connection.setSessionConfigOption!.call(connection, {
        sessionId: this.sessionId!,
        configId: 'mode',
        optionId: modeId,
      })
    );
  } else {
    throw new Error('Current ACP bridge does not support session mode switching');
  }

  const snapshot: ConversationMode = {
    conversationId: this.input.conversationId,
    mode: modeId,
    updatedAt: Date.now(),
  };

  this.modeSnapshot = snapshot;
  this.emit('mode', snapshot);

  return snapshot;
}
```

注意点：

- 方法需要是 `public`，因为 `ConversationService` 要调用。
- 内部先 `ensureStarted()`，这样用户在未发送第一条消息前切换权限模式时，也能自动启动 runtime。
- 同时兼容 `unstable_setSessionMode`、`setSessionMode`、`setSessionConfigOption(configId: 'mode')` 三种可能接口。

### 4. 修正 mode update 字段兼容

当前 `handleCurrentModeUpdate()` 建议补充对 `currentModeId` / `current_mode_id` 的读取。

修改为：

```ts
private handleCurrentModeUpdate(update: Record<string, unknown>): void {
  const mode =
    this.readString(update.currentModeId) ??
    this.readString(update.current_mode_id) ??
    this.readString(update.mode) ??
    this.readString(update.currentMode) ??
    this.readString(update.current_mode) ??
    this.readString(update.name);

  if (!mode) return;

  const snapshot: ConversationMode = {
    conversationId: this.input.conversationId,
    mode,
    updatedAt: Date.now(),
  };

  this.modeSnapshot = snapshot;
  this.emit('mode', snapshot);
}
```

---

## 四、ConversationService 改造

修改：

```text
src/server/services/conversationService.ts
```

### 1. 新增 setMode 方法

新增：

```ts
async setMode(input: { conversationId: string; mode: string }): Promise<ConversationMode> {
  const conversation = this.repo.getConversation(input.conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);

  const mode = input.mode.trim();
  if (!mode) throw new Error('mode is required');

  this.logger.info('conversation_mode_set', {
    conversationId: conversation.id,
    backend: conversation.backend,
    mode,
  });

  const runtime = this.getRuntime(conversation);
  const snapshot = await runtime.setSessionMode(mode);

  this.modeSnapshots.set(conversation.id, snapshot);
  this.events.emit('conversation.mode', snapshot);

  return snapshot;
}
```

### 2. 不建议持久化 mode

第一版建议不把 mode 写入数据库。

理由：

- 本需求是“启动时使用 backend 默认权限模式”，不是“每个会话记住上次权限模式”。
- 权限模式属于运行时状态，强持久化后容易出现重启后误进入YOLO模式的问题。
- UI 切换只影响当前 runtime session，更安全。

如果后续确实要记忆用户选择，可以单独加配置项，例如 `preferredPermissionMode`，并且只允许保存普通权限模式，不默认保存 YOLO 模式。

---

## 五、Bridge Handler 改造

修改：

```text
src/server/app/bridge/registerBridgeHandlers.ts
```

新增：

```ts
bridge.register("conversation.setMode", (params) =>
  conversations.setMode(params),
);
```

建议放在：

```ts
bridge.register('conversation.setModel', ...)
```

后面：

```ts
bridge.register("conversation.create", (params) =>
  conversations.create(params),
);
bridge.register("conversation.setModel", (params) =>
  conversations.setModel(params),
);
bridge.register("conversation.setMode", (params) =>
  conversations.setMode(params),
);
bridge.register("conversation.list", () => conversations.list());
```

---

## 六、前端状态流改造

### 1. ChatLayout 增加 onSetMode

修改：

```text
src/renderer/features/chat/ChatLayout.tsx
```

Props 新增：

```ts
onSetMode: (mode: string) => Promise<void>;
onSelectCommand: (commandName: string) => void;
```

传给 `SendBox`：

```tsx
<SendBox
  disabled={!team || !activeAgent}
  activeAgent={activeAgent}
  usage={usage}
  commands={commands}
  models={models}
  mode={mode}
  onSend={onSendMessage}
  onSetModel={onSetModel}
  onSetMode={onSetMode}
/>
```

### 2. SendBox 增加 onSetMode

修改：

```text
src/renderer/features/chat/components/SendBox.tsx
```

Props 新增：

```ts
onSetMode: (mode: string) => Promise<void>;
```

传给 `ComposerTools`：

```tsx
<ComposerTools
  activeAgent={activeAgent}
  usage={usage}
  commands={commands}
  models={models}
  mode={mode}
  onSetModel={onSetModel}
  onSetMode={onSetMode}
  onSelectCommand={insertCommand}
  imagePicker={...}
/>
```

### 3. ComposerTools 新增 PermissionModePicker

修改：

```text
src/renderer/features/chat/components/ComposerTools.tsx
```

新增 import：

```ts
import { PermissionModePicker } from "./PermissionModePicker";
```

Props 新增：

```ts
onSetMode: (mode: string) => Promise<void>;
onSelectCommand: (commandName: string) => void;
```

渲染改成：

```tsx
<div className="composer-tools">
  <ModelPicker agent={activeAgent} models={models} onSetModel={onSetModel} />
  <PermissionModePicker agent={activeAgent} mode={mode} onSetMode={onSetMode} />
  {imagePicker}
  <UsageChip usage={usage} />
  <AgentCommandsMenu commands={commands} disabled={disabled} onSelectCommand={onSelectCommand} />
</div>
```

删除原来的：

```tsx
{
  mode?.mode ? <span className="mode-chip">模式：{mode.mode}</span> : null;
}
```

---

## 七、新增 PermissionModePicker 组件

新增文件：

```text
src/renderer/features/chat/components/PermissionModePicker.tsx
```

建议实现：

```tsx
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type { ConversationMode, TeamAgent } from "../../../../shared/types";

type PermissionModeOption = {
  id: string;
  label: string;
  description: string;
  danger?: boolean;
};

const CLAUDE_MODE_OPTIONS: PermissionModeOption[] = [
  {
    id: "default",
    label: "default",
    description: "Claude Code 标准权限行为，危险操作会请求确认。",
  },
  {
    id: "acceptEdits",
    label: "acceptEdits",
    description: "自动接受文件编辑操作，其他高风险操作仍按权限策略处理。",
  },
  {
    id: "plan",
    label: "plan",
    description: "规划模式，不执行实际工具操作。",
  },
  {
    id: "dontAsk",
    label: "dontAsk",
    description: "不弹权限确认，未预批准的工具会直接拒绝。",
  },
  {
    id: "bypassPermissions",
    label: "bypassPermissions",
    description: "跳过权限确认，仅建议在隔离环境中使用。",
    danger: true,
  },
];

const CODEX_MODE_OPTIONS: PermissionModeOption[] = [
  {
    id: "read-only",
    label: "read-only",
    description: "只允许读取和分析。",
  },
  {
    id: "auto",
    label: "auto",
    description: "默认推荐。允许在工作区内自动执行常见开发操作。",
  },
  {
    id: "full-access",
    label: "full-access",
    description: "YOLO模式，仅建议在可信工作区或隔离环境中使用。",
    danger: true,
  },
];

export type PermissionModePickerProps = {
  agent?: TeamAgent | null;
  mode?: ConversationMode | null;
  onSetMode: (mode: string) => Promise<void>;
};

export function PermissionModePicker({
  agent,
  mode,
  onSetMode,
}: PermissionModePickerProps): React.ReactElement {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const options = useMemo(() => {
    if (agent?.backend === "claude") return CLAUDE_MODE_OPTIONS;
    if (agent?.backend === "codex") return CODEX_MODE_OPTIONS;
    return [];
  }, [agent?.backend]);

  const fallbackMode = agent?.backend === "claude" ? "default" : "auto";
  const current = mode?.mode || fallbackMode;
  const currentOption = options.find((item) => item.id === current);

  useEffect(() => {
    setError("");
  }, [agent?.conversationId]);

  async function submit(nextMode: string): Promise<void> {
    if (!agent || submitting || nextMode === current) {
      return;
    }

    const option = options.find((item) => item.id === nextMode);
    if (option?.danger) {
      const confirmed = window.confirm(
        `确定要切换到「${option.label}」吗？该模式会放宽权限限制，建议只在隔离环境中使用。`,
      );
      if (!confirmed) return;
    }

    try {
      setSubmitting(true);
      setError("");
      await onSetMode(nextMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="permission-mode-picker">
      <label className="toolbar-select-label">
        <span>权限</span>
        <select
          className="toolbar-select permission-mode-select"
          value={current}
          disabled={!agent || options.length === 0 || submitting}
          title={currentOption?.description}
          onChange={(event) => {
            void submit(event.target.value);
          }}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          {!options.some((option) => option.id === current) ? (
            <option value={current}>{current}</option>
          ) : null}
        </select>
      </label>
      {error ? <p className="error-text compact toolbar-select-error">{error}</p> : null}
    </div>
  );
}
```

说明：

- Claude YOLO 模式使用 `bypassPermissions`。
- Codex YOLO 模式使用 `full-access`。
- Claude 默认展示 `default`，Codex 默认展示 `auto`，即使 bridge 暂时还没上报 mode，也不会显示空状态。
- YOLO 模式加 `window.confirm` 二次确认，避免误点。

---

## 八、调用层接入 onSetMode

需要找到当前给 `ChatLayout` 传 `onSetModel` 的页面组件，大概率是主 Workbench / App 页面。

增加函数：

```ts
async function setActiveAgentMode(mode: string): Promise<void> {
  if (!activeAgent?.conversationId) return;

  await bridge.invoke("conversation.setMode", {
    conversationId: activeAgent.conversationId,
    mode,
  });
}
```

传入：

```tsx
<ChatLayout
  ...
  onSetModel={setActiveAgentModel}
  onSetMode={setActiveAgentMode}
/>
```

如果当前状态里有 `runtimeSnapshots` 或类似 hook 维护 `conversation.mode`，无需额外手动 setState，等待服务端推送即可。

---

## 九、权限模式 ID 映射建议

### Claude

| UI 文案 | mode id             | 说明     |
| ------- | ------------------- | -------- |
| default | `default`           | 默认模式 |
| acceptEdits | `acceptEdits`   | 自动接受编辑 |
| plan | `plan`                 | 规划模式 |
| dontAsk | `dontAsk`           | 不询问并拒绝未预批准工具 |
| bypassPermissions | `bypassPermissions` | 跳过确认 |

### Codex

| UI 文案 | mode id       | 说明     |
| ------- | ------------- | -------- |
| read-only | `read-only`   | 只读     |
| auto    | `auto`        | 默认模式 |
| full-access | `full-access` | 跳过确认 |

不要把 Codex 的 `auto-review` 当成 ACP mode。若后续需要“自动 review”，应做成应用层 preset：

```text
setMode('auto')
-> sendRuntimePrompt('/review')
```

---

## 十、异常与边界处理

### 1. bridge 不支持 setSessionMode

如果 bridge 不支持 mode 切换，后端抛出：

```ts
Current ACP bridge does not support session mode switching
```

前端在小组件里展示错误。

### 2. mode 上报滞后

`setSessionMode()` 调用成功后，后端应立即构造本地 `ConversationMode` 快照并 emit。这样 UI 不需要等待 bridge 的异步 `current_mode_update`。

### 3. 模型切换后 runtime 重启

当前模型切换会重启 runtime。重启后 `ensureStarted()` 会再次执行：

```text
setSessionModel(...)
setSessionMode(getStartupMode())
```

因此模型切换后会回到该 backend 的默认模式。

这是符合本需求的：“Claude 默认 default，Codex 默认 auto”。

### 4. 不默认进入 YOLO 模式

即使用户上次选过 `full-access` 或 `bypassPermissions`，下次 runtime 启动仍回到 backend 默认权限模式。

---

## 十一、测试方案

### 1. AcpRuntime 单元测试

新增或扩展：

```text
tests/acpRuntimeModels.test.ts
```

测试点：

- `ensureStarted()` 后会调用 `setSessionMode(getStartupMode())`。
- 如果设置了模型，调用顺序是：
  1. `setSessionModel(model)`
  2. `setSessionMode(getStartupMode())`

- `setSessionMode('plan')` 会 emit `mode` 快照。
- `current_mode_update` 支持读取 `currentModeId`。

### 2. ConversationService 测试

测试点：

- `conversation.setMode` 会调用 runtime 的 `setSessionMode`。
- 成功后会更新 `modeSnapshots`。
- 成功后会 emit `conversation.mode`。

### 3. 前端组件测试

测试点：

- Claude agent 展示 `default / acceptEdits / plan / dontAsk / bypassPermissions`。
- Codex agent 展示 `read-only / auto / full-access`。
- 下拉切换后调用 `onSetMode(mode)`。
- 命令下拉选中后在消息框最前面插入 `/{command_name} `。
- YOLO 模式触发二次确认。
- 没有 activeAgent 时下拉组件 disabled。

---

## 十二、建议提交信息

```text
feat: 添加权限模式选择并设置后端默认模式
```

---

## 十三、实施顺序

1. 改 `ConversationMode` 类型，新增 `conversation.setMode` invoke 类型。
2. 给 `AcpRuntime` 增加 `setSessionMode()`。
3. 在 `ensureStarted()` 中默认调用 `setSessionMode(getStartupMode())`。
4. 给 `ConversationService` 增加 `setMode()`。
5. 在 `registerBridgeHandlers.ts` 注册 `conversation.setMode`。
6. 新增 `PermissionModePicker.tsx`。
7. 在 `ComposerTools` 中放到 `ModelPicker` 右边。
8. 沿 `ChatLayout -> SendBox -> ComposerTools` 传递 `onSetMode`。
9. 在页面层实现 `bridge.invoke('conversation.setMode')`。
10. 补充测试。
