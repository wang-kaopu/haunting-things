import type { AcpAvailableCommand, AgentBackend } from '@shared/types/agent';
import type { Workspace } from '@shared/types/workspace';

/** Conversation 当前状态。 */
export type ConversationStatus = 'idle' | 'running' | 'failed' | 'stopped';

/** Agent 单轮停止原因。 */
export type StopReason = 'done' | 'cancelled' | 'failed' | 'stopped';

/** ACP session 启动时的恢复结果。 */
export type AcpSessionRestoreStatus = 'restored' | 'new' | 'fallback' | 'unavailable' | 'failed';

/** ACP session 启动使用的协议方法。 */
export type AcpSessionRestoreMethod = 'session/load' | 'session/resume' | 'session/new';

/** 会话级 MCP server 快照，用于重启后恢复工具环境。 */
export type ConversationMcpServer = {
  id?: string;
  name: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  enabled?: boolean;
};

/** 单个 Conversation 的元数据。 */
export type Conversation = {
  id: string;
  backend: AgentBackend;
  name: string;
  workspaceId: string;
  model?: string;
  status: ConversationStatus;
  acpSessionId?: string;
  sessionMode?: PermissionModeId;
  currentModelId?: string;
  lastTurnId?: string;
  lastStopReason?: StopReason;
  lastError?: string;
  usageSize?: number;
  usageUsed?: number;
  usageRatio?: number;
  usageUpdatedAt?: number;
  sessionRestoreStatus?: AcpSessionRestoreStatus;
  sessionRestoreMethod?: AcpSessionRestoreMethod;
  sessionRestoreError?: string;
  sessionRestoredAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** 附带工作区详情的会话视图。 */
export type ConversationWithWorkspace = Conversation & {
  workspace: Workspace;
};

/** 聊天消息的发送者角色。 */
export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

/** 当前支持的附件类型。 */
export type AttachmentKind = 'image';

/** 前端可见的附件引用。 */
export type AttachmentRef = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: number;
};

/** 服务端持久化附件记录，包含仅服务端使用的真实路径。 */
export type StoredAttachment = AttachmentRef & {
  path: string;
  sha256?: string;
};

/** 聊天消息类型，供历史回放和上下文恢复区分来源。 */
export type ChatMessageType = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'plan' | 'permission' | 'system';

/** 单条聊天消息，`status` 在流式输出期间为 `streaming`，完成后为 `done`。 */
export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  type: ChatMessageType;
  content: string;
  attachments?: AttachmentRef[];
  createdAt: number;
  status?: 'streaming' | 'done' | 'error';
  turnId?: string;
  sourceEventId?: string;
  stopReason?: StopReason;
  toolCallId?: string;
  permissionCallId?: string;
  parentMessageId?: string;
  sequence: number;
};

/** Conversation 的实时 usage 快照。 */
export type ConversationUsage = {
  conversationId: string;
  size: number;
  used: number;
  ratio: number;
  updatedAt: number;
};

/** Conversation 的实时可用命令快照。 */
export type ConversationCommands = {
  conversationId: string;
  commands: AcpAvailableCommand[];
  updatedAt: number;
};

/** ACP 权限模式。 */
export type PermissionModeId = 'read-only' | 'auto' | 'full-access' | 'bypassPermissions' | string;

/** Conversation 的实时模式快照。 */
export type ConversationMode = {
  conversationId: string;
  mode: PermissionModeId;
  updatedAt: number;
};

/** Conversation 的实时模型快照。 */
export type AcpModelInfo = {
  id: string;
  name?: string;
  description?: string;
};

/** Conversation 的实时模型快照。 */
export type ConversationModels = {
  conversationId: string;
  currentModelId?: string;
  models: AcpModelInfo[];
  updatedAt: number;
};
