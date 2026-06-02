import { useState } from 'react';
import type React from 'react';
import type {
  AttachmentRef,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../../shared/types';
import { bridge } from '../../../shared/bridgeClient';
import { normalizeAttachmentRef } from '../../../shared/utils/backendData';
import { ComposerTools } from './ComposerTools';
import { ImageAttachmentPicker, ImageAttachmentPreview } from './ImageAttachmentPicker';

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type SendBoxPayload = {
  content: string;
  files?: string[];
};

export type SendBoxProps = {
  disabled?: boolean;
  activeAgent?: TeamAgent | null;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onSend: (payload: SendBoxPayload) => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
};

export function SendBox({
  disabled,
  activeAgent,
  usage,
  commands,
  models,
  mode,
  onSend,
  onSetModel,
}: SendBoxProps): React.ReactElement {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function submit(): Promise<void> {
    const trimmed = content.trim();
    if ((!trimmed && attachments.length === 0) || disabled || sending || uploading) return;

    try {
      setSending(true);
      setError('');
      await onSend({
        content: trimmed,
        files: attachments.length > 0 ? attachments.map((item) => item.id) : undefined,
      });
      setContent('');
      setAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function uploadImages(files: File[], options: { pasted?: boolean } = {}): Promise<void> {
    if (disabled || files.length === 0) return;
    try {
      setUploading(true);
      setError('');
      const uploaded: AttachmentRef[] = [];
      const usedNames = new Set(attachments.map((item) => item.name));
      for (const file of files) {
        const fileName = options.pasted ? nextPastedImageName(file, usedNames) : undefined;
        if (fileName) usedNames.add(fileName);
        uploaded.push(await uploadImage(file, fileName));
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    await uploadImages(imageFiles, { pasted: true });
  }

  async function removeAttachment(id: string): Promise<void> {
    try {
      setError('');
      await bridge.invoke('attachment.delete', { attachmentId: id });
      setAttachments((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="composer">
      <ImageAttachmentPreview
        attachments={attachments}
        onRemove={(id) => void removeAttachment(id)}
      />
      <textarea
        value={content}
        disabled={disabled || sending}
        placeholder={disabled ? '请选择团队' : '给团队发送消息'}
        onChange={(event) => setContent(event.target.value)}
        onPaste={(event) => void handlePaste(event)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-footer">
        <ComposerTools
          activeAgent={activeAgent}
          usage={usage}
          commands={commands}
          models={models}
          mode={mode}
          onSetModel={onSetModel}
        />
        <ImageAttachmentPicker
          disabled={disabled || sending}
          uploading={uploading}
          onAddImages={uploadImages}
        />
        <button
          type="button"
          disabled={disabled || sending || uploading || (!content.trim() && attachments.length === 0)}
          onClick={() => void submit()}
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>
      {error ? <p className="send-error">{error}</p> : null}
    </div>
  );
}

async function uploadImage(file: File, fileName?: string): Promise<AttachmentRef> {
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    throw new Error(`不支持的图片类型：${file.type || file.name}`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('图片不能超过 10MB');
  }
  const dataBase64 = await readFileAsDataUrl(file);
  const resolvedFileName = fileName ?? (file.name || `image.${extensionForMime(file.type)}`);
  const response = await bridge.invoke('attachment.upload', {
    fileName: resolvedFileName,
    mimeType: file.type,
    dataBase64,
  });
  const attachment = normalizeAttachmentRef(response);
  if (!attachment) throw new Error('图片上传响应格式无效');
  return attachment;
}

function nextPastedImageName(file: File, usedNames: Set<string>): string {
  const extension = extensionForMime(file.type);
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? `image.${extension}` : `image-${index}.${extension}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('图片读取失败')));
    reader.readAsDataURL(file);
  });
}
