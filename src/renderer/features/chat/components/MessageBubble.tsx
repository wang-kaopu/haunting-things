import type React from 'react';
import type { AgentTurnPhase, ChatMessage } from '../../../../shared/types';
import { getMessageFallbackText } from '../../../shared/utils/format';
import { isWrappedTeamPrompt } from '../../../shared/utils/guards';
import { MarkdownMessage } from './MarkdownMessage';

/** 单条聊天消息的展示输入。 */
export type MessageBubbleProps = {
  message: ChatMessage;
  activePhase?: AgentTurnPhase;
};

/**
 * GPT 风格消息气泡。
 *
 * - Assistant 消息：头像 + 正文流，无卡片背景。
 * - User 消息：靠右浅灰圆角气泡。
 * - Team wrapper prompt 默认折叠。
 */
export function MessageBubble({ message, activePhase }: MessageBubbleProps): React.ReactElement {
  const wrappedPrompt = message.role === 'user' && isWrappedTeamPrompt(message.content);
  const content = getMessageFallbackText(message, activePhase);
  const isError = message.status === 'error';

  if (message.role === 'user') {
    return (
      <article className={`message message--user${isError ? ' message--error' : ''}`}>
        <div className="message__user-bubble">
          {wrappedPrompt ? (
            <details className="debug-prompt-inline">
              <summary>历史包装 Prompt，已折叠</summary>
              <pre>{message.content}</pre>
            </details>
          ) : (
            content
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
        </div>
        {isError ? <p className="message-error">本轮回复失败，请查看通知详情。</p> : null}
      </article>
    );
  }

  return (
    <article className={`message message--assistant${isError ? ' message--error' : ''}`}>
      <div className="message__avatar">AI</div>
      <div className="message__content">
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
        {isError ? <p className="message-error">本轮回复失败，请查看通知详情。</p> : null}
      </div>
    </article>
  );
}
