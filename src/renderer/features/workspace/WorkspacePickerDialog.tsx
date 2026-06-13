import type React from 'react';
import { ArrowUpIcon, ChevronRightIcon } from 'lucide-react';
import type { Workspace } from '@shared/types';
import { useWorkspacePicker } from '@renderer/features/workspace/hooks/useWorkspacePicker';
import { FileIcon } from '@renderer/shared/components/FileIcon';
import { Button } from '@renderer/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/shared/components/ui/dialog';
import { ScrollArea } from '@renderer/shared/components/ui/scroll-area';

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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent className="w-[min(680px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>选择工作区</DialogTitle>
          <DialogDescription>从当前项目目录中选择 Agent 的工作目录。</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 px-6 py-5">
          <section className="grid gap-1 rounded-lg bg-muted p-3">
            <span className="text-xs font-medium text-muted-foreground">当前目录</span>
            <strong className="min-w-0 break-all text-sm font-medium text-foreground">{listing?.absolutePath ?? '加载中...'}</strong>
          </section>

          <section className="min-h-[300px] overflow-hidden rounded-lg bg-muted p-1">
            <ScrollArea className="max-h-[380px] min-h-[300px]">
              <div className="grid gap-0.5">
                {listing?.parentRelativePath ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="grid h-10 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-md px-3 text-left text-sm font-normal"
                    onClick={() => void goParent()}
                  >
                    <ArrowUpIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                    <span className="min-w-0 truncate">返回上一级</span>
                  </Button>
                ) : null}

                {loading ? (
                  <div className="px-3 py-10 text-center text-sm text-muted-foreground">正在加载...</div>
                ) : null}

                {!loading
                  ? directories.map((entry) => (
                      <Button
                        key={entry.relativePath}
                        type="button"
                        variant="ghost"
                        className="grid h-10 w-full grid-cols-[18px_20px_minmax(0,1fr)] items-center gap-2 rounded-md px-3 text-left text-sm font-normal"
                        onClick={() => void browse(entry.relativePath)}
                      >
                        <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                        <FileIcon name={entry.name} isDirectory />
                        <span className="min-w-0 truncate">{entry.name}</span>
                      </Button>
                    ))
                  : null}

                {!loading && directories.length === 0 ? (
                  <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                    当前目录下没有可进入的子目录
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </section>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={close}
          >
            取消
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => void refresh()}
          >
            刷新
          </Button>

          <Button
            type="button"
            onClick={() => void handleSelectCurrentDirectory()}
          >
            选择当前目录
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
