import type React from 'react';
import { useMemo } from 'react';
import { MessageSquareIcon, SquarePenIcon } from 'lucide-react';
import type { Team, Workspace } from '@shared/types';
import { TeamListItem } from '@renderer/features/teams/components/TeamListItem';
import { FileIcon } from '@renderer/shared/components/FileIcon';
import { Button } from '@renderer/shared/components/ui/button';
import { ScrollArea } from '@renderer/shared/components/ui/scroll-area';

/** 侧边栏团队列表的分组数据、选中态和团队操作回调。 */
export type TeamListProps = {
  teams: Team[];
  workspaces: Workspace[];
  activeTeamId: string | null;
  onCreateTeamInWorkspace: (workspaceId?: string) => void;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
};

/** 侧边栏团队列表，按工作区分组并在有限高度内滚动。 */
export function TeamList({
  teams,
  workspaces,
  activeTeamId,
  onCreateTeamInWorkspace,
  onSelectTeam,
  onDeleteTeam,
}: TeamListProps): React.ReactElement {
  const groups = useMemo(() => groupTeamsByWorkspace(teams, workspaces), [teams, workspaces]);

  if (groups.length === 0) {
    return <p className="mx-2 mb-2 mt-1 text-xs text-muted-foreground">暂无工作区或团队</p>;
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="grid gap-4 pr-1">
        {groups.map((group) => (
          <section className="grid gap-1.5" key={group.key}>
            <TeamGroupHeader
              group={group}
              onCreateTeamInWorkspace={onCreateTeamInWorkspace}
            />
            <div className="grid gap-0.5">
              {group.teams.map((team) => (
                <TeamListItem
                  key={team.id}
                  team={team}
                  active={team.id === activeTeamId}
                  onSelect={() => onSelectTeam(team.id)}
                  onDelete={() => onDeleteTeam(team.id)}
                />
              ))}
              {group.teams.length === 0 ? (
                <p className="ml-12 h-7 text-xs leading-7 text-muted-foreground">暂无 Team</p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}

/** 团队按工作区聚合后的侧边栏分组。 */
type TeamGroup = {
  key: string;
  label: string;
  kind: 'workspace' | 'temporary';
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
    teams: [],
  };

  for (const workspace of workspaces) {
    if (workspace.isTemporary) continue;
    workspaceGroups.set(workspace.id, {
      key: workspace.id,
      label: workspace.name,
      kind: 'workspace',
      createWorkspaceId: workspace.id,
      teams: [],
    });
  }

  for (const team of teams) {
    const workspace = workspaceById.get(team.workspaceId);
    if (!workspace || workspace.isTemporary) {
      temporaryGroup.teams.push(team);
      continue;
    }

    const group = workspaceGroups.get(workspace.id) ?? {
      key: workspace.id,
      label: workspace.name,
      kind: 'workspace',
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

/** 渲染工作区分组标题，并承载分组内新建 Team 操作。 */
function TeamGroupHeader({
  group,
  onCreateTeamInWorkspace,
}: {
  group: TeamGroup;
  onCreateTeamInWorkspace: (workspaceId?: string) => void;
}): React.ReactElement {
  const isWorkspace = group.kind === 'workspace';

  return (
    <div className="group/header grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-1 text-[13px] text-foreground">
      <span className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-center gap-2">
        {isWorkspace ? <FileIcon isDirectory className="size-4" /> : <MessageSquareIcon aria-hidden="true" className="size-4" />}
        <span className="truncate" title={group.label}>
          {group.label}
        </span>
      </span>
      <span className="inline-flex opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:bg-[var(--sidebar-hover)]"
          aria-label={`在 ${group.label} 中创建 Team`}
          onClick={() => onCreateTeamInWorkspace(group.createWorkspaceId)}
        >
          <SquarePenIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}
