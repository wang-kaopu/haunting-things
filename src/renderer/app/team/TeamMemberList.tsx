import type React from 'react';
import type { AgentTurnPhase, ConversationCommands, ConversationMode, TeamAgent } from '../../../shared/types';
import { TeamMemberCard } from './TeamMemberCard';

export type TeamMemberListProps = {
  agents: TeamAgent[];
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  commandsByConversation?: Record<string, ConversationCommands>;
  modeByConversation?: Record<string, ConversationMode>;
  onSelectAgent: (slotId: string) => void;
};

export function TeamMemberList({
  agents,
  activeSlotId,
  phases = {},
  commandsByConversation = {},
  modeByConversation = {},
  onSelectAgent,
}: TeamMemberListProps): React.ReactElement {
  if (agents.length === 0) {
    return <p className="muted">暂无团队成员。</p>;
  }

  return (
    <div className="member-list">
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
  );
}
