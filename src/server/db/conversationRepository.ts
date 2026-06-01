import type { Repository } from './db';

export type ConversationRepository = Pick<
  Repository,
  | 'createConversation'
  | 'updateConversationModel'
  | 'updateConversationStatus'
  | 'listConversations'
  | 'getConversation'
  | 'addMessage'
  | 'updateMessage'
  | 'listMessages'
  | 'addAgentEvent'
  | 'listAgentEvents'
>;
