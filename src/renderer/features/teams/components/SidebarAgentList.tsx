import type React from 'react';
import type { AgentTurnPhase, TeamAgent } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import { ScrollArea } from '@renderer/shared/components/ui/scroll-area';
import { cn } from '@renderer/shared/lib/utils';
import { getAgentIconAlt, getAgentIconSrc } from '@renderer/shared/utils/agentIcon';

/** 侧边栏成员列表的 Agent 集合、选中项和运行阶段快照。 */
export type SidebarAgentListProps = {
  agents: TeamAgent[];
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  onSelectAgent: (slotId: string) => void;
};

/**
 * 侧边栏紧凑成员状态列表。
 *
 * 每行仅显示红绿灯 + 后端图标 + 成员名字，
 * 不展示 backend、model、命令数、phase 文本等冗余信息。
 */
export function SidebarAgentList({
  agents,
  activeSlotId,
  phases = {},
  onSelectAgent,
}: SidebarAgentListProps): React.ReactElement {
  if (agents.length === 0) {
    return <p className="mx-2 mb-2 mt-1 text-xs text-muted-foreground">暂无成员</p>;
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="grid gap-0.5 pr-1">
        {agents.map((agent) => {
          const phase = phases[agent.conversationId];
          const busy =
            agent.status === 'active' || Boolean(phase && phase !== 'done');
          const selected = agent.slotId === activeSlotId;

          return (
            <Button
              key={agent.slotId}
              type="button"
              variant="ghost"
              className={cn(
                'grid h-8 w-full grid-cols-[8px_20px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-left text-sm font-normal',
                selected && 'bg-[var(--sidebar-active)] hover:bg-[var(--sidebar-active)]'
              )}
              title={agent.name}
              onClick={() => onSelectAgent(agent.slotId)}
            >
              <span
                className={cn('size-[7px] rounded-full', busy ? 'bg-red-500' : 'bg-green-500')}
                aria-label={busy ? '忙碌中' : '空闲'}
              />
              <img
                className="size-[18px] shrink-0 rounded object-contain"
                src={getAgentIconSrc(agent.backend)}
                alt={getAgentIconAlt(agent.backend)}
              />
              <span className="min-w-0 truncate text-[13px]">{agent.name}</span>
            </Button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
