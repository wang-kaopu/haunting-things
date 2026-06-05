import type React from 'react';
import type { Workspace } from '@shared/types';
import { useWorkspacePicker } from '@renderer/features/workspace/hooks/useWorkspacePicker';

export type WorkspacePickerDialogProps = {
  open: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSelect: (workspace: Workspace) => void;
};

/** 从启动项目目录中选择一个子目录并注册为新的工作区分组。 */
export function WorkspacePickerDialog({
  open,
  onClose,
  onOpenChange,
  onSelect,
}: WorkspacePickerDialogProps): React.ReactElement | null {
  const {
    listing,
    loading,
    browse,
    refresh,
    goParent,
    selectCurrentDirectory,
  } = useWorkspacePicker();

  if (!open) return null;

  function close(): void {
    if (onClose) {
      onClose();
      return;
    }
    onOpenChange?.(false);
  }

  async function handleSelectCurrentDirectory(): Promise<void> {
    const workspace = await selectCurrentDirectory();
    onSelect(workspace);
  }

  const directories = listing?.entries.filter((entry) => entry.isDir) ?? [];

  return (
    <div
      className="workspace-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <section
        className="workspace-picker-panel"
        role="dialog"
        aria-modal="true"
      >
        <header className="workspace-picker-header">
          <div>
            <h2>选择工作区</h2>
            <p>从当前项目目录中选择 Agent 的工作目录。</p>
          </div>

          <button
            type="button"
            className="workspace-picker-close"
            onClick={close}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <section className="workspace-picker-current">
          <span>当前目录</span>
          <strong>{listing?.absolutePath ?? '加载中...'}</strong>
        </section>

        <section className="workspace-picker-tree">
          {listing?.parentRelativePath ? (
            <button
              type="button"
              className="workspace-picker-row"
              onClick={() => void goParent()}
            >
              <span className="workspace-picker-row-icon">↩</span>
              <span className="workspace-picker-row-name">返回上一级</span>
            </button>
          ) : null}

          {loading ? (
            <div className="workspace-picker-empty">正在加载...</div>
          ) : null}

          {!loading
            ? directories.map((entry) => (
                <button
                  key={entry.relativePath}
                  type="button"
                  className="workspace-picker-row"
                  onClick={() => void browse(entry.relativePath)}
                >
                  <span className="workspace-picker-chevron">›</span>
                  <span className="workspace-picker-row-icon">📁</span>
                  <span className="workspace-picker-row-name">{entry.name}</span>
                </button>
              ))
            : null}

          {!loading && directories.length === 0 ? (
            <div className="workspace-picker-empty">
              当前目录下没有可进入的子目录
            </div>
          ) : null}
        </section>

        <footer className="workspace-picker-footer">
          <button
            type="button"
            className="workspace-picker-button secondary"
            onClick={close}
          >
            取消
          </button>

          <button
            type="button"
            className="workspace-picker-button secondary"
            onClick={() => void refresh()}
          >
            刷新
          </button>

          <button
            type="button"
            className="workspace-picker-button primary"
            onClick={() => void handleSelectCurrentDirectory()}
          >
            选择当前目录
          </button>
        </footer>
      </section>
    </div>
  );
}
