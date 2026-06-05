import type { AgentBackend } from '@shared/types/agent';
import type { AttachmentRef } from '@shared/types/conversation';
import type { Workspace } from '@shared/types/workspace';

/** Team 中单个 Agent 的运行状态。 */
export type TeamAgentStatus = 'idle' | 'active' | 'failed' | 'stopped';

/** Team 中单个 Agent 成员的完整描述。 */
export type TeamAgent = {
  slotId: string;
  conversationId: string;
  role: 'leader' | 'teammate';
  backend: AgentBackend;
  model?: string;
  name: string;
  status: TeamAgentStatus;
};

/** Team 的完整描述，包含所有成员列表。 */
export type Team = {
  id: string;
  name: string;
  workspaceId: string;
  leaderSlotId: string;
  agents: TeamAgent[];
  createdAt: number;
  updatedAt: number;
};

/** 附带工作区详情的团队视图。 */
export type TeamWithWorkspace = Team & {
  workspace: Workspace;
};

/** Team 内部成员间的异步消息（存储在 mailbox 表）。 */
export type MailboxMessage = {
  id: string;
  teamId: string;
  toAgentId: string;
  fromAgentId: string;
  content: string;
  summary?: string;
  attachments?: AttachmentRef[];
  read: boolean;
  createdAt: number;
};

/** Team mailbox / timeline 的可展示条目。 */
export type TeamMailboxEntry = {
  message: MailboxMessage;
  fromAgentName: string;
  toAgentName: string;
  processed: boolean;
};

/** Team 任务状态。 */
export type TeamTaskStatus = 'pending' | 'done';

/** Team 内部的任务记录。 */
export type TeamTask = {
  id: string;
  teamId: string;
  title: string;
  description?: string;
  status: TeamTaskStatus;
  createdBySlotId?: string;
  assignedSlotId?: string;
  completedBySlotId?: string;
  completionSummary?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};
