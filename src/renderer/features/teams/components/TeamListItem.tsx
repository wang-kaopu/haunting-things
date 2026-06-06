import type React from 'react';
import { useEffect, useState } from 'react';
import type { Team } from '@shared/types';

/** 单个团队条目的团队数据、选中态和操作回调。 */
export type TeamListItemProps = {
  team: Team;
  active: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
};

/** 新 风格侧边栏团队条目——和 Members 一样的一行式列表项，删除收进 ⋯ 菜单。 */
export function TeamListItem({ team, active, onSelect, onDelete }: TeamListItemProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!active) setMenuOpen(false);
  }, [active]);

  return (
    <div className={`sidebar-team-item${active ? ' selected' : ''}`}>
      <button
        type="button"
        className="sidebar-team-main"
        title={team.name}
        onClick={onSelect}
      >
        <span className="sidebar-team-name">{team.name}</span>
        <span className="sidebar-team-time">{formatRelativeTime(team.updatedAt)}</span>
      </button>

      <div className="sidebar-team-menu-wrap">
        <button
          type="button"
          className="sidebar-team-menu-button"
          aria-label={`更多操作：${team.name}`}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋯
        </button>

        {menuOpen ? (
          <div className="menu-popover sidebar-team-menu">
            <button
              type="button"
              className="danger"
              disabled={deleting}
              onClick={(event) => {
                event.stopPropagation();
                setDeleting(true);
                void onDelete().finally(() => {
                  setDeleting(false);
                  setMenuOpen(false);
                });
              }}
            >
              {deleting ? '删除中...' : '删除团队'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 将更新时间格式化为侧栏紧凑相对时间。 */
function formatRelativeTime(updatedAt: number): string {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} 分钟`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时`;
  return `${Math.floor(diffMs / day)} 天`;
}
