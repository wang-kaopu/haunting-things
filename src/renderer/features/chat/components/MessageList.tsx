import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { AgentTurnPhase, ChatMessage, TeamAgent } from '@shared/types';
import { MessageBubble } from '@renderer/features/chat/components/MessageBubble';
import { Button } from '@renderer/shared/components/ui/button';

/** 聊天消息列表的消息、当前阶段和 Agent 归属上下文。 */
export type MessageListProps = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  agents?: TeamAgent[];
  activeAgent?: TeamAgent | null;
};

/** 新 风格居中消息流，移动端使用 auto 滚动 + ResizeObserver 避免流式输出被打断。 */
export function MessageList({ messages, activePhase, agents = [], activeAgent }: MessageListProps): React.ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastLengthRef = useRef(messages.length);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;

    const nearBottom = isNearBottom(element);
    const delta = messages.length - lastLengthRef.current;
    lastLengthRef.current = messages.length;

    if (pinnedToBottom || nearBottom) {
      requestAnimationFrame(() => {
        jumpToBottom(element, 'auto');
      });
      setPinnedToBottom(true);
      setNewMessageCount(0);
      return;
    }

    if (delta > 0) {
      setNewMessageCount((count) => count + delta);
    }
  }, [messages.length, lastMessage?.content, lastMessage?.status, pinnedToBottom]);

  /** 内容高度变化（图片加载、Markdown 渲染、字体重排）时保持滚底。 */
  useEffect(() => {
    const element = listRef.current;
    if (!element || !pinnedToBottom) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        jumpToBottom(element, 'auto');
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [pinnedToBottom]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-smooth px-6 pb-8 pt-6 max-[900px]:h-full max-[900px]:px-3 max-[900px]:pb-[140px] max-[900px]:pt-4"
        onScroll={(event) => {
          const nearBottom = isNearBottom(event.currentTarget);
          setPinnedToBottom(nearBottom);
          if (nearBottom) setNewMessageCount(0);
        }}
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无消息。</p>
          ) : null}
          {messages.map((message) => {
            const assistantAgent =
              message.role === 'assistant'
                ? (agents.find(
                  (agent) => agent.conversationId === message.conversationId,
                ) ??
                  activeAgent ??
                  null)
                : null;

            return (
              <MessageBubble
                key={message.id}
                message={message}
                activePhase={activePhase}
                assistantAgent={assistantAgent}
              />
            );
          })}
        </div>
      </div>
      {!pinnedToBottom && newMessageCount > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="absolute bottom-3.5 left-1/2 z-10 h-9 -translate-x-1/2 rounded-full px-4 text-xs shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
          onClick={() => {
            const element = listRef.current;
            if (!element) return;
            jumpToBottom(element, 'smooth');
            setPinnedToBottom(true);
            setNewMessageCount(0);
          }}
        >
          有 {newMessageCount} 条新消息，回到底部
        </Button>
      ) : null}
    </div>
  );
}

/** 判断滚动区域是否接近底部，避免流式更新打断用户阅读历史消息。 */
function isNearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

/** 回到底部，auto 用于流式跟随时不被打断，smooth 用于手动点击。 */
function jumpToBottom(element: HTMLDivElement, behavior: ScrollBehavior = 'auto'): void {
  element.scrollTo({ top: element.scrollHeight, behavior });
}
