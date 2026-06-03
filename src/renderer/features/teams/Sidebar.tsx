import type React from 'react';
import type { AgentTurnPhase, Team } from '@shared/types';
import { SidebarAgentList } from '@renderer/features/teams/components/SidebarAgentList';
import { TeamList } from '@renderer/features/teams/components/TeamList';

/** 左侧导航栏输入——成员状态、团队列表和全局入口。 */
export type SidebarProps = {
  username?: string;
  teams: Team[];
  activeTeam: Team | null;
  activeTeamId: string | null;
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  onCreateTeamClick: () => void;
  onAddAgentClick: () => void;
  onSelectTeam: (teamId: string) => void;
  onSelectAgent: (slotId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onSettingsClick: () => void;
  onLogout: () => void;
};

/**
 * 左侧导航栏。
 *
 * 从上到下：品牌 → 成员状态 → 团队列表 → 设置/退出。
 * 成员状态置顶，打开页面第一眼就能看到"谁空闲、谁忙碌"。
 */
export function Sidebar({
  username,
  teams,
  activeTeam,
  activeTeamId,
  activeSlotId,
  phases,
  onCreateTeamClick,
  onAddAgentClick,
  onSelectTeam,
  onSelectAgent,
  onDeleteTeam,
  onSettingsClick,
  onLogout,
}: SidebarProps): React.ReactElement {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <strong>Haunting Things</strong>
      </div>

      <section className="sidebar-section sidebar-members-section">
        <div className="sidebar-section-header">
          <span>Members</span>
          <button
            type="button"
            className="sidebar-section-action"
            disabled={!activeTeam}
            onClick={onAddAgentClick}
          >
            添加
          </button>
        </div>

        <SidebarAgentList
          agents={activeTeam?.agents ?? []}
          activeSlotId={activeSlotId}
          phases={phases}
          onSelectAgent={onSelectAgent}
        />
      </section>

      <section className="sidebar-section sidebar-teams-section">
        <div className="sidebar-section-header">
          <span>Teams</span>
          <button
            type="button"
            className="sidebar-section-action"
            onClick={onCreateTeamClick}
          >
            创建
          </button>
        </div>

        <TeamList
          teams={teams}
          activeTeamId={activeTeamId}
          onSelectTeam={onSelectTeam}
          onDeleteTeam={onDeleteTeam}
        />
      </section>

      <div className="sidebar__footer">
        <button type="button" className="sidebar__footer-item" onClick={onSettingsClick}>
          设置
        </button>
        <button type="button" className="sidebar__footer-item" onClick={onLogout}>
          退出登录
        </button>
      </div>
    </aside>
  );
}
