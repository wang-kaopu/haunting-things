import { useState } from 'react';
import type React from 'react';
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../shared/types';
import { ComposerTools } from './ComposerTools';

export type SendBoxProps = {
  disabled?: boolean;
  activeAgent?: TeamAgent | null;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onSend: (content: string) => Promise<void>;
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function submit(): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed || disabled || sending) return;

    try {
      setSending(true);
      setError('');
      await onSend(trimmed);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      <textarea
        value={content}
        disabled={disabled || sending}
        placeholder={disabled ? '请选择团队' : '给团队发送消息'}
        onChange={(event) => setContent(event.target.value)}
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
        <button type="button" disabled={disabled || sending || !content.trim()} onClick={() => void submit()}>
          {sending ? '发送中...' : '发送'}
        </button>
      </div>
      {error ? <p className="send-error">{error}</p> : null}
    </div>
  );
}
