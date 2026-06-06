import type React from 'react';
import type { Team } from '@shared/types';
import { useWorkspaceTree } from '@renderer/features/workspace/hooks/useWorkspaceTree';
import { WorkspaceTree } from '@renderer/features/workspace/WorkspaceTree';

/** 工作区侧栏面板需要的当前团队上下文。 */
export type WorkspacePanelProps = {
  team: Team;
};

/** 展示当前 Team 绑定工作区的文件树。 */
export function WorkspacePanel({ team }: WorkspacePanelProps): React.ReactElement {
  const tree = useWorkspaceTree(team.workspaceId);

  return (
    <aside className="workspace-panel">
      <div className="workspace-panel__header">
        <strong>Workspace</strong>
        <button type="button" onClick={() => void tree.refresh()} disabled={tree.loading}>
          刷新
        </button>
      </div>
      <div className="workspace-panel__meta">
        <span>{team.workspaceId}</span>
      </div>
      {tree.error ? <p className="workspace-panel__error">{tree.error}</p> : null}
      {tree.loading ? <p className="workspace-panel__empty">加载中...</p> : <WorkspaceTree entries={tree.entries} />}
    </aside>
  );
}
