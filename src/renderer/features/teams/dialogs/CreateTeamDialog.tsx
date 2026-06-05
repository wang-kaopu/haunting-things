import { useEffect, useState } from 'react';
import type React from 'react';
import type { AgentBackend } from '@shared/types';
import type { CreateTeamInput } from '@renderer/shared/types/ui';

export type CreateTeamDialogProps = {
  open: boolean;
  defaultWorkspaceId?: string | null;
  onClose: () => void;
  onSubmit: (input: CreateTeamInput) => Promise<void>;
};

export type CreateTeamFormState = {
  name: string;
  leaderBackend: AgentBackend;
  workspaceId: string;
};

/** 创建团队弹窗，工作区由入口按钮所在分组自动决定。 */
export function CreateTeamDialog({ open, defaultWorkspaceId, onClose, onSubmit }: CreateTeamDialogProps): React.ReactElement | null {
  const [form, setForm] = useState<CreateTeamFormState>({
    name: '',
    leaderBackend: 'codex',
    workspaceId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({
      ...current,
      workspaceId: defaultWorkspaceId ?? '',
    }));
  }, [defaultWorkspaceId, open]);

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
            setError('请输入团队名称。');
            return;
          }
          try {
            setSubmitting(true);
            setError('');
            await onSubmit({
              name,
              leaderBackend: form.leaderBackend,
              workspaceId: form.workspaceId || undefined,
            });
            setForm({
              name: '',
              leaderBackend: 'codex',
              workspaceId: '',
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h3>创建团队</h3>
        <label className="field">
          <span>团队名称</span>
          <input
            value={form.name}
            autoFocus
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Leader 后端</span>
          <select
            value={form.leaderBackend}
            onChange={(event) => setForm((current) => ({ ...current, leaderBackend: event.target.value as AgentBackend }))}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </form>
    </div>
  );
}
