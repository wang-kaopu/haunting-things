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
  onSetMode: (mode: string) => Promise<void>;
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
  backends: AgentInfo[];
};

export type PushNotificationInput = {
  title: string;
  message: string;
  level?: AppNotificationLevel;
};

export type RuntimeNotificationContext = {
  activeAgentsByConversation?: Record<string, TeamAgent | undefined>;
};

export type ActivityEvent = AgentEvent;
