import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 Tailwind 与 shadcn className，并让后出现的 utility 覆盖冲突样式。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
