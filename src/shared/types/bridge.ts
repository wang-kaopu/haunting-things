import type {
  AgentBackend,
  AgentEvent,
  AgentHealth,
  AgentInfo,
  PermissionRequest,
  PermissionResponse,
} from '@shared/types/agent';
import type {
  AttachmentRef,
  ChatMessage,
  Conversation,
  ConversationCommands,
  ConversationListInput,
  ConversationListResult,
  ConversationMode,
  ConversationModels,
  ConversationMcpServer,
  ConversationSummary,
  ConversationStatus,
  ConversationUsage,
} from '@shared/types/conversation';
import type {
  Team,
  TeamAgent,
  TeamAgentStatus,
  TeamMailboxEntry,
  TeamTask,
  TeamWithWorkspace,
} from '@shared/types/team';
import type { Workspace, WorkspaceDirectoryListing, WorkspaceEntry, WorkspaceRoot } from '@shared/types/workspace';

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
  'workspace.root': { params: void; result: WorkspaceRoot };
  'workspace.browse': {
    params: { relativePath?: string };
    result: WorkspaceDirectoryListing;
  };
  'workspace.selectDirectory': {
    params: { relativePath?: string };
    result: Workspace;
  };
  'workspace.createTemporary': { params: { name?: string }; result: Workspace };
  'workspace.list': { params: void; result: Workspace[] };
  'workspace.get': { params: { workspaceId: string }; result: Workspace | null };
  'workspace.tree': {
    params: { workspaceId: string; relativePath?: string; search?: string };
    result: WorkspaceEntry[];
  };
  'workspace.readTextFile': {
    params: { workspaceId: string; relativePath: string };
    result: { content: string };
  };
  'workspace.writeTextFile': {
    params: { workspaceId: string; relativePath: string; content: string };
    result: { written: true };
  };
  'workspace.mkdir': { params: { workspaceId: string; relativePath: string }; result: { created: true } };
  'workspace.rename': {
    params: { workspaceId: string; relativePath: string; newName: string };
    result: { renamed: true };
  };
  'workspace.deleteEntry': {
    params: { workspaceId: string; relativePath: string };
    result: { deleted: true };
  };
  'workspace.delete': {
    params: { workspaceId: string };
    result: { deleted: true; deletedTeams: number; deletedConversations: number };
  };
  'workspace.openPath': {
    params: { workspaceId: string; relativePath?: string };
    result: { opened: true };
  };
  'workspace.revealPath': {
    params: { workspaceId: string; relativePath?: string };
    result: { revealed: true };
  };
  'conversation.create': {
    params: { backend: AgentBackend; workspaceId?: string; name?: string; model?: string; mcpServers?: ConversationMcpServer[] };
    result: ConversationSummary;
  };
  'conversation.setWorkspace': {
    params: { conversationId: string; workspaceId: string };
    result: ConversationSummary;
  };
  'conversation.setModel': {
    params: { conversationId: string; model: string };
    result: Conversation;
  };
  'conversation.setMode': {
    params: { conversationId: string; mode: string };
    result: ConversationMode;
  };
  'conversation.list': { params: ConversationListInput | void; result: ConversationListResult };
  'conversation.get': { params: { conversationId: string }; result: Conversation | null };
  'conversation.messages': { params: { conversationId: string }; result: ChatMessage[] };
  'conversation.agentEvents': { params: { conversationId: string; limit?: number }; result: AgentEvent[] };
  'conversation.commands': { params: { conversationId: string }; result: ConversationCommands | null };
  'conversation.models': { params: { conversationId: string }; result: ConversationModels | null };
  'conversation.mode': { params: { conversationId: string }; result: ConversationMode | null };
  'conversation.sendMessage': {
    params: { conversationId: string; content: string; files?: string[] };
    result: { accepted: true };
  };
  'conversation.cancel': {
    params: { conversationId: string };
    result: { accepted: boolean; error?: string };
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
    params: { name: string; workspaceId?: string; leaderBackend: AgentBackend; leaderModel?: string };
    result: TeamWithWorkspace | Team;
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
  'conversation.updated': Conversation;
  'team.agent.status': { teamId: string; slotId: string; status: TeamAgentStatus; error?: string };
  'team.agent.prompt': { teamId: string; slotId: string; conversationId: string; prompt: string };
  'team.agent.message': { teamId: string; entry: TeamMailboxEntry };
  'team.agent.added': { teamId: string; agent: TeamAgent };
  'team.agent.removed': { teamId: string; slotId: string };
  'team.turn.finished': { teamId: string; slotId: string };
};
