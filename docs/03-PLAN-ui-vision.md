# haunting-things GPT 风格 UI 编码方案

## 1. 改造目标

将 `wang-kaopu/haunting-things` 的主工作台页面改造成更接近 ChatGPT 的聊天界面风格。

核心目标：

1. 保留现有业务逻辑，不重写后端协议。
2. 保留现有 `useConversationStream`、`bridge.invoke`、消息流、图片上传、模型选择、权限确认逻辑。
3. 主要改造前端布局、组件结构和样式。
4. 页面视觉从“三栏管理后台风格”改为“ChatGPT 风格聊天工作区”。
5. 优先通过 CSS 和少量组件结构调整完成，不引入大规模 UI 框架重构。

## 2. 技术方案

### 2.1 暂不全量引入 assistant-ui

`assistant-ui` 可以作为 GPT 风格 UI 参考，但第一阶段不建议直接替换现有消息流和输入框逻辑。

原因：

1. 当前项目已经有完整的消息发送、流式响应、图片上传和权限确认逻辑。
2. 直接引入 assistant-ui runtime 会增加适配成本。
3. 当前目标是“页面最像 GPT”，不是重写聊天系统。
4. 更适合先完成静态 UI 改造，再决定是否逐步迁移组件。

第一阶段采用：

```txt
现有 React 组件
+ 自定义 GPT 风格 CSS
+ 少量组件结构调整
```

后续如果需要再引入：

```bash
npm install @assistant-ui/react
```

作为组件参考或渐进式替换。

## 3. 改造范围

优先修改以下文件：

```txt
src/renderer/styles.css
src/renderer/components/Workbench.tsx
src/renderer/components/Sidebar.tsx
src/renderer/components/ChatLayout.tsx
src/renderer/components/ChatHeader.tsx
src/renderer/components/MessageList.tsx
src/renderer/components/MessageBubble.tsx
src/renderer/components/SendBox.tsx
```

如果项目路径略有差异，以实际组件路径为准。

## 4. 页面结构设计

### 4.1 整体布局

将当前三栏布局调整为：

```txt
┌───────────────────────────────────────────────┐
│ Sidebar                 Chat Main             │
│                                               │
│ Team / Thread list      Header                │
│ New Chat                Message List          │
│ Settings                Composer              │
└───────────────────────────────────────────────┘
```

暂时弱化右侧 `TeamDrawer`，避免页面看起来像后台管理系统。

推荐布局：

```css
.app-shell {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  height: 100vh;
  background: #ffffff;
}
```

如果仍然需要右侧团队详情，可以改成抽屉：

```txt
点击团队设置按钮 -> 打开右侧 Drawer
默认不占据主聊天页面空间
```

## 5. Sidebar 编码方案

### 5.1 视觉目标

Sidebar 模仿 ChatGPT 左侧栏：

1. 深色或浅灰背景。
2. 顶部放 `New Chat` / `New Team`。
3. 中间展示 Team / Conversation 列表。
4. 底部放 Settings / Logout。
5. 当前选中项使用圆角浅色高亮。

### 5.2 建议结构

```tsx
<aside className="sidebar">
  <div className="sidebar__top">
    <button className="sidebar__new-chat">New Chat</button>
  </div>

  <div className="sidebar__section">
    <div className="sidebar__section-title">Teams</div>
    <div className="sidebar__list">
      {teams.map((team) => (
        <button className="sidebar__item sidebar__item--active">
          <span className="sidebar__item-title">{team.name}</span>
        </button>
      ))}
    </div>
  </div>

  <div className="sidebar__footer">
    <button className="sidebar__footer-item">Settings</button>
    <button className="sidebar__footer-item">Logout</button>
  </div>
</aside>
```

### 5.3 样式建议

```css
.sidebar {
  display: flex;
  flex-direction: column;
  width: 260px;
  height: 100vh;
  background: #f9f9f9;
  border-right: 1px solid #e5e5e5;
  padding: 12px;
}

.sidebar__new-chat {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  border: 1px solid #d9d9d9;
  background: #ffffff;
  font-size: 14px;
  cursor: pointer;
}

.sidebar__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.sidebar__item {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.sidebar__item:hover {
  background: #ececec;
}

.sidebar__item--active {
  background: #e7e7e7;
}

.sidebar__footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

## 6. ChatLayout 编码方案

### 6.1 视觉目标

中间区域改成 ChatGPT 主聊天页：

```txt
Header 固定顶部
MessageList 居中显示
SendBox 固定底部
```

### 6.2 建议结构

```tsx
<main className="chat">
  <ChatHeader />
  <MessageList />
  <SendBox />
</main>
```

### 6.3 样式建议

```css
.chat {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #ffffff;
  overflow: hidden;
}

.chat-header {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  border-bottom: 1px solid #eeeeee;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  z-index: 10;
}
```

## 7. MessageList 编码方案

### 7.1 视觉目标

消息区不再像卡片列表，而是 ChatGPT 正文流：

1. 内容最大宽度 720px。
2. 整体居中。
3. Assistant 消息左侧自然排版，不使用明显气泡。
4. User 消息靠右，用浅灰圆角气泡。
5. 保留 Markdown、代码块、图片附件渲染。

### 7.2 建议结构

```tsx
<div className="message-list">
  <div className="message-list__inner">
    {messages.map((message) => (
      <MessageBubble key={message.id} message={message} />
    ))}
  </div>
</div>
```

### 7.3 样式建议

```css
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 24px 160px;
}

.message-list__inner {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
```

## 8. MessageBubble 编码方案

### 8.1 Assistant 消息

Assistant 消息不要使用明显卡片背景：

```tsx
<article className="message message--assistant">
  <div className="message__avatar">AI</div>
  <div className="message__content">{renderMarkdown(message.content)}</div>
</article>
```

样式：

```css
.message {
  display: flex;
  gap: 14px;
  width: 100%;
}

.message--assistant {
  align-items: flex-start;
}

.message__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #10a37f;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.message__content {
  min-width: 0;
  line-height: 1.7;
  font-size: 15px;
  color: #0d0d0d;
}
```

### 8.2 User 消息

User 消息靠右显示浅灰气泡：

```tsx
<article className="message message--user">
  <div className="message__user-bubble">{message.content}</div>
</article>
```

样式：

```css
.message--user {
  justify-content: flex-end;
}

.message__user-bubble {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 18px;
  background: #f4f4f4;
  color: #0d0d0d;
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
}
```

### 8.3 代码块样式

```css
.message__content pre {
  border-radius: 10px;
  background: #0d0d0d;
  color: #f5f5f5;
  padding: 14px 16px;
  overflow-x: auto;
  font-size: 13px;
}

.message__content code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```

## 9. SendBox 编码方案

### 9.1 视觉目标

输入框改成 ChatGPT 底部悬浮 Composer：

1. 居中，最大宽度 760px。
2. 圆角大边框。
3. 输入框无明显 textarea 边框。
4. 附件、命令、模型按钮放在下方工具栏。
5. 发送按钮为右侧圆形按钮。
6. 保留 Enter 发送、Shift+Enter 换行。

### 9.2 建议结构

```tsx
<form className="composer" onSubmit={handleSubmit}>
  <div className="composer__box">
    <textarea
      className="composer__textarea"
      placeholder="Message..."
      value={input}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />

    <div className="composer__toolbar">
      <div className="composer__tools">
        <button type="button">＋</button>
        <button type="button">Command</button>
        <button type="button">Model</button>
      </div>

      <button type="submit" className="composer__send" disabled={!canSend}>
        ↑
      </button>
    </div>
  </div>
</form>
```

### 9.3 样式建议

```css
.composer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 24px 24px;
  background: linear-gradient(to top, #ffffff 72%, rgba(255, 255, 255, 0));
}

.composer__box {
  max-width: 760px;
  margin: 0 auto;
  border: 1px solid #d9d9d9;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  padding: 12px;
}

.composer__textarea {
  width: 100%;
  min-height: 48px;
  max-height: 200px;
  border: none;
  outline: none;
  resize: none;
  font-size: 15px;
  line-height: 1.6;
  background: transparent;
}

.composer__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.composer__tools {
  display: flex;
  gap: 8px;
}

.composer__tools button {
  height: 32px;
  border-radius: 16px;
  border: 1px solid #e5e5e5;
  background: #ffffff;
  padding: 0 10px;
  cursor: pointer;
}

.composer__send {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: #0d0d0d;
  color: #ffffff;
  cursor: pointer;
}

.composer__send:disabled {
  background: #d0d0d0;
  cursor: not-allowed;
}
```

## 10. ChatHeader 编码方案

### 10.1 视觉目标

Header 简化成 GPT 风格：

```txt
左侧：当前 Team / Agent 名称
中间：可选
右侧：模型选择 / 设置 / 更多
```

### 10.2 建议结构

```tsx
<header className="chat-header">
  <div className="chat-header__title">
    <strong>{currentTeam?.name ?? "New chat"}</strong>
    <span>{currentAgent?.name ?? "Default agent"}</span>
  </div>

  <div className="chat-header__actions">
    <button>Model</button>
    <button>Settings</button>
  </div>
</header>
```

### 10.3 样式建议

```css
.chat-header__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.chat-header__title strong {
  font-size: 15px;
  font-weight: 600;
}

.chat-header__title span {
  font-size: 13px;
  color: #777;
}

.chat-header__actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
```

## 11. 空状态设计

当没有消息时，中间显示 GPT 风格欢迎页：

```tsx
<div className="chat-empty">
  <h1>What can I help with?</h1>
  <div className="chat-empty__suggestions">
    <button>Summarize this project</button>
    <button>Generate a task plan</button>
    <button>Debug current agent</button>
  </div>
</div>
```

样式：

```css
.chat-empty {
  min-height: calc(100vh - 260px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.chat-empty h1 {
  font-size: 28px;
  font-weight: 500;
  margin-bottom: 24px;
}

.chat-empty__suggestions {
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 12px;
}

.chat-empty__suggestions button {
  border: 1px solid #e5e5e5;
  border-radius: 14px;
  background: #ffffff;
  padding: 14px;
  text-align: left;
  cursor: pointer;
}
```

## 12. 响应式方案

### 12.1 平板和小屏

```css
@media (max-width: 900px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .message-list__inner,
  .composer__box {
    max-width: 100%;
  }
}
```

### 12.2 移动端

```css
@media (max-width: 600px) {
  .message-list {
    padding: 16px 12px 140px;
  }

  .composer {
    padding: 12px;
  }

  .message__user-bubble {
    max-width: 86%;
  }

  .chat-header {
    padding: 0 12px;
  }
}
```

## 13. 实施步骤

### Step 1：备份现有 UI 状态

新建分支：

```bash
git checkout -b feat/gpt-like-ui
```

### Step 2：重构整体布局

修改 `Workbench.tsx`：

1. 将主布局调整为 `Sidebar + ChatLayout`。
2. 右侧 `TeamDrawer` 改为按需显示。
3. 保留现有状态管理和事件处理。

### Step 3：改造 Sidebar

修改 `Sidebar.tsx`：

1. 顶部添加 New Chat / New Team。
2. Team 列表改成 GPT 左侧栏样式。
3. 底部固定设置项。
4. 当前选中 Team 增加 active 状态。

### Step 4：改造 ChatLayout

修改 `ChatLayout.tsx`：

1. 采用 `chat` 容器。
2. Header 固定顶部。
3. MessageList 占满中间。
4. SendBox 悬浮底部。

### Step 5：改造 MessageBubble

修改 `MessageBubble.tsx`：

1. Assistant 消息取消卡片气泡。
2. User 消息改为右侧浅灰气泡。
3. 保留 Markdown、代码块、附件渲染。
4. 增加 loading / streaming 状态样式。

### Step 6：改造 SendBox

修改 `SendBox.tsx`：

1. 输入框改为圆角 Composer。
2. 工具按钮放入 toolbar。
3. 发送按钮改成圆形按钮。
4. 保留原来的键盘事件和上传逻辑。

### Step 7：整理 styles.css

将样式按模块拆分：

```css
/* Base */
/* Layout */
/* Sidebar */
/* Chat Header */
/* Message List */
/* Message Bubble */
/* Composer */
/* Empty State */
/* Responsive */
```

### Step 8：本地验证

执行：

```bash
npm run typecheck
npm run lint
npm run dev
```

如果没有对应脚本，至少执行：

```bash
npm run build
```

## 14. 验收标准

完成后需要满足：

1. 页面第一眼接近 ChatGPT。
2. 左侧栏不再像后台管理菜单。
3. 主聊天区居中，消息最大宽度合理。
4. User 消息右侧浅灰气泡。
5. Assistant 消息自然正文流。
6. 输入框悬浮底部，圆角明显。
7. 图片上传、发送、流式响应不受影响。
8. 模型选择和命令按钮仍然可用。
9. 小屏幕下 Sidebar 不挤压聊天区。
10. `npm run build` 通过。

## 15. 暂不处理的内容

第一阶段不处理：

1. 不重写后端 Express 接口。
2. 不改 Electron 主进程逻辑。
3. 不引入 Supabase。
4. 不迁移到 Next.js。
5. 不全量替换为 Open WebUI。
6. 不全量重写 assistant-ui runtime。
7. 不改消息协议结构。

## 16. 推荐提交信息

```bash
git add .
git commit -m "feat(ui): 改造为GPT风格聊天界面"
```
