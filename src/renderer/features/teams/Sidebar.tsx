import type React from 'react';
import type { Team } from '../../../shared/types';
import { TeamList } from './components/TeamList';

/** 左侧 Team 导航栏输入。 */
export type SidebarProps = {
  username?: string;
  teams: Team[];
  activeTeamId: string | null;
  onCreateTeamClick: () => void;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onSettingsClick: () => void;
  onLogout: () => void;
};

/**
 * 应用左侧导航栏。
 *
 * 展示当前用户、Team 列表和全局入口，Team 的具体成员状态交给右侧抽屉展示。
 */
export function Sidebar({
  username,
  teams,
  activeTeamId,
  onCreateTeamClick,
  onSelectTeam,
  onDeleteTeam,
  onSettingsClick,
  onLogout,
}: SidebarProps): React.ReactElement {
  return (
    <aside className="sidebar">
      <div className="brand">
        <strong>Haunting Things</strong>
        <span>{username ?? 'admin'}</span>
      </div>
      <button type="button" onClick={onCreateTeamClick}>
        创建团队
      </button>
      <TeamList
        teams={teams}
        activeTeamId={activeTeamId}
        onSelectTeam={onSelectTeam}
        onDeleteTeam={onDeleteTeam}
      />
      <button type="button" onClick={onSettingsClick}>
        设置
      </button>
      <button type="button" className="secondary" onClick={onLogout}>
        退出登录
      </button>
    </aside>
  );
}
