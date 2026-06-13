import type React from 'react';
import type { ConversationSummary } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import { ScrollArea } from '@renderer/shared/components/ui/scroll-area';

/** 工作区内会话摘要列表的数据输入。 */
export type ConversationSummaryListProps = {
  conversations: ConversationSummary[];
};

/** 展示按工作区过滤后的会话摘要列表。 */
export function ConversationSummaryList({ conversations }: ConversationSummaryListProps): React.ReactElement {
  if (conversations.length === 0) {
    return <p className="mx-2 mb-2 mt-1 text-xs text-muted-foreground">暂无会话</p>;
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="grid gap-1 pr-1">
        {conversations.map((conversation) => (
          <Button
            type="button"
            variant="ghost"
            className="grid h-auto min-h-[64px] w-full gap-1 rounded-lg px-2 py-2 text-left font-normal"
            key={conversation.id}
          >
            <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{conversation.name}</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">{conversation.preview || '暂无消息'}</span>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {conversation.workspace.name} · {conversation.model ?? conversation.backend}
            </span>
          </Button>
        ))}
      </div>
    </ScrollArea>
  );
}
