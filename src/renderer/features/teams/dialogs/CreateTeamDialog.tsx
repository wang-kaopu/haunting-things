import { useEffect, useState } from 'react';
import type React from 'react';
import type { AgentBackend } from '@shared/types';
import { CustomSelect } from '@renderer/shared/components/CustomSelect';
import { PanelDialogShell } from '@renderer/shared/components/PanelDialogShell';
import type { CreateTeamInput } from '@renderer/shared/types/ui';

/** 创建团队弹窗的打开状态、默认工作区和提交回调。 */
export type CreateTeamDialogProps = {
  open: boolean;
  defaultWorkspaceId?: string | null;
  onClose: () => void;
  onSubmit: (input: CreateTeamInput) => Promise<void>;
};

/** 创建团队表单当前填写的名称、Leader 后端和工作区。 */
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
    <PanelDialogShell
      open={open}
      as="form"
      className="create-team-dialog"
      titleId="create-team-title"
      title="创建团队"
      description="配置团队名称和 Leader 使用的 Agent 类型。"
      closeLabel="关闭创建团队"
      closeDisabled={submitting}
      closeOnBackdrop
      onClose={onClose}
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
      <div className="panel-dialog-panel">
        <section className="panel-dialog-section">
          <h3>团队</h3>

          <div className="panel-dialog-item">
            <div className="panel-dialog-item-main create-team-item-main">
              <label className="panel-dialog-item-copy" htmlFor="create-team-name">
                <strong>团队名称</strong>
                <span>用于侧边栏和会话上下文展示。</span>
              </label>

              <div className="create-team-field-control">
                <input
                  id="create-team-name"
                  value={form.name}
                  autoFocus
                  disabled={submitting}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="panel-dialog-item">
            <div className="panel-dialog-item-main create-team-item-main">
              <div className="panel-dialog-item-copy">
                <strong>类型</strong>
                <span>选择 Leader 后续任务使用的 Agent 类型。</span>
              </div>

              <CustomSelect
                className="model-select create-team-type-select"
                ariaLabel="类型"
                value={form.leaderBackend}
                disabled={submitting}
                options={[
                  { value: 'codex', label: 'Codex' },
                  { value: 'claude', label: 'Claude Code' },
                ]}
                onChange={(value) => setForm((current) => ({ ...current, leaderBackend: value as AgentBackend }))}
              />
            </div>
          </div>

          {error ? <p className="panel-dialog-error">{error}</p> : null}

          <div className="modal-actions create-team-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </section>
      </div>
    </PanelDialogShell>
  );
}
