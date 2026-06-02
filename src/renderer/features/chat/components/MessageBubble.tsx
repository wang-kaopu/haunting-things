import type React from 'react';
import type { AgentTurnPhase, ChatMessage } from '../../../../shared/types';
import { formatMessageRole, getMessageFallbackText } from '../../../shared/utils/format';
import { isWrappedTeamPrompt } from '../../../shared/utils/guards';
import { MarkdownMessage } from './MarkdownMessage';

/** 单条聊天消息的展示输入。 */
export type MessageBubbleProps = {
  message: ChatMessage;
  activePhase?: AgentTurnPhase;
};

/**
 * 渲染聊天消息正文和图片附件。
 *
 * Team wrapper prompt 属于运行时上下文，默认折叠，避免干扰用户阅读真实对话。
 */
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

      {message.attachments?.length ? (
        <div className="message-attachments">
          {message.attachments.map((attachment) =>
            attachment.kind === 'image' ? (
              <a href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id}>
                <img src={attachment.url} alt={attachment.name} />
              </a>
            ) : null
          )}
        </div>
      ) : null}

      {message.status === 'error' ? (
        <p className="message-error">本轮回复失败，请查看通知详情。</p>
      ) : null}
    </article>
  );
}
