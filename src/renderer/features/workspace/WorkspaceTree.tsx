import type React from 'react';
import type { WorkspaceEntry } from '@shared/types';

/** 工作区文件树的顶层条目集合。 */
export type WorkspaceTreeProps = {
  entries: WorkspaceEntry[];
};

/** 递归展示工作区文件树。 */
export function WorkspaceTree({ entries }: WorkspaceTreeProps): React.ReactElement {
  if (entries.length === 0) return <p className="workspace-panel__empty">暂无文件</p>;
  return <ul className="workspace-tree">{entries.map((entry) => <WorkspaceTreeItem key={entry.relativePath} entry={entry} />)}</ul>;
}

/** 展示单个文件树节点。 */
function WorkspaceTreeItem({ entry }: { entry: WorkspaceEntry }): React.ReactElement {
  return (
    <li className="workspace-tree__item">
      <div className="workspace-tree__row" title={entry.relativePath}>
        <span className="workspace-tree__icon" aria-hidden="true">
          {entry.isDir ? '▸' : '·'}
        </span>
        <span className="workspace-tree__name">{entry.name}</span>
      </div>
      {entry.children?.length ? <WorkspaceTree entries={entry.children} /> : null}
    </li>
  );
}
