import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { AgentTurnPhase, ChatMessage } from '../../../../shared/types';
import { MessageBubble } from './MessageBubble';

export type MessageListProps = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
};

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

function isNearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function jumpToBottom(element: HTMLDivElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
}
