import type { ChatMessage } from '../../shared/types';
import type { ConversationRepositoryPort } from '../db/conversationRepository';

export type MemoryContextBuildInput = {
  conversationId: string;
  beforeSequence?: number;
  maxMessages?: number;
  maxChars?: number;
};

/**
 * 从本地消息历史构造 ACP session 恢复失败时的兜底上下文。
 */
export class MemoryContextService {
  constructor(private readonly repo: Pick<ConversationRepositoryPort, 'listMessages'>) {}

  /**
   * 读取当前会话最近的稳定文本消息，并拼成一段只在新 ACP session 中注入的上下文。
   *
   * @param input - 会话、序列和长度限制
   * @returns 可注入 prompt 的历史上下文；没有有效历史时返回 null
   */
  buildRestoreContext(input: MemoryContextBuildInput): string | null {
    const maxSequence = input.beforeSequence ?? Number.MAX_SAFE_INTEGER;
    const messages = this.repo
      .listMessages(input.conversationId)
      .filter((message) => message.sequence < maxSequence)
      .filter(isStableTextMessage)
      .slice(-(input.maxMessages ?? 20));

    if (messages.length === 0) return null;

    const lines = messages.map((message) => {
      const role = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : message.role;
      const suffix = message.stopReason === 'cancelled' ? '（上次回复被用户中断）' : '';
      return `${role}${suffix}: ${message.content.trim()}`;
    });

    const body = lines.join('\n\n');
    const maxChars = input.maxChars ?? 12000;
    const clippedBody = body.length > maxChars ? body.slice(-maxChars) : body;

    return [
      '以下是当前会话在本地数据库中恢复出的历史上下文。',
      '这些内容用于在 ACP 后端 session 无法恢复时帮助你接续对话。',
      '不要逐字复述历史，除非用户要求。',
      '',
      clippedBody,
    ].join('\n');
  }
}

/** 判断消息是否适合作为恢复上下文，排除仍在流式输出的内容。 */
function isStableTextMessage(message: ChatMessage): boolean {
  return message.type === 'text' && Boolean(message.content.trim()) && message.status !== 'streaming';
}
