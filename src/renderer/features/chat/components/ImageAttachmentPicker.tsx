import type React from 'react';
import { useRef, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import type { AttachmentRef } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import { cn } from '@renderer/shared/lib/utils';

/** 图片选择器的上传行为配置。 */
export type ImageAttachmentPickerProps = {
  disabled?: boolean;
  uploading?: boolean;
  onAddImages: (files: File[]) => Promise<void>;
};

/**
 * 图片选择入口——图标按钮，不再显示"添加图片"长文字。
 *
 * 负责文件选择和拖拽收集；上传、命名和错误状态交给上层 composer 统一处理。
 */
export function ImageAttachmentPicker({
  disabled,
  uploading,
  onAddImages,
}: ImageAttachmentPickerProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /** 从文件选择或拖拽结果中筛选图片并交给上层上传。 */
  async function addFiles(files: FileList | File[]): Promise<void> {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    await onAddImages(images);
  }

  return (
    <div
      className="relative inline-flex min-w-0 items-center"
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) void addFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files) void addFiles(files);
          event.currentTarget.value = '';
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'size-8 rounded-full text-muted-foreground hover:text-foreground',
          dragging && 'bg-accent text-accent-foreground'
        )}
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        aria-label={uploading ? '图片上传中' : '添加图片'}
        title={uploading ? '图片上传中' : '添加图片'}
      >
        {uploading ? <span aria-hidden="true" className="text-base leading-none">…</span> : <PlusIcon aria-hidden="true" className="size-3.5" />}
      </Button>
    </div>
  );
}

/**
 * 展示待发送图片的横向缩略图预览。
 *
 * 预览位于输入框上方，和 Chat新 网页版的附件布局保持一致。
 */
export function ImageAttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: AttachmentRef[];
  onRemove: (id: string) => void;
}): React.ReactElement | null {
  if (attachments.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto px-0.5 py-0.5 [scrollbar-color:#d9d9d9_transparent] [scrollbar-width:thin]">
      {attachments.map((attachment) => (
        <figure
          className="relative m-0 size-[72px] shrink-0 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
          key={attachment.id}
        >
          <img
            className="block size-full rounded-[11px] bg-muted object-cover"
            src={attachment.url}
            alt={attachment.name}
          />
          <Button
            type="button"
            size="icon"
            className="absolute right-1 top-1 size-[18px] rounded-full bg-foreground text-background shadow-sm hover:bg-foreground/85 hover:text-background"
            aria-label={`移除 ${attachment.name}`}
            title={`移除 ${attachment.name}`}
            onClick={() => onRemove(attachment.id)}
          >
            <XIcon aria-hidden="true" className="size-2.5" />
          </Button>
        </figure>
      ))}
    </div>
  );
}
