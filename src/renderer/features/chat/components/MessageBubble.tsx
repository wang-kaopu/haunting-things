import type React from 'react';
import type { AgentTurnPhase, ChatMessage, TeamAgent } from '@shared/types';
import { getAgentIconAlt, getAgentIconSrc } from '@renderer/shared/utils/agentIcon';
import { getMessageFallbackText } from '@renderer/shared/utils/format';
import { isWrappedTeamPrompt } from '@renderer/shared/utils/guards';
import { MarkdownMessage } from '@renderer/features/chat/components/MarkdownMessage';
import { cn } from '@renderer/shared/lib/utils';

/** 单条聊天消息的展示输入。 */
export type MessageBubbleProps = {
  message: ChatMessage;
  activePhase?: AgentTurnPhase;
  assistantAgent?: TeamAgent | null;
};

/**
 * 新 风格消息气泡。
 *
 * - Assistant 消息：后端图标 + 正文流，无卡片背景。
 * - User 消息：靠右浅灰圆角气泡。
 * - Team wrapper prompt 默认折叠。
 */
export function MessageBubble({ message, activePhase, assistantAgent }: MessageBubbleProps): React.ReactElement {
  const wrappedPrompt = message.role === 'user' && isWrappedTeamPrompt(message.content);
  const content = getMessageFallbackText(message, activePhase);
  const isError = message.status === 'error';
  const isPhasePlaceholder = message.role === 'assistant' && message.status === 'streaming' && !message.content;

  if (message.role === 'user') {
    return (
      <article className="flex w-full min-w-0 justify-end">
        <div className="flex max-w-[70%] flex-col items-end gap-2 max-[600px]:max-w-[86%]">
          <div
            className={cn(
              'whitespace-pre-wrap rounded-2xl bg-muted px-3.5 py-2.5 text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]',
              isError && 'border border-red-200 bg-red-50'
            )}
          >
            {wrappedPrompt ? (
              <details className="grid gap-2">
                <summary>历史包装 Prompt，已折叠</summary>
                <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg border border-dashed border-border bg-slate-50 px-3 py-2.5 text-xs text-slate-600 [overflow-wrap:anywhere]">
                  {message.content}
                </pre>
              </details>
            ) : (
              content
            )}
            {message.attachments?.length ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {message.attachments.map((attachment) =>
                  attachment.kind === 'image' ? (
                    <a
                      className="block overflow-hidden rounded-lg border border-border bg-background"
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      key={attachment.id}
                    >
                      <img
                        className="block h-auto max-h-[220px] w-[min(220px,46vw)] object-contain"
                        src={attachment.url}
                        alt={attachment.name}
                      />
                    </a>
                  ) : null
                )}
              </div>
            ) : null}
          </div>
          {isError ? <p className="text-xs text-destructive">本轮回复失败，请查看通知详情。</p> : null}
        </div>
      </article>
    );
  }

  const showAssistantIcon = message.role === 'assistant';
  const assistantIconSrc = showAssistantIcon
    ? getAgentIconSrc(assistantAgent?.backend)
    : null;
  const assistantIconAlt = showAssistantIcon
    ? getAgentIconAlt(assistantAgent?.backend)
    : '';

  return (
    <article className="flex w-full min-w-0 items-start gap-3.5">
      {assistantIconSrc ? (
        <img
          className="size-7 shrink-0 rounded-md object-contain"
          src={assistantIconSrc}
          alt={assistantIconAlt}
          title={assistantAgent?.name ?? assistantIconAlt}
        />
      ) : (
        <div className="flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
          AI
        </div>
      )}
      <div
        className={cn(
          'min-w-0 flex-1 text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]',
          isError && 'rounded-lg border border-red-200 bg-red-50 p-3'
        )}
      >
        {wrappedPrompt ? (
          <details className="grid gap-2">
            <summary>历史包装 Prompt，已折叠</summary>
            <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg border border-dashed border-border bg-slate-50 px-3 py-2.5 text-xs text-slate-600 [overflow-wrap:anywhere]">
              {message.content}
            </pre>
          </details>
        ) : (
          <MarkdownMessage content={content} className={isPhasePlaceholder ? 'markdown-message--phase' : undefined} />
        )}
        {message.attachments?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {message.attachments.map((attachment) =>
              attachment.kind === 'image' ? (
                <a
                  className="block overflow-hidden rounded-lg border border-border bg-background"
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  key={attachment.id}
                >
                  <img
                    className="block h-auto max-h-[220px] w-[min(220px,46vw)] object-contain"
                    src={attachment.url}
                    alt={attachment.name}
                  />
                </a>
              ) : null
            )}
          </div>
        ) : null}
        {isError ? <p className="mt-2 text-xs text-destructive">本轮回复失败，请查看通知详情。</p> : null}
      </div>
    </article>
  );
}
