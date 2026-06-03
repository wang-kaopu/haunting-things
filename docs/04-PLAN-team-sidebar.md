可以，这个设计更合理：**左侧 Sidebar 顶部先放当前团队成员状态条，下面再放团队列表**。这样打开页面第一眼就能看到“谁空闲、谁忙碌”，更像一个 Agent 控制台。

当前 `Sidebar` 只显示品牌、创建团队按钮、`TeamList` 和设置/退出，并且注释里明确说成员状态交给右侧抽屉展示；现在要把这个职责挪到左侧顶部。
`TeamAgent` 本身已经有 `name`、`backend`、`status` 字段，足够做你要的“一行成员状态”。

## 最终左侧结构

改成这样：

```txt
┌────────────────────────┐
│ Haunting Things        │
│ username               │
│                        │
│ Members                │
│ ●  [ ] Claude Agent    │
│ ●  [ ] 新 Agent       │
│ ●  [ ] Codex Agent     │
│                        │
│ + 添加成员              │
│                        │
│ Teams                  │
│ + 创建团队              │
│ - Team A               │
│ - Team B               │
│                        │
│ 设置                   │
│ 退出登录                │
└────────────────────────┘
```

每一行成员只显示：

```txt
红绿灯 + 成员类型图标占位 + 成员名字
```

不要再显示：

```txt
backend
model
命令数
模式
phase 文本
```

这些信息可以放到 hover tooltip 或以后点击成员详情再看。

## 忙碌状态判断

建议这样判断：

```ts
const busy = agent.status === "active" || Boolean(phase && phase !== "done");
```

也就是：

```txt
绿色：idle / done
红色：active / streaming / thinking / tool running / 其他非 done 阶段
```

如果只做红绿灯，不做黄灯/灰灯，那 `failed`、`stopped` 可以先归到红色，表示“不可直接使用/异常状态”。

## 新增组件：`SidebarAgentList.tsx`

不要继续改 `TeamMemberCard`，它现在是卡片式，还展示状态、模型、命令数、运行阶段。
新建一个专门给左侧栏用的紧凑组件更干净。

路径建议：

```txt
src/renderer/features/teams/components/SidebarAgentList.tsx
```

代码：

```tsx
import type React from "react";
import type { AgentTurnPhase, TeamAgent } from "../../../../shared/types";

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
            <span
              className={`sidebar-agent-icon sidebar-agent-icon-${agent.backend}`}
              aria-hidden="true"
            />
            <span className="sidebar-agent-name">{agent.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

这里的 `sidebar-agent-icon` 先留空，只占位置。以后可以根据：

```ts
agent.backend;
```

渲染 Claude Code、Codex、新、小机器人图标。

## 修改 Sidebar Props

当前 `SidebarProps` 没有 `activeTeam`、`activeSlotId`、`phases`、`onSelectAgent`。
改成：

```tsx
import type React from "react";
import type { AgentTurnPhase, Team } from "../../../shared/types";
import { TeamList } from "./components/TeamList";
import { SidebarAgentList } from "./components/SidebarAgentList";

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

## 修改 Sidebar 结构

成员列表放最上方，团队列表往下移：

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

## 修改 Workbench 传参

`Workbench` 当前传给 `Sidebar` 的只有团队列表、选中团队和设置退出这些参数，同时还渲染了 `TeamDrawer`。

改成：

```tsx
<main className="app-shell">
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

  <ChatLayout
    team={active.activeTeam}
    activeAgent={active.activeAgent}
    messages={conversation.messages}
    activePhase={conversation.activePhase}
    usage={snapshots.usage}
    commands={snapshots.commands}
    models={snapshots.models}
    mode={snapshots.mode}
    onAddAgentClick={() => setAddAgentOpen(true)}
    onSendMessage={conversation.sendTeamMessage}
    onSetModel={setModel}
    onSetMode={setMode}
  />

  <NotificationCenter
    items={notifications.items}
    onRemove={notifications.remove}
  />
</main>
```

然后删除：

```tsx
<TeamDrawer ... />
```

也可以先不删 `TeamDrawer.tsx` 文件，只是不渲染，确认没问题后再删。

## CSS

核心是一行成员高度固定，名字超出显示省略号：

```css
.sidebar {
  display: flex;
  flex-direction: column;
  width: 300px;
  height: 100vh;
  padding: 12px;
  border-right: 1px solid var(--border);
  background: #f9f9f9;
  overflow: hidden;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 6px;
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
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.sidebar-agent-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  cursor: pointer;
  text-align: left;
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
  border-radius: 5px;
  flex-shrink: 0;
}

/* 先占位，后续可以换成 cc / 新 / codex 的真实图标 */
.sidebar-agent-icon-claude,
.sidebar-agent-icon-codex,
.sidebar-agent-icon-openai {
  background: transparent;
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

如果你想让图标占位更明显一点，可以临时给一个很淡的底色：

```css
.sidebar-agent-icon {
  background: #e5e5e5;
}
```

但你说“留空”，那就保持 `transparent`。

## 最终效果

左侧优先级变成：

```txt
品牌 / 用户
成员状态列表
团队列表
设置 / 退出
```

成员行变成：

```txt
●  [icon slot]  很长很长的成员名字...
```

这比之前的 `TeamMemberCard` 更适合左边栏，因为 `TeamMemberCard` 当前是多行卡片，还会显示 backend、model、命令数和 phase，不符合你要的“一行紧凑成员状态”。

推荐提交：

```bash
git add .
git commit -m "refactor(ui): 将成员状态列表置于左侧边栏顶部"
```
