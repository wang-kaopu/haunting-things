import type React from 'react';
import type { AgentTurnPhase, ChatMessage } from '../../../shared/types';
import { formatMessageRole, getMessageFallbackText } from '../utils/format';
import { isWrappedTeamPrompt } from '../utils/guards';
import { MarkdownMessage } from './MarkdownMessage';

export type MessageBubbleProps = {
  message: ChatMessage;
  activePhase?: AgentTurnPhase;
};

export function MessageBubble({ message, activePhase }: MessageBubbleProps): React.ReactElement {
  const wrappedPrompt = message.role === 'user' && isWrappedTeamPrompt(message.content);
  const content = getMessageFallbackText(message, activePhase);

  return (
    <article className={`message ${message.role} ${message.status === 'error' ? 'error' : ''}`}>
      <small>{formatMessageRole(message.role)}</small>

      {wrappedPrompt ? (
        <details className="debug-prompt-inline">
          <summary>历史包装 Prompt，已折叠</summary>
          <pre>{message.content}</pre>
        </details>
      ) : (
        <MarkdownMessage content={content} />
      )}

      {message.status === 'error' ? (
        <p className="message-error">本轮回复失败，请查看通知详情。</p>
      ) : null}
    </article>
  );
}
