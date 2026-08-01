import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import type React from 'react';
import { cn } from '@renderer/shared/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

/**
 * Dialog 遮罩层，负责暗化背景并承载模态层级。
 */
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.ReactElement {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-black/28 backdrop-blur-sm', className)}
      {...props}
    />
  );
}

/**
 * Dialog 内容容器，包含默认遮罩、portal 和关闭按钮。
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}): React.ReactElement {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[min(720px,calc(100vw-48px))] max-h-[calc(100dvh-48px)] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-[26px] border border-border/70 bg-popover text-popover-foreground shadow-[0_24px_80px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.06)] outline-none',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute right-4 top-4 inline-flex size-8 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-foreground transition-colors hover:bg-accent focus-visible:outline-none disabled:pointer-events-none"
          >
            <XIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * Dialog 头部布局，统一标题和描述的间距。
 */
function DialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="dialog-header"
      className={cn('grid gap-1.5 border-b border-border px-6 py-5 pr-14', className)}
      {...props}
    />
  );
}

/**
 * Dialog 底部操作区。
 */
function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex items-center justify-end gap-2 border-t border-border px-6 py-4', className)}
      {...props}
    />
  );
}

/**
 * Dialog 标题文本。
 */
function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactElement {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg font-semibold leading-none tracking-normal', className)}
      {...props}
    />
  );
}

/**
 * Dialog 描述文本。
 */
function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>): React.ReactElement {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm leading-5 text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
