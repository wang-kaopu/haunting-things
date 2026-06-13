import type React from 'react';
import type { AgentTurnPhase, ConversationCommands, ConversationMode, TeamAgent } from '@shared/types';
import { TeamMemberCard } from '@renderer/features/teams/components/TeamMemberCard';
import { ScrollArea } from '@renderer/shared/components/ui/scroll-area';

/** 团队成员列表的 Agent 集合、选中项和按会话索引的运行时快照。 */
export type TeamMemberListProps = {
  agents: TeamAgent[];
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  commandsByConversation?: Record<string, ConversationCommands>;
  modeByConversation?: Record<string, ConversationMode>;
  onSelectAgent: (slotId: string) => void;
};

/** 渲染团队成员列表，并按 conversationId 注入运行时阶段、命令和模式快照。 */
export function TeamMemberList({
  agents,
  activeSlotId,
  phases = {},
  commandsByConversation = {},
  modeByConversation = {},
  onSelectAgent,
}: TeamMemberListProps): React.ReactElement {
  if (agents.length === 0) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">暂无团队成员。</p>;
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="grid gap-1 pr-1">
        {agents.map((agent) => (
          <TeamMemberCard
            key={agent.slotId}
            agent={agent}
            active={agent.slotId === activeSlotId}
            phase={phases[agent.conversationId]}
            commands={commandsByConversation[agent.conversationId]}
            mode={modeByConversation[agent.conversationId]}
            onSelect={() => onSelectAgent(agent.slotId)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
