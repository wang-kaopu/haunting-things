import type React from 'react';
import type { Workspace } from '@shared/types';
import { useWorkspacePicker } from '@renderer/features/workspace/hooks/useWorkspacePicker';

export type WorkspacePickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (workspace: Workspace) => void;
};

/** 从启动项目目录中选择一个子目录并注册为新的工作区分组。 */
export function WorkspacePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: WorkspacePickerDialogProps): React.ReactElement | null {
  const {
    listing,
    loading,
    error,
    browse,
    refresh,
    goParent,
    selectCurrentDirectory,
  } = useWorkspacePicker();

  if (!open) return null;

  async function handleSelect(): Promise<void> {
    const workspace = await selectCurrentDirectory();
    onSelect(workspace);
    onOpenChange(false);
  }

  const directories = listing?.entries.filter((entry) => entry.isDir) ?? [];

  return (
    <div
      className="settings-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <section
        className="settings-dialog workspace-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-picker-title"
      >
        <header className="settings-dialog-header">
          <div>
            <h2 id="workspace-picker-title">新建工作区</h2>
            <p>当前目录：{listing?.absolutePath ?? '/Users/wkp/workspace/haunting-souls'}</p>
          </div>

          <button
            type="button"
            className="settings-close-button"
            onClick={() => onOpenChange(false)}
            aria-label="关闭新建工作区"
          >
            ×
          </button>
        </header>

        <div className="settings-panel workspace-picker-body">
          {error ? <p className="settings-error">{error}</p> : null}

          <section className="settings-section workspace-picker-browser">
            <h3>文件夹</h3>
            <div className="workspace-picker-tree">
              {listing?.parentRelativePath ? (
                <button type="button" className="workspace-picker-row" onClick={() => void goParent()}>
                  <span className="workspace-picker-icon">↩</span>
                  <span>返回上一级</span>
                </button>
              ) : null}

              {loading ? <div className="workspace-picker-empty">正在加载...</div> : null}

              {!loading
                ? directories.map((entry) => (
                    <button
                      key={entry.relativePath}
                      type="button"
                      className="workspace-picker-row"
                      onClick={() => void browse(entry.relativePath)}
                    >
                      <span className="workspace-picker-caret">›</span>
                      <span className="workspace-picker-folder" aria-hidden="true" />
                      <span className="workspace-picker-name">{entry.name}</span>
                    </button>
                  ))
                : null}

              {!loading && directories.length === 0 ? (
                <div className="workspace-picker-empty">当前目录下没有可选择的子目录</div>
              ) : null}
            </div>
          </section>

          <footer className="workspace-picker-footer">
            <button type="button" className="workspace-picker-secondary" onClick={() => onOpenChange(false)}>
              取消
            </button>

            <button type="button" className="workspace-picker-secondary" onClick={() => void refresh()} disabled={loading}>
              刷新
            </button>

            <button type="button" className="workspace-picker-primary" onClick={() => void handleSelect()} disabled={loading}>
              新建当前目录工作区
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
