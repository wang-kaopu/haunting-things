import type { AcpAvailableCommand, AgentBackend } from './agent';

/** Conversation 当前状态。 */
export type ConversationStatus = 'idle' | 'running' | 'failed' | 'stopped';

/** 单个 Conversation 的元数据。 */
export type Conversation = {
  id: string;
  backend: AgentBackend;
  name: string;
  workspace: string;
  model?: string;
  status: ConversationStatus;
  createdAt: number;
  updatedAt: number;
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

/** 单条聊天消息，`status` 在流式输出期间为 `streaming`，完成后为 `done`。 */
export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  attachments?: AttachmentRef[];
  createdAt: number;
  status?: 'streaming' | 'done' | 'error';
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

/** Conversation 的实时模式快照。 */
export type ConversationMode = {
  conversationId: string;
  mode: string;
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
