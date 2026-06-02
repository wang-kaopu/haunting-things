import { useEffect, useState } from 'react';
import type React from 'react';
import type { Team } from '../../../../shared/types';

export type TeamListItemProps = {
  team: Team;
  active: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
};

/** GPT 风格侧边栏团队条目——和 Members 一样的一行式列表项，删除收进 ⋯ 菜单。 */
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
        <span className="sidebar-team-icon" aria-hidden="true">#</span>
        <span className="sidebar-team-name">{team.name}</span>
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
