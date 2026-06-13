import type React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { AgentTurnPhase, ConversationCommands, ConversationMode, Team } from '@shared/types';
import { TeamMemberList } from '@renderer/features/teams/components/TeamMemberList';
import { Button } from '@renderer/shared/components/ui/button';
import { cn } from '@renderer/shared/lib/utils';

/** 右侧 Team 成员抽屉输入。 */
export type TeamDrawerProps = {
  open: boolean;
  team: Team | null;
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  commandsByConversation?: Record<string, ConversationCommands>;
  modeByConversation?: Record<string, ConversationMode>;
  onToggle: () => void;
  onSelectAgent: (slotId: string) => void;
};

/**
 * 右侧 Team 成员抽屉。
 *
 * 用于快速切换当前 Agent，并展示成员运行阶段、命令和模式快照。
 */
export function TeamDrawer({
  open,
  team,
  activeSlotId,
  phases,
  commandsByConversation,
  modeByConversation,
  onToggle,
  onSelectAgent,
}: TeamDrawerProps): React.ReactElement {
  return (
    <>
      <aside
        className={cn(
          'fixed bottom-0 right-0 top-0 z-30 hidden w-[300px] grid-rows-[auto_minmax(0,1fr)] border-l border-border bg-background shadow-[-8px_0_28px_rgba(0,0,0,0.08)] transition-transform duration-200 md:grid',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="border-b border-border px-4 py-4">
          <h2 className="text-sm font-semibold text-foreground">团队</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {team?.name ?? '未选择团队'}
          </p>
        </header>
        <div className="min-h-0 p-3">
          <TeamMemberList
            agents={team?.agents ?? []}
            activeSlotId={activeSlotId}
            phases={phases}
            commandsByConversation={commandsByConversation}
            modeByConversation={modeByConversation}
            onSelectAgent={onSelectAgent}
          />
        </div>
      </aside>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'fixed top-4 z-40 hidden h-8 w-8 rounded-l-lg rounded-r-none bg-background shadow-[-3px_0_14px_rgba(0,0,0,0.08)] transition-[right] duration-200 md:inline-flex',
          open ? 'right-[300px]' : 'right-0'
        )}
        onClick={onToggle}
        aria-label={open ? '收起团队抽屉' : '展开团队抽屉'}
      >
        {open ? (
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        ) : (
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
        )}
      </Button>
    </>
  );
}
