# haunting-things 第一阶段 UI 收尾编码方案

## 目标

本次改造只补全第一阶段 UI 重做留下的前端尾巴，不改后端协议、不改消息发送逻辑、不改 Electron 主进程。

需要完成两件事：

1. 补全 新 风格 UI 第一阶段未完成任务。

---

## 一、改造范围

主要修改这些文件：

```txt
src/renderer/app/Workbench.tsx
src/renderer/features/teams/Sidebar.tsx
src/renderer/features/teams/components/SidebarAgentList.tsx
src/renderer/features/chat/ChatLayout.tsx
src/renderer/features/chat/components/MessageList.tsx
src/renderer/features/chat/components/MessageBubble.tsx
src/renderer/features/chat/components/SendBox.tsx
src/renderer/shared/utils/agentIcon.ts
src/renderer/assets/icons/agents/default.svg
src/renderer/assets/icons/agents/claude.svg
src/renderer/assets/icons/agents/codex.svg
src/renderer/styles.css
```

清理：

```txt
src/renderer/features/teams/TeamDrawer.tsx
src/renderer/shared/hooks/useTeamDrawer.ts
```

---

## 二、任务 1：将 Workbench 从三栏改成两栏

### 1.1 删除右侧 TeamDrawer 渲染

修改：

```txt
src/renderer/app/Workbench.tsx
```

删除这些 import：

```ts
import { TeamDrawer } from "../features/teams/TeamDrawer";
import { useTeamDrawer } from "../shared/hooks/useTeamDrawer";
```

删除：

```ts
const drawer = useTeamDrawer();
```

将原来的：

```tsx
<main className={drawer.open ? 'app-shell drawer-open' : 'app-shell drawer-collapsed'}>
```

改成：

```tsx
<main className="app-shell">
```

删除：

```tsx
<TeamDrawer
  open={drawer.open}
  team={active.activeTeam}
  activeSlotId={active.activeSlotId}
  phases={conversation.phaseByConversation}
  commandsByConversation={snapshots.commandsByConversation}
  modeByConversation={snapshots.modeByConversation}
  onToggle={drawer.toggle}
  onSelectAgent={active.selectAgent}
/>
```

---

## 三、任务 2：Sidebar 顶部增加成员状态列表

### 2.1 修改 Sidebar Props

修改：

```txt
src/renderer/features/teams/Sidebar.tsx
```

将类型补全为：

```ts
import type { AgentTurnPhase, Team } from "../../../shared/types";
import { SidebarAgentList } from "./components/SidebarAgentList";
import { TeamList } from "./components/TeamList";

export type SidebarProps = {
  username?: string;
  teams: Team[];
  activeTeam: Team | null;
  activeTeamId: string | null;
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  onCreateTeamClick: () => void;
  onAddAgentClick: () => void;
  onSelectTeam: (teamId: string) => void;
  onSelectAgent: (slotId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onSettingsClick: () => void;
  onLogout: () => void;
};
```

### 2.2 修改 Sidebar 结构

目标顺序：

```txt
品牌 / 用户
Members 成员状态列表
添加成员按钮
Teams 团队列表
创建团队按钮
设置 / 退出
```

推荐结构：

```tsx
export function Sidebar({
  username,
  teams,
  activeTeam,
  activeTeamId,
  activeSlotId,
  phases,
  onCreateTeamClick,
  onAddAgentClick,
  onSelectTeam,
  onSelectAgent,
  onDeleteTeam,
  onSettingsClick,
  onLogout,
}: SidebarProps): React.ReactElement {
  return (
    <aside className="sidebar">
      <div className="brand">
        <strong>Haunting Things</strong>
        <span>{username ?? "admin"}</span>
      </div>

      <section className="sidebar-section sidebar-members-section">
        <div className="sidebar-section-header">
          <span>Members</span>
          <button
            type="button"
            className="sidebar-section-action"
            disabled={!activeTeam}
            onClick={onAddAgentClick}
          >
            添加
          </button>
        </div>

        <SidebarAgentList
          agents={activeTeam?.agents ?? []}
          activeSlotId={activeSlotId}
          phases={phases}
          onSelectAgent={onSelectAgent}
        />
      </section>

      <section className="sidebar-section sidebar-teams-section">
        <div className="sidebar-section-header">
          <span>Teams</span>
          <button
            type="button"
            className="sidebar-section-action"
            onClick={onCreateTeamClick}
          >
            创建
          </button>
        </div>

        <TeamList
          teams={teams}
          activeTeamId={activeTeamId}
          onSelectTeam={onSelectTeam}
          onDeleteTeam={onDeleteTeam}
        />
      </section>

      <div className="sidebar-actions">
        <button type="button" onClick={onSettingsClick}>
          设置
        </button>
        <button type="button" className="secondary" onClick={onLogout}>
          退出登录
        </button>
      </div>
    </aside>
  );
}
```

### 2.3 Workbench 传参补全

`Workbench.tsx` 中的 `Sidebar` 调用改成：

```tsx
<Sidebar
  username={user.username}
  teams={teamsState.teams}
  activeTeam={active.activeTeam}
  activeTeamId={active.activeTeamId}
  activeSlotId={active.activeSlotId}
  phases={conversation.phaseByConversation}
  onCreateTeamClick={() => setCreateTeamOpen(true)}
  onAddAgentClick={() => setAddAgentOpen(true)}
  onSelectTeam={active.selectTeam}
  onSelectAgent={active.selectAgent}
  onDeleteTeam={deleteTeam}
  onSettingsClick={() => setSettingsOpen(true)}
  onLogout={() => void logout()}
/>
```

---

## 四、任务 3：新增 SidebarAgentList

新建：

```txt
src/renderer/features/teams/components/SidebarAgentList.tsx
```

代码：

```tsx
import type React from "react";
import type { AgentTurnPhase, TeamAgent } from "../../../../shared/types";
import {
  getAgentIconAlt,
  getAgentIconSrc,
} from "../../../shared/utils/agentIcon";

export type SidebarAgentListProps = {
  agents: TeamAgent[];
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  onSelectAgent: (slotId: string) => void;
};

export function SidebarAgentList({
  agents,
  activeSlotId,
  phases = {},
  onSelectAgent,
}: SidebarAgentListProps): React.ReactElement {
  if (agents.length === 0) {
    return <p className="sidebar-empty">暂无成员</p>;
  }

  return (
    <div className="sidebar-agent-list">
      {agents.map((agent) => {
        const phase = phases[agent.conversationId];
        const busy =
          agent.status === "active" || Boolean(phase && phase !== "done");

        return (
          <button
            key={agent.slotId}
            type="button"
            className={`sidebar-agent-item${agent.slotId === activeSlotId ? " selected" : ""}`}
            title={agent.name}
            onClick={() => onSelectAgent(agent.slotId)}
          >
            <span
              className={`sidebar-agent-status ${busy ? "busy" : "idle"}`}
              aria-label={busy ? "忙碌中" : "空闲"}
            />

            <img
              className="sidebar-agent-icon"
              src={getAgentIconSrc(agent.backend)}
              alt={getAgentIconAlt(agent.backend)}
            />

            <span className="sidebar-agent-name">{agent.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

显示规则：

```txt
每个成员只占一行
只显示：
- 红绿灯
- 类型图标
- 名字

名字过长：
- overflow hidden
- text-overflow ellipsis
- white-space nowrap
```

---

## 八、任务 7：SendBox 增加 composer-inner

修改：

```txt
src/renderer/features/chat/components/SendBox.tsx
```

把原结构：

```tsx
<div className="composer">...</div>
```

改成：

```tsx
<div className="composer">
  <div className="composer-inner">
    <ImageAttachmentPreview
      attachments={attachments}
      onRemove={(id) => void removeAttachment(id)}
    />

    <textarea
      ref={textareaRef}
      value={content}
      disabled={disabled || sending}
      placeholder={disabled ? "请选择团队" : "给团队发送消息"}
      onChange={(event) => setContent(event.target.value)}
      onPaste={(event) => void handlePaste(event)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void submit();
        }
      }}
    />

    <div className="composer-footer">
      <ComposerTools
        activeAgent={activeAgent}
        commands={commands}
        models={models}
        mode={mode}
        onSetModel={onSetModel}
        onSetMode={onSetMode}
        disabled={disabled || sending}
        onSelectCommand={insertCommand}
        imagePicker={
          <ImageAttachmentPicker
            disabled={disabled || sending}
            uploading={uploading}
            onAddImages={uploadImages}
          />
        }
      />

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
    </div>

    {error ? <p className="send-error">{error}</p> : null}
  </div>
</div>
```

---

## 九、任务 8：styles.css 改造

### 8.1 两栏布局

替换：

```css
.app-shell {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  display: grid;
  grid-template-columns: 260px minmax(440px, 1fr) 280px;
  background: #f5f7fa;
}

.app-shell.drawer-collapsed {
  grid-template-columns: 260px minmax(440px, 1fr) 44px;
}
```

为：

```css
.app-shell {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  background: #ffffff;
}
```

### 8.2 Sidebar 成员区样式

新增：

```css
.sidebar {
  border-right: 1px solid var(--border);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #f9f9f9;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.sidebar-members-section {
  flex: 0 0 auto;
  max-height: 220px;
}

.sidebar-teams-section {
  flex: 1;
  min-height: 0;
}

.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  font-size: 12px;
  color: var(--muted);
}

.sidebar-section-action {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.sidebar-section-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.sidebar-agent-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-agent-item {
  width: 100%;
  height: 32px;
  display: grid;
  grid-template-columns: 8px 20px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.sidebar-agent-item:hover {
  background: #ececec;
}

.sidebar-agent-item.selected {
  background: #e7e7e7;
}

.sidebar-agent-status {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.sidebar-agent-status.idle {
  background: #22c55e;
}

.sidebar-agent-status.busy {
  background: #ef4444;
}

.sidebar-agent-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
  border-radius: 4px;
}

.sidebar-agent-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
}

.sidebar-empty {
  margin: 4px 8px 8px;
  color: var(--muted);
  font-size: 12px;
}
```

### 8.3 消息流 新 风格

替换当前 `.messages` 和 `.message` 相关样式为：

```css
.messages {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
  padding: 24px 24px 160px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.message {
  width: min(760px, 100%);
  max-width: 760px;
  min-width: 0;
  margin: 0 auto;
  border: none;
  background: transparent;
  padding: 0;
  overflow-wrap: anywhere;
}

.message.assistant {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  column-gap: 12px;
}

.message.user {
  display: flex;
  justify-content: flex-end;
}

.message.user .markdown-message {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 18px;
  background: #f4f4f4;
  color: var(--text);
}

.message-role-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  min-width: 0;
}

.message.assistant .message-role-row {
  grid-column: 1 / -1;
}

.message-role-row small {
  display: block;
  margin-bottom: 0;
  color: var(--
```
