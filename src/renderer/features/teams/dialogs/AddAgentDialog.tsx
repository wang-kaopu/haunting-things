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
import type { AddAgentInput } from '@renderer/shared/types/ui';

/** 添加 Agent 弹窗的默认值、提交状态和关闭/提交回调。 */
export type AddAgentDialogProps = {
  open: boolean;
  disabled?: boolean;
  defaultBackend?: AgentBackend;
  onClose: () => void;
  onSubmit: (input: AddAgentInput) => Promise<void>;
};

/** 添加 Agent 表单当前填写的名称和后端。 */
export type AddAgentFormState = {
  name: string;
  backend: AgentBackend;
};

/** 添加团队成员弹窗，允许为新 Agent 覆盖默认后端。 */
export function AddAgentDialog({
  open,
  disabled,
  defaultBackend = 'claude',
  onClose,
  onSubmit,
}: AddAgentDialogProps): React.ReactElement | null {
  const [form, setForm] = useState<AddAgentFormState>({
    name: '',
    backend: defaultBackend,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({ name: '', backend: defaultBackend });
    setError('');
    setSubmitting(false);
  }, [defaultBackend, open]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <form
          className="contents"
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
              });
              setForm({ name: '', backend: defaultBackend });
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>添加 Agent</DialogTitle>
            <DialogDescription>为当前团队添加一个新的协作成员。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-6 py-5">
            <label className="grid gap-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Agent 名称</span>
              <input
                className="h-10 rounded-md bg-muted px-3 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                value={form.name}
                autoFocus
                disabled={disabled}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>

            <div className="grid gap-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">后端</span>
              <Select
                value={form.backend}
                disabled={disabled}
                onValueChange={(value) => setForm((current) => ({ ...current, backend: value as AgentBackend }))}
              >
                <SelectTrigger aria-label="后端" className="bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude Code</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || disabled}>
              {submitting ? '添加中...' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
