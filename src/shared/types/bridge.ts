import type {
  AgentBackend,
  AgentEvent,
  AgentHealth,
  AgentInfo,
  PermissionRequest,
  PermissionResponse,
} from './agent';
import type {
  AttachmentRef,
  ChatMessage,
  Conversation,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationStatus,
  ConversationUsage,
} from './conversation';
import type {
  Team,
  TeamAgent,
  TeamAgentStatus,
  TeamMailboxEntry,
  TeamTask,
} from './team';

/** 服务器监听信息，用于 UI 展示访问地址。 */
export type ServerInfo = {
  host: string;
  port: number;
  allowRemote: boolean;
  restarting?: boolean;
  urls: string[];
};

/** 已登录用户的公开信息。 */
export type User = {
  id: string;
  username: string;
};

/**
 * WebSocket Bridge 可调用 API 的完整映射。
 * key 为 API 名称，value 包含 `params`（请求参数）和 `result`（返回值）类型。
 */
export type InvokeMap = {
  'attachment.upload': {
    params: { fileName: string; mimeType: string; dataBase64: string };
    result: AttachmentRef;
  };
  'attachment.delete': { params: { attachmentId: string }; result: { deleted: true } };
  'agent.list': { params: void; result: AgentInfo[] };
  'agent.health': { params: { backend: AgentBackend }; result: AgentHealth };
  'conversation.create': {
    params: { backend: AgentBackend; workspace?: string; name?: string; model?: string };
    result: Conversation;
  };
  'conversation.setModel': {
    params: { conversationId: string; model: string };
    result: Conversation;
  };
  'conversation.list': { params: void; result: Conversation[] };
  'conversation.messages': { params: { conversationId: string }; result: ChatMessage[] };
  'conversation.agentEvents': { params: { conversationId: string; limit?: number }; result: AgentEvent[] };
  'conversation.commands': { params: { conversationId: string }; result: ConversationCommands | null };
  'conversation.models': { params: { conversationId: string }; result: ConversationModels | null };
  'conversation.mode': { params: { conversationId: string }; result: ConversationMode | null };
  'conversation.sendMessage': {
    params: { conversationId: string; content: string; files?: string[] };
    result: { accepted: true };
  };
  'conversation.deleteMessage': { params: { messageId: string }; result: { deleted: true } };
  'conversation.deleteMessageAttachment': {
    params: { messageId: string; attachmentId: string };
    result: { deleted: true };
  };
  'conversation.confirmPermission': {
    params: { conversationId: string; callId: string; optionId: string };
    result: { accepted: boolean; error?: string };
  };
  'conversation.respondPermission': {
    params: { conversationId: string; callId: string } & PermissionResponse;
    result: { accepted: boolean; error?: string };
  };
  'team.create': {
    params: { name: string; workspace?: string; leaderBackend: AgentBackend; leaderModel?: string };
    result: Team;
  };
  'team.delete': { params: { teamId: string }; result: { deleted: true } };
  'team.addAgent': { params: { teamId: string; name: string; backend: AgentBackend; model?: string }; result: TeamAgent };
  'team.removeAgent': { params: { teamId: string; slotId: string }; result: { removed: true } };
  'team.setAgentModel': { params: { teamId: string; slotId: string; model: string }; result: TeamAgent };
  'team.finishTask': {
    params: { teamId: string; summary: string; taskId?: string };
    result: { finished: true };
  };
  'team.taskCreate': {
    params: {
      teamId: string;
      title: string;
      description?: string;
      assignedSlotId?: string;
      createdBySlotId?: string;
    };
    result: TeamTask;
  };
  'team.tasks': { params: { teamId: string }; result: TeamTask[] };
  'team.get': { params: { teamId: string }; result: Team | null };
  'team.list': { params: void; result: Team[] };
  'team.sendMessage': { params: { teamId: string; content: string; files?: string[] }; result: { accepted: true } };
  'team.sendMessageToAgent': {
    params: { teamId: string; slotId: string; content: string; files?: string[] };
    result: { accepted: true };
  };
  'team.timeline': { params: { teamId: string }; result: TeamMailboxEntry[] };
  'team.stop': { params: { teamId: string }; result: { stopped: true } };
  'server.info': { params: void; result: ServerInfo };
  'server.setRemoteAccess': { params: { allowRemote: boolean }; result: ServerInfo };
};

/**
 * WebSocket Bridge 服务端主动推送事件的完整映射。
 * key 为事件名称，value 为事件数据类型。
 */
export type EventMap = {
  'conversation.stream': { conversationId: string; message: ChatMessage };
  'conversation.agentEvent': AgentEvent;
  'conversation.usage': ConversationUsage;
  'conversation.commands': ConversationCommands;
  'conversation.models': ConversationModels;
  'conversation.mode': ConversationMode;
  'conversation.permission': PermissionRequest;
  'conversation.finish': { conversationId: string; status: ConversationStatus };
  'conversation.status': { conversationId: string; status: ConversationStatus; error?: string };
  'team.agent.status': { teamId: string; slotId: string; status: TeamAgentStatus; error?: string };
  'team.agent.prompt': { teamId: string; slotId: string; conversationId: string; prompt: string };
  'team.agent.message': { teamId: string; entry: TeamMailboxEntry };
  'team.agent.added': { teamId: string; agent: TeamAgent };
  'team.agent.removed': { teamId: string; slotId: string };
  'team.turn.finished': { teamId: string; slotId: string };
};
