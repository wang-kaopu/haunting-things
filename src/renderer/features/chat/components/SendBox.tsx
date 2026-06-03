import type React from 'react';
import { useRef, useState } from 'react';
import type {
  AgentTurnPhase,
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
  activePhase?: AgentTurnPhase;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onSend: (payload: SendBoxPayload) => Promise<void>;
  onCancel: () => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
  onSetMode: (mode: string) => Promise<void>;
};

/**
 * 新 风格底部悬浮消息输入框。
 *
 * 圆角大边框、文本区无边框、工具栏和圆形发送按钮在下方。
 * 保留 Enter 发送、Shift+Enter 换行、图片粘贴上传逻辑。
 */
export function SendBox({
  disabled,
  activeAgent,
  activePhase,
  commands,
  models,
  mode,
  onSend,
  onCancel,
  onSetModel,
  onSetMode,
}: SendBoxProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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

  async function cancelTurn(): Promise<void> {
    if (disabled || cancelling) return;

    try {
      setCancelling(true);
      setError('');
      await onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
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

  const canCancel = !disabled && isCancellablePhase(activePhase);
  const canSend = !canCancel && !disabled && !sending && !uploading && (content.trim().length > 0 || attachments.length > 0);
  const sendButtonLabel = canCancel ? (cancelling ? '正在取消' : '停止生成') : (sending ? '发送中' : '发送消息');

  return (
    <div className="composer">
      <div className="composer-inner">
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
          rows={1}
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
            className={canCancel ? 'composer-send composer-send--stop' : 'composer-send'}
            disabled={canCancel ? cancelling : !canSend}
            onClick={() => {
              if (canCancel) {
                void cancelTurn();
                return;
              }
              void submit();
            }}
            aria-label={sendButtonLabel}
            title={sendButtonLabel}
          >
            {canCancel ? <span className="composer-stop-icon" aria-hidden="true" /> : sending ? '…' : '↑'}
          </button>
        </div>
        {error ? <p className="send-error">{error}</p> : null}
      </div>
    </div>
  );
}

function isCancellablePhase(phase?: AgentTurnPhase): boolean {
  return (
    phase === 'thinking' ||
    phase === 'planning' ||
    phase === 'replying' ||
    phase === 'tool_calling' ||
    phase === 'waiting_permission'
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
