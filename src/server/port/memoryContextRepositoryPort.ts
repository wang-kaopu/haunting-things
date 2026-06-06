import type { ChatMessage } from '@shared/types';

/** 恢复上下文构建只需要读取消息历史。 */
export interface MemoryContextRepositoryPort {
  listMessages(conversationId: string): ChatMessage[];
}
