import { useEffect, useState } from 'react';
import type React from 'react';
import type { Team } from '../../../../shared/types';

export type TeamListItemProps = {
  team: Team;
  active: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
};

/** 渲染侧边栏团队条目，并把删除操作收进二级菜单避免误触。 */
export function TeamListItem({ team, active, onSelect, onDelete }: TeamListItemProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!active) setMenuOpen(false);
  }, [active]);

  return (
    <div className={`team-row${active ? ' active' : ''}`}>
      <button type="button" className={`team-main${active ? ' selected' : ''}`} onClick={onSelect}>
        <span>{team.name}</span>
      </button>
      <div className="team-menu-wrap">
        <button
          type="button"
          className="icon-button"
          aria-label={`更多操作：${team.name}`}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="menu-popover">
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
