# haunting-things 前端 UI 细节收尾编码方案

## 目标

本次只做前端 UI 收尾，不改后端协议、不改 Electron 主进程、不改消息发送逻辑。

需要完成：

1. 去掉顶部“添加 Agent”按钮。
2. 统一模型选择、权限模式、命令选择、图片按钮等工具栏控件样式，使其更接近 GPT。
3. 将 Teams 条目样式改成和 Members 一样的一行式列表项。
4. 调整弹出 Dialog 样式，使其更接近 GPT。

---

## 一、去掉“添加 Agent”按钮

### 1.1 修改 ChatHeader

文件：

```txt
src/renderer/features/chat/components/ChatHeader.tsx
```

删除 `ChatHeaderProps` 中的：

```ts
onAddAgentClick: () => void;
```

删除函数参数中的：

```ts
onAddAgentClick,
```

删除 header 右侧按钮：

```tsx
<button type="button" onClick={onAddAgentClick} disabled={!team}>
  添加 Agent
</button>
```

修改后结构只保留标题状态：

```tsx
export type ChatHeaderProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
};

export function ChatHeader({
  team,
  activeAgent,
  activePhase,
  usage,
}: ChatHeaderProps): React.ReactElement {
  return (
    <header className="chat-header">
      <div className="chat-title">
        <h2>{team?.name ?? "未选择团队"}</h2>
        <p className="muted">
          {activeAgent
            ? `${activeAgent.name} · ${activeAgent.backend}${activeAgent.model ? ` · ${activeAgent.model}` : ""}`
            : "暂无 Agent"}
        </p>
        <div className="status-row">
          <UsageChip usage={usage} />
          {activePhase ? (
            <span className={`phase-badge ${activePhase}`}>
              {formatPhase(activePhase)}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
```

### 1.2 修改 ChatLayout

文件：

```txt
src/renderer/features/chat/ChatLayout.tsx
```

如果当前 `ChatLayoutProps` 里只有 `ChatHeader` 使用 `onAddAgentClick`，删除：

```ts
onAddAgentClick: () => void;
```

删除解构中的：

```ts
onAddAgentClick,
```

删除传给 `ChatHeader` 的：

```tsx
onAddAgentClick = { onAddAgentClick };
```

修改后：

```tsx
<ChatHeader
  team={team}
  activeAgent={activeAgent}
  activePhase={activePhase}
  usage={usage}
/>
```

### 1.3 修改 Workbench

文件：

```txt
src/renderer/app/Workbench.tsx
```

如果 `ChatLayout` 不再需要 `onAddAgentClick`，删除：

```tsx
onAddAgentClick={() => setAddAgentOpen(true)}
```

注意：

```txt
不要删除 AddAgentDialog 本身。
如果 Sidebar / Members 区域仍然有添加成员入口，AddAgentDialog 继续保留。
本任务只移除 ChatHeader 顶部的“添加 Agent”按钮。
```

---

## 二、统一工具栏下拉框和按钮样式

当前工具栏控件包括：

```txt
ModelPicker
PermissionModePicker
AgentCommandsMenu
ImageAttachmentPicker
发送按钮
```

目标是统一成 GPT 风格“小胶囊控件”：

```txt
圆角胶囊
浅灰背景
无粗边框
hover 时稍微变深
focus 时有黑色/深灰描边
高度一致
字号一致
```

### 2.1 去掉空 span

文件：

```txt
src/renderer/features/chat/components/ModelPicker.tsx
src/renderer/features/chat/components/PermissionModePicker.tsx
src/renderer/features/chat/components/AgentCommandsMenu.tsx
```

删除所有：

```tsx
<span></span>
```

给 `select` 补 `aria-label`。

#### ModelPicker

改成：

```tsx
<label className="toolbar-select-label">
  <select
    aria-label="模型"
    className="toolbar-control toolbar-select model-select"
    value={selectedValue}
    disabled={!agent || !hasOptions || submitting}
    onChange={(event) => {
      void submit(event.target.value);
    }}
  >
    {!current || !hasOptions ? <option value="">默认模型</option> : null}
    {current && !options.some((model) => model.id === current) ? (
      <option value={current}>{current}</option>
    ) : null}
    {options.map((model) => (
      <option key={model.id} value={model.id}>
        {model.name || model.id}
      </option>
    ))}
  </select>
</label>
```

#### PermissionModePicker

改成：

```tsx
<label className="toolbar-select-label">
  <select
    aria-label="权限模式"
    className="toolbar-control toolbar-select permission-mode-select"
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
```

#### AgentCommandsMenu

改成：

```tsx
<label className="toolbar-select-label">
  <select
    aria-label="命令"
    className="toolbar-control toolbar-select command-select"
    value=""
    disabled={disabled || count === 0}
    title={count > 0 ? "可用命令" : "暂无命令快照"}
    onChange={(event) => {
      selectCommand(event.target.value);
    }}
  >
    <option value="" disabled hidden>
      命令
    </option>
    {commandList.map((command) => (
      <option key={command.name} value={command.name}>
        {command.name}
      </option>
    ))}
  </select>
</label>
```

### 2.2 统一图片按钮

文件：

```txt
src/renderer/features/chat/components/ImageAttachmentPicker.tsx
```

将图片按钮从：

```tsx
className = "tool-pill image-picker-button";
```

改成：

```tsx
className = "toolbar-control image-picker-button";
```

按钮文案建议短一点：

```tsx
{
  uploading ? "上传中" : "图片";
}
```

### 2.3 统一发送按钮

文件：

```txt
src/renderer/features/chat/components/SendBox.tsx
```

将发送按钮增加类名：

```tsx
<button
  type="button"
  className="composer-send"
  disabled={
    disabled ||
    sending ||
    uploading ||
    (!content.trim() && attachments.length === 0)
  }
  onClick={() => void submit()}
  aria-label="发送消息"
  title="发送消息"
>
  {sending ? "…" : "↑"}
</button>
```

### 2.4 CSS：统一工具栏控件

文件：

```txt
src/renderer/styles.css
```

替换或覆盖当前 `.toolbar-select-label`、`.toolbar-select`、`.tool-pill`、`.image-picker-button` 相关样式：

```css
.composer-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.model-picker,
.permission-mode-picker,
.commands-menu,
.image-picker {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.toolbar-select-label {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.toolbar-control,
.toolbar-select {
  height: 32px;
  max-width: 220px;
  border: 1px solid #d9d9d9;
  border-radius: 999px;
  background: #f7f7f8;
  color: #0d0d0d;
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.toolbar-select {
  width: auto;
  min-width: 0;
  padding: 0 30px 0 12px;
  appearance: auto;
}

.toolbar-control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
}

.toolbar-control:hover,
.toolbar-select:hover {
  background: #ececec;
  border-color: #cfcfcf;
}

.toolbar-control:focus-visible,
.toolbar-select:focus-visible {
  outline: none;
  border-color: #0d0d0d;
  box-shadow: 0 0 0 2px rgba(13, 13, 13, 0.08);
}

.toolbar-control:disabled,
.toolbar-select:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.model-select {
  max-width: 240px;
}

.permission-mode-select {
  max-width: 190px;
}

.command-select {
  max-width: 160px;
}

.image-picker.dragging .image-picker-button {
  border-color: #0d0d0d;
  background: #ececec;
  color: #0d0d0d;
}

.toolbar-select-error {
  max-width: 260px;
}
```

如果旧的 `.tool-pill` 还被其他地方用到，先不要删除，只让图片按钮不再依赖它。

---

## 三、Teams 条目改成和 Members 一样

目标：

```txt
Members:
●  [icon]  成员名

Teams:
   [icon]  团队名    ⋯
```

Teams 不需要红绿灯，但行高、圆角、hover、selected、文字截断应与 Members 一致。

### 3.1 修改 TeamList 容器类名

文件：

```txt
src/renderer/features/teams/components/TeamList.tsx
```

将：

```tsx
<div className="list">
```

改成：

```tsx
<div className="sidebar-team-list">
```

空状态也建议统一：

```tsx
return <p className="sidebar-empty">暂无团队</p>;
```

### 3.2 修改 TeamListItem 结构

文件：

```txt
src/renderer/features/teams/components/TeamListItem.tsx
```

建议结构：

```tsx
<div className={`sidebar-team-item${active ? " selected" : ""}`}>
  <button
    type="button"
    className="sidebar-team-main"
    title={team.name}
    onClick={onSelect}
  >
    <span className="sidebar-team-icon" aria-hidden="true">
      #
    </span>
    <span className="sidebar-team-name">{team.name}</span>
  </button>

  <div className="sidebar-team-menu-wrap">
    <button
      type="button"
      className="sidebar-team-menu-button"
      aria-label={`更多操作：${team.name}`}
      onClick={(event) => {
        event.stopPropagation();
        setMenuOpen((value) => !value);
      }}
    >
      ⋯
    </button>

    {menuOpen ? (
      <div className="menu-popover sidebar-team-menu">
        <button
          type="button"
          className="danger"
          disabled={deleting}
          onClick={(event) => {
            event.stopPropagation();
            setDeleting(true);
            void onDelete().finally(() => {
              setDeleting(false);
              setMenuOpen(false);
            });
          }}
        >
          {deleting ? "删除中..." : "删除团队"}
        </button>
      </div>
    ) : null}
  </div>
</div>
```

如果不想出现 `#`，可以把图标留空：

```tsx
<span className="sidebar-team-icon" aria-hidden="true" />
```

### 3.3 CSS：Teams 和 Members 同风格

在 `styles.css` 中新增：

```css
.sidebar-team-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-team-item {
  width: 100%;
  height: 32px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  background: transparent;
  position: relative;
}

.sidebar-team-item:hover {
  background: #ececec;
}

.sidebar-team-item.selected {
  background: #e7e7e7;
}

.sidebar-team-main {
  min-width: 0;
  height: 32px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  color: var(--text);
}

.sidebar-team-main:hover,
.sidebar-team-main.selected {
  border-color: transparent;
  background: transparent;
}

.sidebar-team-icon {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  border-radius: 5px;
  color: var(--muted);
  font-size: 12px;
}

.sidebar-team-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
}

.sidebar-team-menu-wrap {
  position: relative;
  display: flex;
  justify-content: center;
}

.sidebar-team-menu-button {
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  line-height: 1;
}

.sidebar-team-menu-button:hover {
  background: #dedede;
  border-color: transparent;
}

.sidebar-team-menu {
  top: 30px;
  right: 0;
}
```

旧样式可以先保留，但不再依赖：

```css
.team-row
.team-main
.team-menu-wrap
```

确认没有其他地方使用后再删。

---

## 四、弹出 Dialog 改成 GPT 风格

目标：

```txt
半透明黑色遮罩
白色圆角卡片
圆角 20px 左右
标题更轻
输入框圆角 12px
按钮圆角 999px
主按钮黑底白字
取消按钮浅灰背景
权限选项像卡片列表
```

### 4.1 统一 Modal 基础样式

覆盖当前 `.modal-backdrop / .permission-overlay / .modal / .permission-dialog`：

```css
.modal-backdrop,
.permission-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(8px);
}

.modal,
.permission-dialog {
  width: min(480px, calc(100vw - 32px));
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 20px;
  background: #ffffff;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.18),
    0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 22px;
  display: grid;
  gap: 16px;
}

.modal h3,
.permission-dialog h3 {
  margin: 0;
  color: #0d0d0d;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
```

### 4.2 表单字段样式

覆盖 `.field`、`.field input`、`.field select`：

```css
.field {
  display: grid;
  gap: 7px;
  color: #565869;
  font-size: 13px;
}

.field > span {
  font-size: 13px;
  color: #565869;
}

.field input,
.field select,
.modal input,
.modal select {
  width: 100%;
  height: 42px;
  border: 1px solid #d9d9d9;
  border-radius: 12px;
  padding: 0 12px;
  background: #ffffff;
  color: #0d0d0d;
  font-size: 14px;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.field input:focus,
.field select:focus,
.modal input:focus,
.modal select:focus {
  outline: none;
  border-color: #0d0d0d;
  box-shadow: 0 0 0 3px rgba(13, 13, 13, 0.08);
}
```

### 4.3 Modal 按钮样式

覆盖 `.modal-actions` 和 `.permission-actions`：

```css
.modal-actions,
.permission-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.modal-actions button,
.permission-actions button {
  height: 36px;
  min-width: 72px;
  border-radius: 999px;
  border: none;
  padding: 0 14px;
  font-size: 14px;
}

.modal-actions button[type="submit"],
.permission-actions button:first-child {
  background: #0d0d0d;
  color: #ffffff;
}

.modal-actions button[type="submit"]:hover,
.permission-actions button:first-child:hover {
  background: #2f2f2f;
}

.modal-actions .secondary,
.permission-actions .secondary {
  margin-top: 0;
  background: #f4f4f4;
  color: #0d0d0d;
}

.modal-actions .secondary:hover,
.permission-actions .secondary:hover {
  background: #e9e9e9;
}
```

### 4.4 权限弹窗选项卡片化

覆盖权限相关样式：

```css
.permission-body {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f7f7f8;
  border: 1px solid #ececec;
  border-radius: 12px;
  color: #353740;
  font-size: 13px;
}

.permission-options {
  display: grid;
  gap: 8px;
}

.permission-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #ececec;
  border-radius: 12px;
  background: #ffffff;
  color: #0d0d0d;
  cursor: pointer;
}

.permission-option:hover {
  background: #f7f7f8;
}

.permission-option input {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  accent-color: #0d0d0d;
}

.permission-desc {
  color: #6b7280;
  font-size: 12px;
}
```

当前 PermissionDialog 的 label 结构是：

```tsx
<label className="permission-option">
  <input />
  {opt.label}
  {opt.description ? (
    <span className="permission-desc"> - {opt.description}</span>
  ) : null}
</label>
```

为了更好排版，建议改成：

```tsx
<label key={opt.id} className="permission-option">
  <input
    type="radio"
    name="permission"
    value={opt.id}
    checked={selected === opt.id}
    onChange={() => setSelected(opt.id)}
  />
  <span className="permission-option-content">
    <strong>{opt.label}</strong>
    {opt.description ? (
      <span className="permission-desc">{opt.description}</span>
    ) : null}
  </span>
</label>
```

并加：

```css
.permission-option-content {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.permission-option-content strong {
  font-size: 14px;
  font-weight: 500;
}
```

### 4.5 设置弹窗头部

当前设置弹窗里右上角是“关闭”文字按钮。建议改成更像 GPT 的圆形关闭按钮：

```tsx
<div className="modal-header">
  <h2>设置</h2>
  <button
    type="button"
    className="modal-close-button"
    aria-label="关闭设置"
    onClick={() => setSettingsOpen(false)}
  >
    ×
  </button>
</div>
```

CSS：

```css
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-header h2 {
  margin: 0;
  color: #0d0d0d;
  font-size: 18px;
  font-weight: 600;
}

.modal-close-button {
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #f4f4f4;
  color: #0d0d0d;
  font-size: 18px;
  line-height: 1;
}

.modal-close-button:hover {
  background: #e9e9e9;
}
```

---

## 五、建议清理全局按钮默认样式的影响

当前全局 `button` 样式会影响所有按钮，容易让局部 GPT 风格被“蓝色边框后台按钮”覆盖。

建议把全局按钮样式降低存在感：

```css
button {
  font: inherit;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}
```

然后把具体按钮样式交给具体类：

```css
.primary-button
.secondary-button
.toolbar-control
.composer-send
.sidebar-team-menu-button
.modal-close-button
```

如果不想大改，可以保留全局样式，但必须在上述新类里覆盖：

```css
border: none;
background: ...
border-radius: ...
```

---

## 六、推荐提交顺序

```bash
git add .
git commit -m "style(ui): 补全GPT风格界面细节"
```

## 七、验收标准

完成后检查：

```txt
1. ChatHeader 不再显示“添加 Agent”按钮。
2. ChatLayout / Workbench 不再向 ChatHeader 传无用的 onAddAgentClick。
3. 模型、权限、命令、图片按钮高度一致、圆角一致、hover 一致。
4. 不再出现空 <span></span>。
5. Teams 条目和 Members 一样是一行式、32px 高、文字超长省略。
6. Teams 选中态和 Members 选中态一致。
7. 创建团队、添加 Agent、权限确认、设置弹窗更像 GPT 弹窗。
8. 弹窗输入框、select、按钮都有统一圆角和 focus 样式。
9. npm run build 通过。
```
