import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { cn } from '@renderer/shared/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent bg-transparent text-sm font-medium text-foreground shadow-none transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'text-destructive hover:bg-destructive/10',
        outline: 'hover:bg-accent hover:text-accent-foreground',
        secondary: 'hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

/** shadcn 按钮组件属性，支持 asChild 以复用按钮样式到其他可交互元素。 */
export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

/**
 * 通用按钮组件，作为后续 UI 迁移的基础交互控件。
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
