下面是一版更细的**文件级 TypeScript 接口定义 + 组件 Props 设计 + 按文件重构 TODO 清单**。目标是把当前前端从“大型 `main.tsx`”整理成一个清晰的聊天工作台结构。

---

# 一、推荐目录结构

```text
src/renderer/
  main.tsx
  styles.css

  app/
    App.tsx
    Workbench.tsx

    types/
      ui.ts

    utils/
      format.ts
      guards.ts

    layout/
      Sidebar.tsx
      ChatLayout.tsx
      TeamDrawer.tsx

    team/
      TeamList.tsx
      TeamListItem.tsx
      TeamMemberList.tsx
      TeamMemberCard.tsx

    chat/
      ChatHeader.tsx
      MessageList.tsx
      MessageBubble.tsx
      SendBox.tsx
      ComposerTools.tsx
      ModelPicker.tsx
      UsageChip.tsx
      AgentCommandsMenu.tsx

    dialogs/
      CreateTeamDialog.tsx
      AddAgentDialog.tsx

    notifications/
      NotificationCenter.tsx
      ToastItem.tsx

    hooks/
      useTeams.ts
      useActiveTeam.ts
      useConversationStream.ts
      useRuntimeSnapshots.ts
      useNotifications.ts
      useTeamDrawer.ts
```

---

# 二、通用 UI 类型定义

## `src/renderer/app/types/ui.ts`

```ts
import type {
  AgentBackend,
  AgentEvent,
  AgentTurnPhase,
  BackendStatus,
  ChatMessage,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  Team,
  TeamAgent,
} from '../../shared/types';

export type ActiveTeamState = {
  team: Team | null;
  activeSlotId: string | null;
  activeAgent: TeamAgent | null;
};

export type RuntimeSnapshots = {
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
};

export type ComposerRuntimeTools = {
  agent?: TeamAgent | null;
  snapshots: RuntimeSnapshots;
  onSetModel: (model: string) => Promise<void>;
};

export type AppNotificationLevel = 'info' | 'success' | 'warning' | 'error';

export type AppNotification = {
  id: string;
  title: string;
  message: string;
  level: AppNotificationLevel;
  createdAt: number;
  expiresAt: number;
};

export type TeamDrawerState = {
  open: boolean;
};

export type CreateTeamInput = {
  name: string;
  leaderBackend: AgentBackend;
  leaderModel?: string;
};

export type AddAgentInput = {
  name: string;
  backend: AgentBackend;
  model?: string;
};

export type ConversationViewState = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
};

export type BackendAvailability = {
  backends: BackendStatus[];
};
```

说明：
`ui.ts` 只放前端组合类型，不要污染 `shared/types.ts`。后端协议类型仍然从 `../../shared/types` 引入。

---

# 三、工具函数设计

## `src/renderer/app/utils/format.ts`

```ts
import type {
  AgentEvent,
  AgentTurnPhase,
  ChatMessage,
  ConversationUsage,
  TeamAgent,
} from '../../shared/types';

export function formatAgentStatus(status: TeamAgent['status']): string {
  const map: Record<TeamAgent['status'], string> = {
    idle: '空闲',
    active: '运行中',
    failed: '错误',
    stopped: '已停止',
  };

  return map[status] ?? status;
}

export function formatPhase(phase?: AgentTurnPhase): string {
  if (!phase) return '';

  const map: Record<AgentTurnPhase, string> = {
    queued: '排队中',
    thinking: '正在思考',
    planning: '正在规划',
    replying: '正在回复',
    tool_calling: '调用工具',
    waiting_permission: '等待授权',
    failed: '返回错误',
    done: '已完成',
  };

  return map[phase] ?? phase;
}

export function formatUsagePercent(usage?: ConversationUsage | null): string {
  if (!usage || usage.size <= 0) return '';

  const percent = Math.round((usage.used / usage.size) * 100);
  return `${percent}%`;
}

export function formatUsageShort(usage?: ConversationUsage | null): string {
  if (!usage) return 'Usage';

  return `${usage.used.toLocaleString()} / ${usage.size.toLocaleString()}`;
}

export function formatAgentEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent.turn.started':
      return '开始新一轮任务';
    case 'agent.thinking':
      return '正在思考';
    case 'agent.plan':
      return event.entries.length ? `正在规划：${event.entries.join(' / ')}` : '正在规划';
    case 'agent.tool.call':
      return `调用工具：${event.title || event.toolName || event.toolCallId}`;
    case 'agent.tool.update':
      return `工具运行中：${event.title || event.toolCallId}`;
    case 'agent.tool.result':
      return event.isError
        ? `工具返回错误：${event.title || event.toolName || event.toolCallId}`
        : `工具调用完成：${event.title || event.toolName || event.toolCallId}`;
    case 'agent.permission.request':
      return `等待授权：${event.title}`;
    case 'agent.error':
      return `返回错误：${event.message}`;
    case 'agent.done':
      return event.status === 'idle' ? '本轮完成' : `本轮结束：${event.status}`;
    case 'agent.reply.delta':
      return '正在回复';
    case 'agent.reply.done':
      return '回复完成';
  }
}

export function getMessageFallbackText(
  message: ChatMessage,
  activePhase?: AgentTurnPhase
): string {
  if (message.content) return message.content;

  if (message.status !== 'streaming') return '';

  if (activePhase === 'thinking') return '正在思考...';
  if (activePhase === 'planning') return '正在规划...';
  if (activePhase === 'tool_calling') return '正在调用工具...';

  return '正在回复...';
}
```

---

## `src/renderer/app/utils/guards.ts`

```ts
export function isWrappedTeamPrompt(content: string): boolean {
  return (
    content.startsWith('You are ') &&
    content.includes('Current teammates:') &&
    content.includes('Available team RPC tools:')
  );
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
```

---

# 四、顶层组件 Props 设计

## `src/renderer/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## `src/renderer/app/App.tsx`

```ts
export type AppProps = {};
```

```tsx
export function App(_props: AppProps): React.ReactElement {
  // 登录态、LoginView、Workbench
}
```

如果你已有登录组件，可以保留原逻辑，只把登录后的部分交给 `Workbench`。

---

## `src/renderer/app/Workbench.tsx`

```ts
import type {
  AgentBackend,
  ChatMessage,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  Team,
  TeamAgent,
} from '../shared/types';
import type { AddAgentInput, CreateTeamInput } from './types/ui';

export type WorkbenchProps = {
  onLogout: () => void;
};

export type WorkbenchData = {
  teams: Team[];
  activeTeam: Team | null;
  activeAgent: TeamAgent | null;
  messages: ChatMessage[];
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
};

export type WorkbenchActions = {
  onCreateTeam: (input: CreateTeamInput) => Promise<void>;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onSelectTeam: (teamId: string) => void;
  onSelectAgent: (slotId: string) => void;
  onAddAgent: (input: AddAgentInput) => Promise<void>;
  onSendTeamMessage: (content: string) => Promise<void>;
  onSetAgentModel: (model: string) => Promise<void>;
};
```

`Workbench` 内部组合：

```tsx
<main className={drawerOpen ? 'app-shell drawer-open' : 'app-shell drawer-collapsed'}>
  <Sidebar ... />
  <ChatLayout ... />
  <TeamDrawer ... />
  <NotificationCenter />
</main>
```

---

# 五、左侧 Sidebar 组件

## `src/renderer/app/layout/Sidebar.tsx`

```ts
import type { Team } from '../../../shared/types';

export type SidebarProps = {
  username?: string;
  teams: Team[];
  activeTeamId: string | null;
  onCreateTeamClick: () => void;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onLogout: () => void;
};
```

职责：

```text
1. 展示 Haunting Souls / admin
2. 创建团队按钮
3. TeamList
4. 退出登录
```

---

## `src/renderer/app/team/TeamList.tsx`

```ts
import type { Team } from '../../../shared/types';

export type TeamListProps = {
  teams: Team[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
};
```

---

## `src/renderer/app/team/TeamListItem.tsx`

```ts
import type { Team } from '../../../shared/types';

export type TeamListItemProps = {
  team: Team;
  active: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
};
```

内部状态：

```ts
const [menuOpen, setMenuOpen] = useState(false);
const [deleting, setDeleting] = useState(false);
```

展示：

```text
Team6       ⋯
```

删除放入 popover，不常驻红色按钮。

---

# 六、中间 Chat 组件

## `src/renderer/app/layout/ChatLayout.tsx`

```ts
import type {
  AgentTurnPhase,
  ChatMessage,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  Team,
  TeamAgent,
} from '../../../shared/types';

export type ChatLayoutProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onAddAgentClick: () => void;
  onSendMessage: (content: string) => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
};
```

组合：

```tsx
<section className="chat-layout">
  <ChatHeader ... />
  <MessageList ... />
  <SendBox ... />
</section>
```

---

## `src/renderer/app/chat/ChatHeader.tsx`

```ts
import type {
  AgentTurnPhase,
  ConversationUsage,
  Team,
  TeamAgent,
} from '../../../shared/types';

export type ChatHeaderProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  onAddAgentClick: () => void;
};
```

展示内容：

```text
Team6
Leader
16,902 / 258,400 7%
已完成
[添加 Agent]
```

---

## `src/renderer/app/chat/MessageList.tsx`

```ts
import type { AgentTurnPhase, ChatMessage } from '../../../shared/types';

export type MessageListProps = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
};
```

内部状态：

```ts
const [pinnedToBottom, setPinnedToBottom] = useState(true);
const [newMessageCount, setNewMessageCount] = useState(0);
```

方法：

```ts
function isNearBottom(element: HTMLDivElement): boolean;
function jumpToBottom(): void;
```

---

## `src/renderer/app/chat/MessageBubble.tsx`

```ts
import type { AgentTurnPhase, ChatMessage } from '../../../shared/types';

export type MessageBubbleProps = {
  message: ChatMessage;
  activePhase?: AgentTurnPhase;
};
```

职责：

```text
1. 普通 user / assistant 消息展示
2. streaming 空消息 fallback
3. error 状态展示
4. 历史 wrapped prompt 折叠兼容
```

---

## `src/renderer/app/chat/SendBox.tsx`

```ts
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../shared/types';

export type SendBoxProps = {
  disabled?: boolean;
  activeAgent?: TeamAgent | null;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onSend: (content: string) => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
};
```

内部状态：

```ts
const [content, setContent] = useState('');
const [sending, setSending] = useState(false);
const [error, setError] = useState('');
```

结构：

```tsx
<div className="composer">
  <textarea />
  <div className="composer-footer">
    <ComposerTools ... />
    <button>发送</button>
  </div>
</div>
```

---

## `src/renderer/app/chat/ComposerTools.tsx`

```ts
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../shared/types';

export type ComposerToolsProps = {
  activeAgent?: TeamAgent | null;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onSetModel: (model: string) => Promise<void>;
};
```

组合：

```tsx
<div className="composer-tools">
  <ModelPicker ... />
  <UsageChip usage={usage} />
  <AgentCommandsMenu commands={commands} />
</div>
```

---

## `src/renderer/app/chat/ModelPicker.tsx`

```ts
import type { ConversationModels, TeamAgent } from '../../../shared/types';

export type ModelPickerProps = {
  agent?: TeamAgent | null;
  models?: ConversationModels | null;
  onSetModel: (model: string) => Promise<void>;
};
```

内部状态：

```ts
const [open, setOpen] = useState(false);
const [customModel, setCustomModel] = useState('');
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState('');
```

展示：

```text
模型：gpt-xxx ▼
```

没有模型快照时：

```text
模型：手动输入
```

---

## `src/renderer/app/chat/UsageChip.tsx`

```ts
import type { ConversationUsage } from '../../../shared/types';

export type UsageChipProps = {
  usage?: ConversationUsage | null;
};
```

展示：

```text
16,902 / 258,400 · 7%
```

---

## `src/renderer/app/chat/AgentCommandsMenu.tsx`

```ts
import type { ConversationCommands } from '../../../shared/types';

export type AgentCommandsMenuProps = {
  commands?: ConversationCommands | null;
};
```

内部状态：

```ts
const [open, setOpen] = useState(false);
```

展示：

```text
命令 11
```

点击后 popover：

```text
review
review-branch
review-commit
...
```

---

# 七、右侧团队抽屉

## `src/renderer/app/layout/TeamDrawer.tsx`

```ts
import type { Team, TeamAgent } from '../../../shared/types';

export type TeamDrawerProps = {
  open: boolean;
  team: Team | null;
  activeSlotId: string | null;
  onToggle: () => void;
  onSelectAgent: (slotId: string) => void;
};
```

结构：

```tsx
<aside className={open ? 'team-drawer open' : 'team-drawer collapsed'}>
  <button className="drawer-toggle" onClick={onToggle}>
    {open ? '›' : '‹'}
  </button>

  {open ? (
    <>
      <h2>团队</h2>
      <TeamMemberList ... />
    </>
  ) : null}
</aside>
```

---

## `src/renderer/app/team/TeamMemberList.tsx`

```ts
import type { TeamAgent } from '../../../shared/types';

export type TeamMemberListProps = {
  agents: TeamAgent[];
  activeSlotId: string | null;
  onSelectAgent: (slotId: string) => void;
};
```

---

## `src/renderer/app/team/TeamMemberCard.tsx`

```ts
import type {
  AgentTurnPhase,
  ConversationCommands,
  TeamAgent,
} from '../../../shared/types';

export type TeamMemberCardProps = {
  agent: TeamAgent;
  active: boolean;
  phase?: AgentTurnPhase;
  commands?: ConversationCommands | null;
  onSelect: () => void;
};
```

压缩显示：

```text
Leader                         空闲
codex · 11 命令
```

不要再做大卡片。

---

# 八、弹窗组件

## `src/renderer/app/dialogs/CreateTeamDialog.tsx`

```ts
import type { AgentBackend } from '../../../shared/types';
import type { CreateTeamInput } from '../types/ui';

export type CreateTeamDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateTeamInput) => Promise<void>;
};

export type CreateTeamFormState = {
  name: string;
  leaderBackend: AgentBackend;
  leaderModel: string;
};
```

内部状态：

```ts
const [form, setForm] = useState<CreateTeamFormState>({
  name: '',
  leaderBackend: 'codex',
  leaderModel: '',
});
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState('');
```

---

## `src/renderer/app/dialogs/AddAgentDialog.tsx`

```ts
import type { AgentBackend } from '../../../shared/types';
import type { AddAgentInput } from '../types/ui';

export type AddAgentDialogProps = {
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (input: AddAgentInput) => Promise<void>;
};

export type AddAgentFormState = {
  name: string;
  backend: AgentBackend;
  model: string;
};
```

---

# 九、通知中心组件

## `src/renderer/app/notifications/NotificationCenter.tsx`

```ts
import type { AppNotification } from '../types/ui';

export type NotificationCenterProps = {
  items: AppNotification[];
  onRemove: (id: string) => void;
};
```

职责：

```text
1. 右下角展示 toast
2. 每秒清理过期通知
3. 不保存历史
```

---

## `src/renderer/app/notifications/ToastItem.tsx`

```ts
import type { AppNotification } from '../types/ui';

export type ToastItemProps = {
  item: AppNotification;
  onClose: () => void;
};
```

展示：

```text
[Agent 错误] xxx
[任务完成] Leader 已完成当前轮任务
```

---

# 十、Hooks 设计

## `src/renderer/app/hooks/useTeams.ts`

```ts
import type { Team, TeamAgent } from '../../../shared/types';
import type { AddAgentInput, CreateTeamInput } from '../types/ui';

export type UseTeamsResult = {
  teams: Team[];
  loading: boolean;
  error: string;
  refreshTeams: () => Promise<void>;
  createTeam: (input: CreateTeamInput) => Promise<Team>;
  deleteTeam: (teamId: string) => Promise<void>;
  addAgent: (teamId: string, input: AddAgentInput) => Promise<TeamAgent>;
  updateTeam: (team: Team) => void;
};
```

职责：

```text
team.list
team.create
team.delete
team.addAgent
维护 teams state
```

---

## `src/renderer/app/hooks/useActiveTeam.ts`

```ts
import type { Team, TeamAgent } from '../../../shared/types';

export type UseActiveTeamInput = {
  teams: Team[];
};

export type UseActiveTeamResult = {
  activeTeamId: string | null;
  activeSlotId: string | null;
  activeTeam: Team | null;
  activeAgent: TeamAgent | null;
  setActiveTeamId: (teamId: string | null) => void;
  setActiveSlotId: (slotId: string | null) => void;
  selectTeam: (teamId: string) => void;
  selectAgent: (slotId: string) => void;
};
```

职责：

```text
当前选中的 team / agent 选择逻辑
```

---

## `src/renderer/app/hooks/useConversationStream.ts`

```ts
import type {
  AgentEvent,
  AgentTurnPhase,
  ChatMessage,
  TeamAgent,
} from '../../../shared/types';

export type UseConversationStreamInput = {
  activeAgent: TeamAgent | null;
};

export type UseConversationStreamResult = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  agentEvents: AgentEvent[];
  loading: boolean;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sendTeamMessage: (teamId: string, content: string) => Promise<void>;
};
```

职责：

```text
1. activeAgent 变化时加载 conversation.messages / agentEvents
2. 监听 conversation.stream
3. 监听 conversation.agentEvent
4. 计算 activePhase
```

---

## `src/renderer/app/hooks/useRuntimeSnapshots.ts`

```ts
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../shared/types';

export type UseRuntimeSnapshotsInput = {
  activeAgent: TeamAgent | null;
};

export type UseRuntimeSnapshotsResult = {
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  setModel: (teamId: string, slotId: string, model: string) => Promise<void>;
};
```

职责：

```text
1. activeAgent 变化时拉 conversation.usage / commands / models / mode
2. 监听 conversation.usage / commands / models / mode
3. 提供 setModel
```

---

## `src/renderer/app/hooks/useNotifications.ts`

```ts
import type { AgentEvent, TeamAgent } from '../../../shared/types';
import type { AppNotification, AppNotificationLevel } from '../types/ui';

export type PushNotificationInput = {
  title: string;
  message: string;
  level?: AppNotificationLevel;
};

export type UseNotificationsInput = {
  activeAgentsByConversation?: Record<string, TeamAgent | undefined>;
};

export type UseNotificationsResult = {
  items: AppNotification[];
  push: (input: PushNotificationInput) => void;
  remove: (id: string) => void;
  clear: () => void;
};
```

职责：

```text
1. 提供 toast state
2. 监听关键事件并转 toast
3. 10 秒自动消失
```

事件映射建议：

```ts
agent.error              → error toast
agent.done(status=idle)  → success toast
agent.permission.request → warning toast
team.agent.message       → info toast
```

---

## `src/renderer/app/hooks/useTeamDrawer.ts`

```ts
export type UseTeamDrawerResult = {
  open: boolean;
  toggle: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
};
```

---

# 十一、按文件分段重构 TODO 清单

## 阶段 1：只拆文件，不改功能

### `main.tsx`

* [x] 保留 ReactDOM 挂载
* [x] 移除 Workbench 业务代码
* [x] 引入 `App`

### 新增 `app/App.tsx`

* [x] 接管登录态
* [x] 登录后渲染 `Workbench`

### 新增 `app/Workbench.tsx`

* [x] 临时搬迁原 `main.tsx` 的主要状态
* [x] 先保证功能不变
* [x] 渲染 `Sidebar / ChatLayout / TeamDrawer / NotificationCenter`

---

## 阶段 2：拆左侧 Sidebar

### 新增 `layout/Sidebar.tsx`

* [x] 迁移品牌、用户名、创建团队、退出登录
* [x] 使用 `TeamList`

### 新增 `team/TeamList.tsx`

* [x] 迁移 teams 列表渲染

### 新增 `team/TeamListItem.tsx`

* [x] 把 Delete 改成 `⋯` 菜单
* [x] 删除动作放进 popover

---

## 阶段 3：拆中间 Chat

### 新增 `layout/ChatLayout.tsx`

* [x] 迁移中间主区域布局
* [x] 组合 `ChatHeader / MessageList / SendBox`

### 新增 `chat/ChatHeader.tsx`

* [x] 迁移团队标题、activeAgent、UsageBadge、添加 Agent 按钮

### 新增 `chat/MessageList.tsx`

* [x] 迁移消息列表
* [x] 保留智能滚动逻辑

### 新增 `chat/MessageBubble.tsx`

* [x] 迁移单条消息渲染
* [x] 支持旧 wrapper prompt 折叠

### 新增 `chat/SendBox.tsx`

* [x] 迁移输入框
* [x] 加入 sending/error 状态
* [x] 嵌入 `ComposerTools`

---

## 阶段 4：迁移配置到输入框

### 新增 `chat/ComposerTools.tsx`

* [x] 接收 activeAgent、usage、models、commands、mode
* [x] 组合模型、Usage、命令入口

### 新增 `chat/ModelPicker.tsx`

* [x] 支持 snapshot model list
* [x] 支持手动输入 model
* [x] 调用 `onSetModel`

### 新增 `chat/UsageChip.tsx`

* [x] 紧凑显示 token usage

### 新增 `chat/AgentCommandsMenu.tsx`

* [x] 显示命令数量
* [x] popover 展示命令列表
* [x] 不再使用右侧大块 Agent Commands panel

---

## 阶段 5：右侧只保留团队抽屉

### 新增 `layout/TeamDrawer.tsx`

* [x] 支持 open/collapsed
* [x] 只显示 TeamMemberList
* [x] 增加小箭头 toggle

### 新增 `team/TeamMemberList.tsx`

* [x] 渲染成员列表

### 新增 `team/TeamMemberCard.tsx`

* [x] 压缩卡片高度
* [x] 第一行：name + status
* [x] 第二行：backend / model / commands count
* [x] 点击切换 activeAgent

### 删除/停用旧 Inspector

* [x] 删除 Backends 面板
* [x] 删除 Activity 面板
* [x] 删除 Config 面板
* [x] 删除 Debug 面板
* [x] 删除 InspectorTab 状态

---

## 阶段 6：通知中心替代 timeline/debug 固定展示

### 新增 `notifications/NotificationCenter.tsx`

* [x] 渲染右下角 toast 列表
* [x] 自动清理过期通知

### 新增 `notifications/ToastItem.tsx`

* [x] 单条 toast UI
* [x] 支持关闭

### 新增 `hooks/useNotifications.ts`

* [x] 维护 notification state
* [x] 提供 `push/remove/clear`
* [x] 监听关键事件转通知
* [x] 每条通知 10 秒后消失

### 移除 timeline 固定区块

* [x] 不再在页面永久展示 timeline
* [x] team.agent.message / agent.error / agent.done 转 toast

---

## 阶段 7：弹窗替代 prompt/confirm

### 新增 `dialogs/CreateTeamDialog.tsx`

* [x] 表单字段：name / leaderBackend / leaderModel
* [x] 校验团队名
* [x] loading/error

### 新增 `dialogs/AddAgentDialog.tsx`

* [x] 表单字段：name / backend / model
* [x] 校验 name
* [x] loading/error

### 替换旧逻辑

* [x] 删除 `window.prompt` 创建团队
* [x] 删除 `window.prompt` 添加 Agent
* [x] 删除 `pickBackend()`

---

## 阶段 8：Hooks 收口

### 新增 `hooks/useTeams.ts`

* [x] 迁移 team.list/create/delete/addAgent
* [x] 提供 teams state

### 新增 `hooks/useActiveTeam.ts`

* [x] 管理 activeTeamId / activeSlotId
* [x] teams 变化时修正 activeTeam

### 新增 `hooks/useConversationStream.ts`

* [x] 迁移 messages 加载
* [x] 监听 conversation.stream
* [x] 监听 conversation.agentEvent
* [x] 计算 activePhase

### 新增 `hooks/useRuntimeSnapshots.ts`

* [x] 迁移 usage / commands / models / mode
* [x] 监听对应事件
* [x] 提供 setModel

### 新增 `hooks/useTeamDrawer.ts`

* [x] 管理 drawer open/close

---

# 十二、建议提交顺序

```text
refactor(ui): 拆分 main.tsx 基础布局组件
refactor(ui): 提取聊天区和团队列表组件
refactor(ui): 将右侧面板简化为团队抽屉
feat(ui): 将模型和命令入口迁移到输入框
feat(ui): 增加通知中心替代固定 timeline
feat(ui): 使用弹窗创建团队和添加 Agent
refactor(ui): 提取团队和会话状态 hooks
```

整体原则：**先拆结构，再迁移功能，再删旧面板，最后抽 hooks**。这样每一步都比较容易编译和回滚。

实现状态：前端重构 TODO 清单已完成。
