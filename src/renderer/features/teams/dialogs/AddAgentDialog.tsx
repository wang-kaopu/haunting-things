import { useEffect, useState } from 'react';
import type React from 'react';
import type { AgentBackend } from '../../../../shared/types';
import type { AddAgentInput } from '../../../shared/types/ui';

export type AddAgentDialogProps = {
  open: boolean;
  disabled?: boolean;
  defaultBackend?: AgentBackend;
  defaultModel?: string;
  onClose: () => void;
  onSubmit: (input: AddAgentInput) => Promise<void>;
};

export type AddAgentFormState = {
  name: string;
  backend: AgentBackend;
  model: string;
};

export function AddAgentDialog({
  open,
  disabled,
  defaultBackend = 'claude',
  defaultModel = '',
  onClose,
  onSubmit,
}: AddAgentDialogProps): React.ReactElement | null {
  const [form, setForm] = useState<AddAgentFormState>({
    name: '',
    backend: defaultBackend,
    model: defaultModel,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({ name: '', backend: defaultBackend, model: defaultModel });
    setError('');
    setSubmitting(false);
  }, [defaultBackend, defaultModel, open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="modal panel"
        onSubmit={async (event) => {
          event.preventDefault();
          const name = form.name.trim();
          if (!name) {
            setError('请输入 Agent 名称。');
            return;
          }
          try {
            setSubmitting(true);
            setError('');
            await onSubmit({
              name,
              backend: form.backend,
              model: form.model.trim() || undefined,
            });
            setForm({ name: '', backend: defaultBackend, model: defaultModel });
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h3>添加 Agent</h3>
        <label className="field">
          <span>Agent 名称</span>
          <input
            value={form.name}
            autoFocus
            disabled={disabled}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>后端</span>
          <select
            value={form.backend}
            disabled={disabled}
            onChange={(event) => setForm((current) => ({ ...current, backend: event.target.value as AgentBackend }))}
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <label className="field">
          <span>模型 ID，可选</span>
          <input
            value={form.model}
            placeholder={defaultModel || '默认'}
            disabled={disabled}
            onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="submit" disabled={submitting || disabled}>
            {submitting ? '添加中...' : '添加'}
          </button>
        </div>
      </form>
    </div>
  );
}
