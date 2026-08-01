import type React from 'react';
import type { WorkspaceEntry } from '@shared/types';
import { FileIcon } from '@renderer/shared/components/FileIcon';

/** 工作区文件树的顶层条目集合。 */
export type WorkspaceTreeProps = {
  entries: WorkspaceEntry[];
};

/** 递归展示工作区文件树。 */
export function WorkspaceTree({ entries }: WorkspaceTreeProps): React.ReactElement {
  if (entries.length === 0) return <p className="py-2 text-xs text-muted-foreground">暂无文件</p>;
  return <ul className="m-0 list-none p-0">{entries.map((entry) => <WorkspaceTreeItem key={entry.relativePath} entry={entry} />)}</ul>;
}

/** 展示单个文件树节点。 */
function WorkspaceTreeItem({ entry }: { entry: WorkspaceEntry }): React.ReactElement {
  return (
    <li>
      <div
        className="flex h-6 min-w-0 items-center gap-1.5 rounded px-1 hover:bg-accent"
        title={entry.relativePath}
      >
        <FileIcon isDirectory={entry.isDir} />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
      </div>
      {entry.children?.length ? (
        <div className="pl-3.5">
          <WorkspaceTree entries={entry.children} />
        </div>
      ) : null}
    </li>
  );
}
