可以按最新代码做成：**`ChatLayout` 把当前团队成员传给 `MessageList`，`MessageList` 根据每条 assistant 消息的 `conversationId` 找到对应 Agent，再把 Agent 传给 `MessageBubble` 显示 Claude/Codex 图标。**

当前 `ChatLayout` 已经有 `team` 和 `activeAgent`，但传给 `MessageList` 的只有 `messages` 和 `activePhase`。
`MessageBubble` 目前只渲染角色文字 `formatMessageRole(message.role)`，没有任何 Agent 信息，所以它自己无法判断应该显示 Claude 还是 Codex。
不过 `ChatMessage` 有 `conversationId`，`TeamAgent` 也有 `conversationId` 和 `backend`，刚好可以对应起来。
目前后端类型里 `AgentBackend` 只有 `'claude' | 'codex'`，所以图标判断很简单。

## 1. 图标资源放这里

```txt
src/renderer/assets/icons/agents/
├── claude.svg
├── openai.svg
```

## 2. 新增图标映射工具

新建：

```txt
src/renderer/shared/utils/agentIcon.ts
```

内容：

```ts
import type { AgentBackend } from "../../../shared/types";
import claudeIcon from "../../assets/icons/agents/claude.svg";
import codexIcon from "../../assets/icons/agents/codex.svg";
import defaultIcon from "../../assets/icons/agents/default.svg";

const agentIconMap: Record<AgentBackend, string> = {
  claude: claudeIcon,
  codex: codexIcon,
};

export function getAgentIconSrc(backend?: AgentBackend): string {
  return backend ? (agentIconMap[backend] ?? defaultIcon) : defaultIcon;
}

export function getAgentIconAlt(backend?: AgentBackend): string {
  if (backend === "claude") return "Claude";
  if (backend === "codex") return "Codex";
  return "Assistant";
}
```

## 3. 修改 `ChatLayout.tsx`

把：

```tsx
<MessageList messages={messages} activePhase={activePhase} />
```

改成：

```tsx
<MessageList
  messages={messages}
  activePhase={activePhase}
  agents={team.agents}
  activeAgent={activeAgent}
/>
```

## 4. 修改 `MessageList.tsx`

把 props 改成：

```tsx
import type {
  AgentTurnPhase,
  ChatMessage,
  TeamAgent,
} from "../../../../shared/types";
```

```tsx
export type MessageListProps = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  agents?: TeamAgent[];
  activeAgent?: TeamAgent | null;
};
```

函数签名改成：

```tsx
export function MessageList({
  messages,
  activePhase,
  agents = [],
  activeAgent,
}: MessageListProps): React.ReactElement {
```

渲染消息的地方从：

```tsx
{
  messages.map((message) => (
    <MessageBubble
      key={message.id}
      message={message}
      activePhase={activePhase}
    />
  ));
}
```

改成：

```tsx
{
  messages.map((message) => {
    const assistantAgent =
      message.role === "assistant"
        ? (agents.find(
            (agent) => agent.conversationId === message.conversationId,
          ) ??
          activeAgent ??
          null)
        : null;

    return (
      <MessageBubble
        key={message.id}
        message={message}
        activePhase={activePhase}
        assistantAgent={assistantAgent}
      />
    );
  });
}
```

这样比只传 `activeAgent` 更稳，因为它是通过 `message.conversationId` 找真实归属 Agent。

## 5. 修改 `MessageBubble.tsx`

引入类型和工具：

```tsx
import type {
  AgentTurnPhase,
  ChatMessage,
  TeamAgent,
} from "../../../../shared/types";
import {
  getAgentIconAlt,
  getAgentIconSrc,
} from "../../../shared/utils/agentIcon";
```

props 改成：

```tsx
export type MessageBubbleProps = {
  message: ChatMessage;
  activePhase?: AgentTurnPhase;
  assistantAgent?: TeamAgent | null;
};
```

函数签名改成：

```tsx
export function MessageBubble({
  message,
  activePhase,
  assistantAgent,
}: MessageBubbleProps): React.ReactElement {
```

在 `content` 后面加：

```tsx
const showAssistantIcon = message.role === "assistant";
const assistantIconSrc = showAssistantIcon
  ? getAgentIconSrc(assistantAgent?.backend)
  : null;
const assistantIconAlt = showAssistantIcon
  ? getAgentIconAlt(assistantAgent?.backend)
  : "";
```

然后把原来的：

```tsx
<small>{formatMessageRole(message.role)}</small>
```

改成：

```tsx
<header className="message-role-row">
  {assistantIconSrc ? (
    <img
      className="message-agent-icon"
      src={assistantIconSrc}
      alt={assistantIconAlt}
      title={assistantAgent?.name ?? assistantIconAlt}
    />
  ) : null}
  <small>{formatMessageRole(message.role)}</small>
</header>
```

完整核心结构变成：

```tsx
export function MessageBubble({
  message,
  activePhase,
  assistantAgent,
}: MessageBubbleProps): React.ReactElement {
  const wrappedPrompt =
    message.role === "user" && isWrappedTeamPrompt(message.content);
  const content = getMessageFallbackText(message, activePhase);
  const showAssistantIcon = message.role === "assistant";
  const assistantIconSrc = showAssistantIcon
    ? getAgentIconSrc(assistantAgent?.backend)
    : null;
  const assistantIconAlt = showAssistantIcon
    ? getAgentIconAlt(assistantAgent?.backend)
    : "";

  return (
    <article
      className={`message ${message.role} ${message.status === "error" ? "error" : ""}`}
    >
      <header className="message-role-row">
        {assistantIconSrc ? (
          <img
            className="message-agent-icon"
            src={assistantIconSrc}
            alt={assistantIconAlt}
            title={assistantAgent?.name ?? assistantIconAlt}
          />
        ) : null}
        <small>{formatMessageRole(message.role)}</small>
      </header>

      {wrappedPrompt ? (
        <details className="debug-prompt-inline">
          <summary>历史包装 Prompt，已折叠</summary>
          <pre>{message.content}</pre>
        </details>
      ) : (
        <MarkdownMessage content={content} />
      )}

      {message.attachments?.length ? (
        <div className="message-attachments">
          {message.attachments.map((attachment) =>
            attachment.kind === "image" ? (
              <a
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                key={attachment.id}
              >
                <img src={attachment.url} alt={attachment.name} />
              </a>
            ) : null,
          )}
        </div>
      ) : null}

      {message.status === "error" ? (
        <p className="message-error">本轮回复失败，请查看通知详情。</p>
      ) : null}
    </article>
  );
}
```

## 6. 修改 `styles.css`

当前 `.message small` 是 block，会导致图标和角色文字不容易横向排列。
加上这段：

```css
.message-role-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  min-width: 0;
}

.message-role-row small {
  margin-bottom: 0;
}

.message-agent-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  object-fit: contain;
  border-radius: 4px;
}
```

然后把原来的：

```css
.message small {
  display: block;
  margin-bottom: 6px;
  color: var(--muted);
}
```

改成：

```css
.message small {
  display: block;
  color: var(--muted);
}
```

或者保留也行，但要用上面的 `.message-role-row small { margin-bottom: 0; }` 覆盖掉。

## 7. 最终效果

assistant 消息原来是：

```txt
Assistant

回复内容...
```

改完后是：

```txt
[Claude 图标] Assistant

回复内容...
```

或者：

```txt
[Codex 图标] Assistant

回复内容...
```

判断逻辑来自：

```txt
message.conversationId
  -> team.agents.find(agent.conversationId === message.conversationId)
  -> agent.backend
  -> claude.svg / codex.svg
```

推荐提交：

```bash
git add .
git commit -m "feat(chat): 为助手消息显示智能体图标"
```
