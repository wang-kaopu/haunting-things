import { useEffect, useState } from 'react';
import type React from 'react';
import type { AgentBackend } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/shared/components/ui/select';
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <form
          className="contents"
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
          <DialogHeader>
            <DialogTitle>创建团队</DialogTitle>
            <DialogDescription>配置团队名称和 Leader 使用的 Agent 类型。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-6 py-5">
            <label className="grid gap-2 text-sm" htmlFor="create-team-name">
              <span className="text-xs font-medium text-muted-foreground">团队名称</span>
              <input
                id="create-team-name"
                className="h-10 rounded-md bg-muted px-3 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                value={form.name}
                autoFocus
                disabled={submitting}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>

            <div className="grid gap-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">类型</span>
              <Select
                value={form.leaderBackend}
                disabled={submitting}
                onValueChange={(value) => setForm((current) => ({ ...current, leaderBackend: value as AgentBackend }))}
              >
                <SelectTrigger aria-label="类型" className="bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="codex">Codex</SelectItem>
                  <SelectItem value="claude">Claude Code</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
