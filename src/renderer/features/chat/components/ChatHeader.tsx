import type { ReactElement } from 'react';
import { MenuIcon } from 'lucide-react';
import type { AgentTurnPhase, ConversationMemoryState, ConversationUsage, Team, TeamAgent } from '@shared/types';
import { formatPhase } from '@renderer/shared/utils/format';
import { UsageChip } from '@renderer/features/chat/components/UsageChip';
import { Button } from '@renderer/shared/components/ui/button';

/** 聊天顶部栏展示的团队、Agent、阶段和移动端侧栏入口。 */
export type ChatHeaderProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  memory?: ConversationMemoryState | null;
  onOpenSidebar?: () => void;
};

/** 新 风格简化的顶部状态栏——移动端左侧显示 SVG 菜单图标按钮。 */
export function ChatHeader({
  team,
  activeAgent,
  activePhase,
  usage,
  memory,
  onOpenSidebar,
}: ChatHeaderProps): ReactElement {
  return (
    <header className="flex h-14 min-h-14 items-center gap-4 border-b border-border bg-background/90 px-6 backdrop-blur md:px-6 max-[600px]:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {onOpenSidebar ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full md:hidden"
            aria-label="打开侧边栏"
            title="打开侧边栏"
            onClick={onOpenSidebar}
          >
            <MenuIcon aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <div className="flex min-w-0 items-baseline gap-2">
          <strong className="truncate text-[15px] font-semibold text-foreground">
            {team?.name ?? '未选择团队'}
          </strong>
          <span className="truncate text-sm text-muted-foreground">
            {activeAgent ? activeAgent.name : '暂无 Agent'}
          </span>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <UsageChip usage={usage} />
        <MemoryStatusChip memory={memory} />
        {activePhase ? (
          <span className="inline-flex whitespace-nowrap rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {formatPhase(activePhase)}
          </span>
        ) : null}
      </div>
    </header>
  );
}

/** 展示当前会话的记忆压缩状态。 */
function MemoryStatusChip({ memory }: { memory?: ConversationMemoryState | null }): ReactElement | null {
  if (!memory || memory.status === 'idle') return null;
  const label = formatMemoryStatus(memory);
  const tone =
    memory.status === 'failed'
      ? 'border-red-200 bg-red-50 text-red-700'
      : memory.status === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-sky-200 bg-sky-50 text-sky-700';
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md border px-2.5 py-1 text-xs ${tone}`}
      title={memory.error ?? memory.reason ?? label}
    >
      {label}
    </span>
  );
}

function formatMemoryStatus(memory: ConversationMemoryState): string {
  if (memory.status === 'compressing') return '自动压缩上下文中';
  if (memory.status === 'compressed') return `已压缩 ${memory.sourceMessageCount ?? 0} 条`;
  if (memory.status === 'failed') return '压缩失败';
  if (memory.status === 'warning') return '等待压缩';
  return '上下文记忆';
}
