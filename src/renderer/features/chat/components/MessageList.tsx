import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { AgentTurnPhase, ChatMessage } from '../../../../shared/types';
import { MessageBubble } from './MessageBubble';

export type MessageListProps = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
};

/** 渲染聊天消息流，并在用户离开底部时保留阅读位置和新消息提示。 */
export function MessageList({ messages, activePhase }: MessageListProps): React.ReactElement {
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
      jumpToBottom(element);
      setPinnedToBottom(true);
      setNewMessageCount(0);
      return;
    }

    if (delta > 0) {
      setNewMessageCount((count) => count + delta);
    }
  }, [messages.length, lastMessage?.content, lastMessage?.status, pinnedToBottom]);

  return (
    <div className="messages-wrap">
      <div
        ref={listRef}
        className="messages"
        onScroll={(event) => {
          const nearBottom = isNearBottom(event.currentTarget);
          setPinnedToBottom(nearBottom);
          if (nearBottom) setNewMessageCount(0);
        }}
      >
        {messages.length === 0 ? <p className="empty-inline">暂无消息。</p> : null}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} activePhase={activePhase} />
        ))}
      </div>
      {!pinnedToBottom && newMessageCount > 0 ? (
        <button
          type="button"
          className="jump-bottom"
          onClick={() => {
            const element = listRef.current;
            if (!element) return;
            jumpToBottom(element);
            setPinnedToBottom(true);
            setNewMessageCount(0);
          }}
        >
          有 {newMessageCount} 条新消息，回到底部
        </button>
      ) : null}
    </div>
  );
}

/** 判断滚动区域是否接近底部，避免流式更新打断用户阅读历史消息。 */
function isNearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

/** 平滑回到底部，匹配聊天流持续追加内容的阅读习惯。 */
function jumpToBottom(element: HTMLDivElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
}
