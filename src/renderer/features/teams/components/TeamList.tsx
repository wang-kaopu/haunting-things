import type React from 'react';
import type { Team } from '../../../../shared/types';
import { TeamListItem } from './TeamListItem';

export type TeamListProps = {
  teams: Team[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
};

/** 侧边栏团队列表，空状态保持在本地。 */
export function TeamList({ teams, activeTeamId, onSelectTeam, onDeleteTeam }: TeamListProps): React.ReactElement {
  if (teams.length === 0) {
    return <p className="sidebar-empty">暂无团队。</p>;
  }

  return (
    <div className="sidebar__list">
      {teams.map((team) => (
        <TeamListItem
          key={team.id}
          team={team}
          active={team.id === activeTeamId}
          onSelect={() => onSelectTeam(team.id)}
          onDelete={() => onDeleteTeam(team.id)}
        />
      ))}
    </div>
  );
}
