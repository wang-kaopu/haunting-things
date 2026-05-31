import type React from 'react';
import type { AgentTurnPhase, ConversationCommands, ConversationMode, Team } from '../../../shared/types';
import { TeamMemberList } from '../team/TeamMemberList';

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
    <aside className={open ? 'team-drawer open' : 'team-drawer collapsed'}>
      <button type="button" className="drawer-toggle" onClick={onToggle} aria-label="切换团队抽屉">
        {open ? '›' : '‹'}
      </button>
      {open ? (
        <div className="drawer-content">
          <h2>团队</h2>
          <TeamMemberList
            agents={team?.agents ?? []}
            activeSlotId={activeSlotId}
            phases={phases}
            commandsByConversation={commandsByConversation}
            modeByConversation={modeByConversation}
            onSelectAgent={onSelectAgent}
          />
        </div>
      ) : null}
    </aside>
  );
}
