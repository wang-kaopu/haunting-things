import type React from 'react';
import type { Team } from '../../../../shared/types';
import { TeamListItem } from './TeamListItem';

export type TeamListProps = {
  teams: Team[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
};

/** 渲染团队列表，并把空状态保持在侧边栏本地而不是上层页面。 */
export function TeamList({ teams, activeTeamId, onSelectTeam, onDeleteTeam }: TeamListProps): React.ReactElement {
  if (teams.length === 0) {
    return <p className="muted">暂无团队。</p>;
  }

  return (
    <div className="list">
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
