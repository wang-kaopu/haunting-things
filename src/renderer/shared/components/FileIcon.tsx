import type React from 'react';
import { FileIcon as FileIconGlyph, FolderIcon } from 'lucide-react';
import { cn } from '@renderer/shared/lib/utils';

/** 文件或目录图标组件的渲染参数。 */
export type FileIconProps = {
  isDirectory: boolean;
  className?: string;
};

/** 使用 Lucide 图标渲染文件或目录。 */
export function FileIcon({ isDirectory, className }: FileIconProps): React.ReactElement {
  const Icon = isDirectory ? FolderIcon : FileIconGlyph;

  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />;
}
