import type {
  AgentBackend,
  AgentEvent,
  AgentInfo,
  AgentTurnPhase,
  ChatMessage,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  Team,
  TeamAgent,
} from '@shared/types';

/** 当前选中团队和成员在 UI 层的派生状态。 */
export type ActiveTeamState = {
  team: Team | null;
  activeSlotId: string | null;
  activeAgent: TeamAgent | null;
};

/** 当前 Agent 的运行时快照集合。 */
export type RuntimeSnapshots = {
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
};

/** 发送框工具栏操作当前 Agent 运行时配置所需的数据。 */
export type ComposerRuntimeTools = {
  agent?: TeamAgent | null;
  snapshots: RuntimeSnapshots;
  onSetModel: (model: string) => Promise<void>;
  onSetMode: (mode: string) => Promise<void>;
};

/** 应用通知在 UI 中使用的严重程度。 */
export type AppNotificationLevel = 'info' | 'success' | 'warning' | 'error';

/** 全局通知中心展示的通知记录。 */
export type AppNotification = {
  id: string;
  title: string;
  message: string;
  level: AppNotificationLevel;
  createdAt: number;
  expiresAt: number;
};

/** Chat 面板内展示的局部通知记录。 */
export type ChatNotification = AppNotification & {
  teamId?: string;
  slotId?: string;
  conversationId?: string;
};

/** 团队详情抽屉的打开状态。 */
export type TeamDrawerState = {
  open: boolean;
};

/** 创建团队时从 UI 提交给后端的字段。 */
export type CreateTeamInput = {
  name: string;
  workspaceId?: string;
  leaderBackend: AgentBackend;
  leaderModel?: string;
};

/** 添加 Agent 时从 UI 提交给后端的字段。 */
export type AddAgentInput = {
  name: string;
  backend: AgentBackend;
  model?: string;
};

/** 会话主视图展示消息和当前运行阶段的状态。 */
export type ConversationViewState = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
};

/** 后端 Agent CLI 可用性探测结果。 */
export type BackendAvailability = {
  backends: AgentInfo[];
};

/** 推送全局通知时调用方提供的内容。 */
export type PushNotificationInput = {
  title: string;
  message: string;
  level?: AppNotificationLevel;
};

/** 根据会话 ID 解析活动 Agent 的通知上下文。 */
export type RuntimeNotificationAgentContext = {
  teamId: string;
  slotId: string;
  agent: TeamAgent;
};

/** 根据当前选择和会话映射决定通知进入全局层还是 Chat 局部层。 */
export type RuntimeNotificationContext = {
  activeTeamId?: string | null;
  activeSlotId?: string | null;
  activeConversationId?: string | null;
  agentsByConversation?: Record<string, RuntimeNotificationAgentContext | undefined>;
};

/** UI 活动流使用的 Agent 事件别名。 */
export type ActivityEvent = AgentEvent;
