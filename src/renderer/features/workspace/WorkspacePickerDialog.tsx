import type React from 'react';
import type { Workspace } from '@shared/types';
import { useWorkspacePicker } from '@renderer/features/workspace/hooks/useWorkspacePicker';
import { PanelDialogShell } from '@renderer/shared/components/PanelDialogShell';

/** 工作区选择弹窗的打开状态和选中目录回调。 */
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

  /** 兼容受控和非受控两种弹窗关闭方式。 */
  function close(): void {
    if (onClose) {
      onClose();
      return;
    }
    onOpenChange?.(false);
  }

  /** 将当前浏览目录注册为工作区并关闭弹窗。 */
  async function handleSelectCurrentDirectory(): Promise<void> {
    const workspace = await selectCurrentDirectory();
    onSelect(workspace);
    close();
  }

  const directories = listing?.entries.filter((entry) => entry.isDir) ?? [];

  return (
    <PanelDialogShell
      open={open}
      className="workspace-picker-dialog"
      titleId="workspace-picker-title"
      title="选择工作区"
      description="从当前项目目录中选择 Agent 的工作目录。"
      closeLabel="关闭"
      closeOnBackdrop
      onClose={close}
    >
      <div className="panel-dialog-panel workspace-picker-content">
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
      </div>
    </PanelDialogShell>
  );
}
