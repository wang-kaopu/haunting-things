import { useRef, useState } from 'react';
import type React from 'react';
import type {
  AttachmentRef,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  TeamAgent,
} from '../../../../shared/types';
import { bridge } from '../../../shared/bridgeClient';
import { normalizeAttachmentRef } from '../../../shared/utils/backendData';
import { ComposerTools } from './ComposerTools';
import { ImageAttachmentPicker, ImageAttachmentPreview } from './ImageAttachmentPicker';

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Composer 提交给 Team 发送逻辑的消息载荷。 */
export type SendBoxPayload = {
  content: string;
  files?: string[];
};

/** 消息输入框所需的运行时快照和提交回调。 */
export type SendBoxProps = {
  disabled?: boolean;
  activeAgent?: TeamAgent | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onSend: (payload: SendBoxPayload) => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
  onSetMode: (mode: string) => Promise<void>;
};

/**
 * Team 会话的消息输入框。
 *
 * 图片在选择或粘贴后会立即上传到后端缓存，真正发送消息时只传附件 ID。
 */
export function SendBox({
  disabled,
  activeAgent,
  commands,
  models,
  mode,
  onSend,
  onSetModel,
  onSetMode,
}: SendBoxProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  /**
   * 提交文本和已上传附件。
   */
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

  /**
   * 上传图片并把后端返回的附件引用加入待发送列表。
   */
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

  /**
   * 处理剪贴板图片。
   *
   * 粘贴图片通常没有稳定文件名，这里统一命名为 image、image-1 等，便于前端和数据库展示。
   */
  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    await uploadImages(imageFiles, { pasted: true });
  }

  /**
   * 移除尚未发送的图片，并同步删除后端缓存。
   */
  async function removeAttachment(id: string): Promise<void> {
    try {
      setError('');
      await bridge.invoke('attachment.delete', { attachmentId: id });
      setAttachments((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** 把命令插入到消息框最前面，格式固定为 `/{command_name} `。 */
  function insertCommand(commandName: string): void {
    const normalized = commandName.trim().replace(/^\/+/, '');
    if (!normalized || disabled || sending) return;
    const prefix = `/${normalized} `;
    setContent((current) => `${prefix}${current}`);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(prefix.length, prefix.length);
    });
  }

  return (
    <div className="composer">
      <ImageAttachmentPreview
        attachments={attachments}
        onRemove={(id) => void removeAttachment(id)}
      />
      <textarea
        ref={textareaRef}
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
          commands={commands}
          models={models}
          mode={mode}
          onSetModel={onSetModel}
          onSetMode={onSetMode}
          disabled={disabled || sending}
          onSelectCommand={insertCommand}
          imagePicker={
            <ImageAttachmentPicker
              disabled={disabled || sending}
              uploading={uploading}
              onAddImages={uploadImages}
            />
          }
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

/**
 * 上传单张图片并解析后端返回的附件引用。
 */
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

/**
 * 为粘贴图片生成不冲突的展示文件名。
 */
function nextPastedImageName(file: File, usedNames: Set<string>): string {
  const extension = extensionForMime(file.type);
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? `image.${extension}` : `image-${index}.${extension}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}

/**
 * 根据图片 MIME 推断前端上传文件名扩展名。
 */
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

/**
 * 读取图片并生成浏览器上传接口使用的 data URL。
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('图片读取失败')));
    reader.readAsDataURL(file);
  });
}
