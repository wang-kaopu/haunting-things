import type React from 'react';
import { useRef, useState } from 'react';
import type { AttachmentRef } from '@shared/types';

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

  async function addFiles(files: FileList | File[]): Promise<void> {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    await onAddImages(images);
  }

  return (
    <div
      className={`image-picker ${dragging ? 'dragging' : ''}`}
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
      <button
        type="button"
        className="composer-icon-button image-picker-button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        aria-label={uploading ? '图片上传中' : '添加图片'}
        title={uploading ? '图片上传中' : '添加图片'}
      >
        {uploading ? '…' : '+'}
      </button>
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
    <div className="image-attachment-list">
      {attachments.map((attachment) => (
        <figure className="image-attachment-preview" key={attachment.id}>
          <img src={attachment.url} alt={attachment.name} />
          <button
            type="button"
            aria-label={`移除 ${attachment.name}`}
            title={`移除 ${attachment.name}`}
            onClick={() => onRemove(attachment.id)}
          >
            <RemoveImageIcon />
          </button>
        </figure>
      ))}
    </div>
  );
}

/** 图片预览移除图标。 */
function RemoveImageIcon(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
