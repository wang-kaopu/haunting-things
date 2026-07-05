import { useState, type ReactElement } from 'react';
import { ArchiveIcon, Loader2Icon, MenuIcon } from 'lucide-react';
import type { AgentTurnPhase, ConversationMemoryState, ConversationUsage, Team, TeamAgent } from '@shared/types';
import { formatPhase } from '@renderer/shared/utils/format';
import { UsageChip } from '@renderer/features/chat/components/UsageChip';
import { Button } from '@renderer/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/shared/components/ui/dialog';

/** 聊天顶部栏展示的团队、Agent、阶段和移动端侧栏入口。 */
export type ChatHeaderProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  memory?: ConversationMemoryState | null;
  onOpenSidebar?: () => void;
  onCompressMemory?: () => Promise<void>;
};

/** 新 风格简化的顶部状态栏——移动端左侧显示 SVG 菜单图标按钮。 */
export function ChatHeader({
  team,
  activeAgent,
  activePhase,
  usage,
  memory,
  onOpenSidebar,
  onCompressMemory,
}: ChatHeaderProps): ReactElement {
  const compressing = memory?.status === 'compressing';
  const [confirmCompressOpen, setConfirmCompressOpen] = useState(false);
  const [confirmingCompress, setConfirmingCompress] = useState(false);

  async function confirmCompressMemory(): Promise<void> {
    if (!onCompressMemory || confirmingCompress) return;
    setConfirmingCompress(true);
    try {
      await onCompressMemory();
      setConfirmCompressOpen(false);
    } finally {
      setConfirmingCompress(false);
    }
  }

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
            <MenuIcon aria-hidden="true" className="size-[18px]" />
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
        {activeAgent?.conversationId && onCompressMemory ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label="压缩上下文"
            title="压缩上下文"
            disabled={compressing}
            onClick={() => setConfirmCompressOpen(true)}
          >
            {compressing ? (
              <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ArchiveIcon aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null}
        {activePhase ? (
          <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {formatPhase(activePhase)}
          </span>
        ) : null}
      </div>
      <Dialog
        open={confirmCompressOpen}
        onOpenChange={(open) => {
          if (!confirmingCompress) setConfirmCompressOpen(open);
        }}
      >
        <DialogContent className="w-[min(420px,calc(100vw-32px))] rounded-xl">
          <DialogHeader>
            <DialogTitle>是否确认压缩上下文？</DialogTitle>
            <DialogDescription>
              压缩会把较早历史整理为摘要，并在下一轮发送时使用新的上下文记忆。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={confirmingCompress}
              onClick={() => setConfirmCompressOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={confirmingCompress}
              onClick={() => void confirmCompressMemory()}
            >
              {confirmingCompress ? (
                <>
                  <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
                  压缩中
                </>
              ) : (
                '确认压缩'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs ${tone}`}
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
