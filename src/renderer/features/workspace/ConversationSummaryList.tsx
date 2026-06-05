import type React from 'react';
import type { ConversationSummary } from '@shared/types';

export type ConversationSummaryListProps = {
  conversations: ConversationSummary[];
};

/** 展示按工作区过滤后的会话摘要列表。 */
export function ConversationSummaryList({ conversations }: ConversationSummaryListProps): React.ReactElement {
  if (conversations.length === 0) {
    return <p className="sidebar-empty">暂无会话</p>;
  }

  return (
    <div className="conversation-summary-list">
      {conversations.map((conversation) => (
        <button type="button" className="conversation-summary-item" key={conversation.id}>
          <span className="conversation-summary-title">{conversation.name}</span>
          <span className="conversation-summary-preview">{conversation.preview || '暂无消息'}</span>
          <span className="conversation-summary-meta">
            {conversation.workspace.name} · {conversation.model ?? conversation.backend}
          </span>
        </button>
      ))}
    </div>
  );
}
