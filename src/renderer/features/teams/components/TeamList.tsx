import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Team, Workspace } from '@shared/types';
import { TeamListItem } from '@renderer/features/teams/components/TeamListItem';

export type TeamListProps = {
  teams: Team[];
  workspaces: Workspace[];
  activeTeamId: string | null;
  onCreateTeamInWorkspace: (workspaceId?: string) => void;
  onDeleteWorkspaces: (workspaceIds: string[], label: string) => Promise<void>;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
};

/** 侧边栏团队列表，空状态统一使用 sidebar-empty。 */
export function TeamList({
  teams,
  workspaces,
  activeTeamId,
  onCreateTeamInWorkspace,
  onDeleteWorkspaces,
  onSelectTeam,
  onDeleteTeam,
}: TeamListProps): React.ReactElement {
  const groups = useMemo(() => groupTeamsByWorkspace(teams, workspaces), [teams, workspaces]);

  if (groups.length === 0) {
    return <p className="sidebar-empty">暂无工作区或团队</p>;
  }

  return (
    <div className="sidebar-team-list">
      {groups.map((group) => (
        <section className={`sidebar-team-group ${group.kind}`} key={group.key}>
          <TeamGroupHeader
            group={group}
            onCreateTeamInWorkspace={onCreateTeamInWorkspace}
            onDeleteWorkspaces={onDeleteWorkspaces}
          />
          <div className="sidebar-team-group__items">
            {group.teams.map((team) => (
              <TeamListItem
                key={team.id}
                team={team}
                active={team.id === activeTeamId}
                onSelect={() => onSelectTeam(team.id)}
                onDelete={() => onDeleteTeam(team.id)}
              />
            ))}
            {group.teams.length === 0 ? <p className="sidebar-team-group__empty">暂无 Team</p> : null}
          </div>
        </section>
      ))}
    </div>
  );
}

type TeamGroup = {
  key: string;
  label: string;
  kind: 'workspace' | 'temporary';
  workspaceIds: string[];
  createWorkspaceId?: string;
  teams: Team[];
};

/** 将团队按工作区分组，未绑定持久工作区的团队统一归入对话分组。 */
function groupTeamsByWorkspace(teams: Team[], workspaces: Workspace[]): TeamGroup[] {
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const workspaceGroups = new Map<string, TeamGroup>();
  const temporaryGroup: TeamGroup = {
    key: 'temporary-conversations',
    label: '对话',
    kind: 'temporary',
    workspaceIds: [],
    teams: [],
  };

  for (const workspace of workspaces) {
    if (workspace.isTemporary) continue;
    workspaceGroups.set(workspace.id, {
      key: workspace.id,
      label: workspace.name,
      kind: 'workspace',
      workspaceIds: [workspace.id],
      createWorkspaceId: workspace.id,
      teams: [],
    });
  }

  for (const team of teams) {
    const workspace = workspaceById.get(team.workspaceId);
    if (!workspace || workspace.isTemporary) {
      if (workspace?.id && !temporaryGroup.workspaceIds.includes(workspace.id)) {
        temporaryGroup.workspaceIds.push(workspace.id);
      }
      temporaryGroup.teams.push(team);
      continue;
    }

    const group = workspaceGroups.get(workspace.id) ?? {
      key: workspace.id,
      label: workspace.name,
      kind: 'workspace',
      workspaceIds: [workspace.id],
      createWorkspaceId: workspace.id,
      teams: [],
    };
    group.teams.push(team);
    workspaceGroups.set(workspace.id, group);
  }

  return [
    ...Array.from(workspaceGroups.values()),
    ...(temporaryGroup.teams.length > 0 ? [temporaryGroup] : []),
  ];
}

/** 渲染工作区分组标题，并承载分组级更多菜单和新建 Team 操作。 */
function TeamGroupHeader({
  group,
  onCreateTeamInWorkspace,
  onDeleteWorkspaces,
}: {
  group: TeamGroup;
  onCreateTeamInWorkspace: (workspaceId?: string) => void;
  onDeleteWorkspaces: (workspaceIds: string[], label: string) => Promise<void>;
}): React.ReactElement {
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteLabel = group.kind === 'temporary' ? '删除对话' : '删除工作区';

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  function toggleMenu(): void {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPosition({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setMenuOpen((current) => !current);
  }

  return (
    <div className="sidebar-team-group__header">
      <span className="sidebar-team-group__identity">
        {group.kind === 'workspace' ? <FolderIcon /> : null}
        <span className="sidebar-team-group__label" title={group.label}>
          {group.label}
        </span>
      </span>
      <span className="sidebar-team-group__actions">
        <span className="sidebar-team-group__menu-wrap" ref={menuRef}>
          <button
            ref={menuButtonRef}
            type="button"
            className="sidebar-group-icon-button"
            aria-label={`更多操作：${group.label}`}
            onClick={toggleMenu}
          >
            <MoreIcon />
          </button>
          {menuOpen ? (
            <div
              className="custom-select-popover sidebar-team-group__menu"
              role="menu"
              style={menuPosition ? { top: menuPosition.top, right: menuPosition.right } : undefined}
            >
              <button
                type="button"
                className="custom-select-option"
                role="menuitem"
                disabled={deleting || group.workspaceIds.length === 0}
                onClick={() => {
                  setDeleting(true);
                  void onDeleteWorkspaces(group.workspaceIds, group.label).finally(() => {
                    setDeleting(false);
                    setMenuOpen(false);
                  });
                }}
              >
                <span className="custom-select-option-label">
                  {deleting ? '删除中...' : deleteLabel}
                </span>
              </button>
            </div>
          ) : null}
        </span>
        <button
          type="button"
          className="sidebar-group-icon-button"
          aria-label={`在 ${group.label} 中创建 Team`}
          onClick={() => onCreateTeamInWorkspace(group.createWorkspaceId)}
        >
          <ComposeIcon />
        </button>
      </span>
    </div>
  );
}

/** 工作区文件夹图标。 */
function FolderIcon(): React.ReactElement {
  return (
    <svg className="sidebar-team-group__folder-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.25A2.25 2.25 0 0 1 5.75 5h4.1l1.8 2.25h6.6A2.25 2.25 0 0 1 20.5 9.5v6.75a2.25 2.25 0 0 1-2.25 2.25H5.75a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
      <path d="M3.5 9h17" />
    </svg>
  );
}

/** 更多操作图标。 */
function MoreIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="15" cy="10" r="1.4" />
    </svg>
  );
}

/** 新建 Team/Conversation 图标。 */
function ComposeIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5H6.75A2.75 2.75 0 0 0 4 7.75v9.5A2.75 2.75 0 0 0 6.75 20h9.5A2.75 2.75 0 0 0 19 17.25V13" />
      <path d="m9.75 14.25.45-2.7 6.95-6.95a1.75 1.75 0 0 1 2.48 2.48l-6.95 6.95-2.93.22Z" />
      <path d="m15.8 5.95 2.25 2.25" />
    </svg>
  );
}
