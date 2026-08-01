import type React from 'react';
import type { Team } from '@shared/types';
import { useWorkspaceTree } from '@renderer/features/workspace/hooks/useWorkspaceTree';
import { WorkspaceTree } from '@renderer/features/workspace/WorkspaceTree';
import { Button } from '@renderer/shared/components/ui/button';

/** 工作区侧栏面板需要的当前团队上下文。 */
export type WorkspacePanelProps = {
  team: Team;
};

/** 展示当前 Team 绑定工作区的文件树。 */
export function WorkspacePanel({ team }: WorkspacePanelProps): React.ReactElement {
  const tree = useWorkspaceTree(team.workspaceId);

  return (
    <aside className="min-h-0 min-w-0 overflow-auto border-l border-border bg-[var(--panel-muted)] p-3 text-[13px] text-foreground max-md:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="font-semibold">Workspace</strong>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => void tree.refresh()}
          disabled={tree.loading}
        >
          刷新
        </Button>
      </div>
      <div className="mb-2.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        <span>{team.workspaceId}</span>
      </div>
      {tree.error ? <p className="py-2 text-xs text-destructive">{tree.error}</p> : null}
      {tree.loading ? <p className="py-2 text-xs text-muted-foreground">加载中...</p> : <WorkspaceTree entries={tree.entries} />}
    </aside>
  );
}
