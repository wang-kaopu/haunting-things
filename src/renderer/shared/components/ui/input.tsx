import type React from 'react';
import { cn } from '@renderer/shared/lib/utils';

/** 通用文本输入框，统一登录页和弹窗表单的基础视觉与焦点状态。 */
export type InputProps = React.ComponentProps<'input'>;

/**
 * 通用输入框组件，避免依赖全局 input 样式。
 */
export function Input({ className, type, ...props }: InputProps): React.ReactElement {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        'h-10 w-full rounded-md border border-transparent bg-muted px-3 py-0 text-sm text-foreground shadow-none outline-none transition-[background-color,border-color,box-shadow] hover:bg-accent focus-visible:border-primary/20 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/5 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
