import { Loader2Icon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@renderer/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/shared/components/ui/dialog';
import { cn } from '@renderer/shared/lib/utils';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  confirmVariant?: 'default' | 'destructive';
  disabled?: boolean;
  className?: string;
  onConfirm: () => void | Promise<void>;
};

/**
 * 通用轻量确认弹窗，用于复用较小字号的确认面板样式和异步确认状态。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  loadingLabel = confirmLabel,
  confirmVariant = 'default',
  disabled = false,
  className,
  onConfirm,
}: ConfirmDialogProps): React.ReactElement {
  const [pending, setPending] = useState(false);
  const confirmDisabled = pending || disabled;

  /**
   * 执行确认动作并在成功后关闭弹窗，失败时保留弹窗让上层错误提示可见。
   */
  async function handleConfirm(): Promise<void> {
    if (confirmDisabled) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className={cn('w-[min(380px,calc(100vw-32px))] rounded-xl', className)}>
        <DialogHeader className="gap-2 px-5 py-4 pr-12">
          <DialogTitle className="text-[15px] font-semibold leading-6">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter className="px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={confirmDisabled}
            onClick={() => void handleConfirm()}
          >
            {pending ? (
              <>
                <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
                {loadingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
