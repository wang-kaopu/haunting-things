import type React from 'react';
import { cn } from '@renderer/shared/lib/utils';
import { resolveFileIcon } from '@renderer/shared/utils/fileIcon';

/** 文件或目录图标组件的渲染参数。 */
export type FileIconProps = {
  name: string;
  isDirectory: boolean;
  isRoot?: boolean;
  className?: string;
};

/** 使用当前项目内置的 VS Code 文件图标主题渲染文件或目录图标。 */
export function FileIcon({
  name,
  isDirectory,
  isRoot,
  className,
}: FileIconProps): React.ReactElement {
  const iconSrc = resolveFileIcon({ name, isDirectory, isRoot });

  return (
    <img
      aria-hidden="true"
      alt=""
      className={cn('size-4 shrink-0 object-contain', className)}
      src={iconSrc}
    />
  );
}
