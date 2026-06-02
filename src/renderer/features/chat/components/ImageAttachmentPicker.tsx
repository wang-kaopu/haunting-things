import type React from 'react';
import { useRef, useState } from 'react';
import type { AttachmentRef } from '../../../../shared/types';

export type ImageAttachmentPickerProps = {
  disabled?: boolean;
  uploading?: boolean;
  onAddImages: (files: File[]) => Promise<void>;
};

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
        className="tool-pill image-picker-button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? '图片上传中' : '添加图片'}
      </button>
    </div>
  );
}

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
          <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => onRemove(attachment.id)}>
            x
          </button>
        </figure>
      ))}
    </div>
  );
}
