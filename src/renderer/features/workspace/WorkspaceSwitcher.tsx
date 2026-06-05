import type React from 'react';
import type { Workspace } from '@shared/types';

export type WorkspaceSwitcherProps = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onOpenDirectoryPicker: () => void;
  onCreateTemporaryWorkspace: () => Promise<void>;
};

/** 切换当前会话列表使用的工作区过滤条件。 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpenDirectoryPicker,
  onCreateTemporaryWorkspace,
}: WorkspaceSwitcherProps): React.ReactElement {
  return (
    <section className="workspace-switcher">
      <div className="sidebar-section-header">
        <span>Workspaces</span>
        <button type="button" className="sidebar-section-action" onClick={onOpenDirectoryPicker}>
          选择
        </button>
      </div>
      <select
        value={activeWorkspaceId ?? ''}
        onChange={(event) => onSelectWorkspace(event.target.value || null)}
      >
        <option value="">全部工作区</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.isTemporary ? '对话' : workspace.name}
          </option>
        ))}
      </select>
      <button type="button" className="workspace-switcher__temporary" onClick={() => void onCreateTemporaryWorkspace()}>
        创建对话
      </button>
    </section>
  );
}
