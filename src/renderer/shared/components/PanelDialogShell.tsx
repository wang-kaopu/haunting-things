import type React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/shared/components/ui/dialog';
import { cn } from '@renderer/shared/lib/utils';

/** 面板式弹窗的共享基础属性。 */
type PanelDialogShellBaseProps = {
  open: boolean;
  titleId: string;
  title: string;
  description?: string;
  closeLabel: string;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  className?: string;
  children: React.ReactNode;
  onClose: () => void;
};

/** 面板式弹窗骨架属性；表单模式要求提供提交回调。 */
export type PanelDialogShellProps =
  | (PanelDialogShellBaseProps & {
      as?: 'section';
      onSubmit?: never;
    })
  | (PanelDialogShellBaseProps & {
      as: 'form';
      onSubmit: React.FormEventHandler<HTMLFormElement>;
    });

/**
 * 面板式弹窗兼容层，内部使用 Radix Dialog 管理焦点、Esc 和可访问性语义。
 */
export function PanelDialogShell(props: PanelDialogShellProps): React.ReactElement {
  const content = (
    <>
      <DialogHeader className="panel-dialog-header">
        <div>
          <DialogTitle data-title-id={props.titleId}>{props.title}</DialogTitle>
          {props.description ? (
            <DialogDescription>{props.description}</DialogDescription>
          ) : null}
        </div>
      </DialogHeader>
      {props.children}
    </>
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || props.closeDisabled) return;
        props.onClose();
      }}
    >
      <DialogContent
        aria-label={props.closeLabel}
        className={cn('panel-dialog', props.className)}
        onEscapeKeyDown={(event) => {
          if (props.closeDisabled) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (!props.closeOnBackdrop || props.closeDisabled) {
            event.preventDefault();
          }
        }}
      >
        {props.as === 'form' ? (
          <form className="contents" onSubmit={props.onSubmit}>
            {content}
          </form>
        ) : (
          <section className="contents">
            {content}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
