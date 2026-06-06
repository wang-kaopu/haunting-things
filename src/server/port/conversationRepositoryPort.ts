import type {
  AcpAvailableCommand,
  AcpSessionRestoreMethod,
  AcpSessionRestoreStatus,
  AgentEvent,
  ChatMessage,
  Conversation,
  ConversationCommands,
  ConversationListInput,
  ConversationListResult,
  ConversationMcpServer,
  ConversationMode,
  ConversationModels,
  ConversationWithWorkspace,
  StopReason,
} from '@shared/types';

/** 会话服务依赖的持久化接口。 */
export interface ConversationRepositoryPort {
  createConversation(conversation: Conversation): Conversation;
  updateConversationModel(id: string, model: string | undefined): void;
  updateConversationStatus(id: string, status: Conversation['status']): void;
  updateConversationAcpSession(id: string, acpSessionId: string): Conversation | null;
  updateConversationSessionRestoreState(
    id: string,
    patch: {
      acpSessionId: string;
      sessionRestoreStatus: AcpSessionRestoreStatus;
      sessionRestoreMethod: AcpSessionRestoreMethod;
      sessionRestoreError?: string;
      sessionRestoredAt: number;
    }
  ): Conversation | null;
  updateConversationRuntimeState(
    id: string,
    patch: {
      sessionMode?: string;
      currentModelId?: string;
      usageSize?: number;
      usageUsed?: number;
      usageRatio?: number;
      usageUpdatedAt?: number;
    }
  ): Conversation | null;
  updateConversationTurnResult(
    id: string,
    patch: {
      lastTurnId?: string;
      lastStopReason?: StopReason;
      lastError?: string;
    }
  ): Conversation | null;
  listConversations(): Conversation[];
  listConversationsByWorkspace(workspaceId: string): Conversation[];
  countConversationsByWorkspace(workspaceId: string): number;
  deleteConversationsByWorkspace(workspaceId: string): number;
  listConversationsByStatus(status: Conversation['status']): Conversation[];
  getConversation(id: string): Conversation | null;
  getConversationWithWorkspace(id: string): ConversationWithWorkspace | null;
  listConversationsWithWorkspace(): ConversationWithWorkspace[];
  listConversationSummaries(input?: ConversationListInput): ConversationListResult;
  updateConversationWorkspace(input: { conversationId: string; workspaceId: string }): Conversation | null;
  finalizeInterruptedConversation(input: {
    conversationId: string;
    lastTurnId?: string;
    reason: 'app_restarted' | 'runtime_missing';
    message: string;
  }): void;
  finalizeStreamingMessages(input: { conversationId: string; stopReason: StopReason }): void;
  addMessage(message: ChatMessage): ChatMessage;
  updateMessage(message: ChatMessage): void;
  listMessages(conversationId: string): ChatMessage[];
  messageExists(messageId: string): boolean;
  addAgentEvent(event: AgentEvent): AgentEvent;
  listAgentEvents(conversationId: string, limit?: number): AgentEvent[];
  replaceConversationMcpServers(conversationId: string, servers: ConversationMcpServer[]): void;
  listConversationMcpServers(conversationId: string): ConversationMcpServer[];
  replaceConversationCommands(conversationId: string, commands: AcpAvailableCommand[], updatedAt: number): void;
  getConversationCommands(conversationId: string): ConversationCommands | null;
  replaceConversationModels(conversationId: string, snapshot: ConversationModels): void;
  getConversationModels(conversationId: string): ConversationModels | null;
  replaceConversationMode(conversationId: string, snapshot: ConversationMode): void;
  getConversationMode(conversationId: string): ConversationMode | null;
}
