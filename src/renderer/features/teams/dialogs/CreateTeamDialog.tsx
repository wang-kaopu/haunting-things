import { useEffect, useState } from 'react';
import type React from 'react';
import type { AgentBackend, Workspace } from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';
import type { CreateTeamInput } from '@renderer/shared/types/ui';
import { normalizeWorkspace } from '@renderer/shared/utils/backendData';

export type CreateTeamDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateTeamInput) => Promise<void>;
};

export type CreateTeamFormState = {
  name: string;
  leaderBackend: AgentBackend;
  leaderModel: string;
  workspaceMode: 'temporary' | 'existing' | 'local';
  workspaceId: string;
  workspacePath: string;
};

/** 创建团队弹窗，同时收集 leader Agent 的后端和初始模型。 */
export function CreateTeamDialog({ open, onClose, onSubmit }: CreateTeamDialogProps): React.ReactElement | null {
  const [form, setForm] = useState<CreateTeamFormState>({
    name: '',
    leaderBackend: 'codex',
    leaderModel: '',
    workspaceMode: 'temporary',
    workspaceId: '',
    workspacePath: '',
  });
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    bridge
      .invoke('workspace.list', undefined)
      .then((items) => {
        if (cancelled) return;
        setWorkspaces(items.map(normalizeWorkspace).filter((workspace): workspace is Workspace => workspace !== null));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
            const workspaceId = await resolveWorkspaceId({
              mode: form.workspaceMode,
              workspaceId: form.workspaceId,
              workspacePath: form.workspacePath,
            });
            await onSubmit({
              name,
              leaderBackend: form.leaderBackend,
              leaderModel: form.leaderModel.trim() || undefined,
              workspaceId,
            });
            setForm({
              name: '',
              leaderBackend: 'codex',
              leaderModel: '',
              workspaceMode: 'temporary',
              workspaceId: '',
              workspacePath: '',
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
          <span>工作区</span>
          <select
            value={form.workspaceMode}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                workspaceMode: event.target.value as CreateTeamFormState['workspaceMode'],
              }))
            }
          >
            <option value="temporary">临时工作区</option>
            <option value="existing">已有工作区</option>
            <option value="local">本地路径</option>
          </select>
        </label>
        {form.workspaceMode === 'existing' ? (
          <label className="field">
            <span>选择工作区</span>
            <select
              value={form.workspaceId}
              onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))}
            >
              <option value="">请选择</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {form.workspaceMode === 'local' ? (
          <label className="field">
            <span>本地路径</span>
            <input
              value={form.workspacePath}
              placeholder="/path/to/project"
              onChange={(event) => setForm((current) => ({ ...current, workspacePath: event.target.value }))}
            />
          </label>
        ) : null}
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
        <label className="field">
          <span>模型 ID，可选</span>
          <input
            value={form.leaderModel}
            placeholder="默认"
            onChange={(event) => setForm((current) => ({ ...current, leaderModel: event.target.value }))}
          />
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

async function resolveWorkspaceId(input: {
  mode: CreateTeamFormState['workspaceMode'];
  workspaceId: string;
  workspacePath: string;
}): Promise<string | undefined> {
  if (input.mode === 'temporary') return undefined;
  if (input.mode === 'existing') {
    const workspaceId = input.workspaceId.trim();
    if (!workspaceId) throw new Error('请选择工作区。');
    return workspaceId;
  }

  const workspacePath = input.workspacePath.trim();
  if (!workspacePath) throw new Error('请输入本地路径。');
  const workspace = await bridge.invoke('workspace.create', { path: workspacePath });
  return workspace.id;
}
