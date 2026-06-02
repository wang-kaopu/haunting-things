import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { ConversationMode, TeamAgent } from '../../../../shared/types';

type PermissionModeOption = {
  id: string;
  label: string;
  description: string;
  danger?: boolean;
};

const CLAUDE_MODE_OPTIONS: PermissionModeOption[] = [
  {
    id: 'default',
    label: 'default',
    description: 'Claude Code 标准权限行为，危险操作会请求确认。',
  },
  {
    id: 'acceptEdits',
    label: 'acceptEdits',
    description: '自动接受文件编辑操作，其他高风险操作仍按权限策略处理。',
  },
  {
    id: 'plan',
    label: 'plan',
    description: '规划模式，不执行实际工具操作。',
  },
  {
    id: 'dontAsk',
    label: 'dontAsk',
    description: '不弹权限确认，未预批准的工具会直接拒绝。',
  },
  {
    id: 'bypassPermissions',
    label: 'bypassPermissions',
    description: '跳过权限确认，仅建议在隔离环境中使用。',
    danger: true,
  },
];

const CODEX_MODE_OPTIONS: PermissionModeOption[] = [
  {
    id: 'read-only',
    label: 'read-only',
    description: '只允许读取和分析。',
  },
  {
    id: 'auto',
    label: 'auto',
    description: '默认推荐。允许在工作区内自动执行常见开发操作。',
  },
  {
    id: 'full-access',
    label: 'full-access',
    description: 'YOLO模式，仅建议在可信工作区或隔离环境中使用。',
    danger: true,
  },
];

export type PermissionModePickerProps = {
  agent?: TeamAgent | null;
  mode?: ConversationMode | null;
  onSetMode: (mode: string) => Promise<void>;
};

/** 展示当前 Agent 的权限模式，并把切换请求提交给后端运行时。 */
export function PermissionModePicker({
  agent,
  mode,
  onSetMode,
}: PermissionModePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(() => {
    if (agent?.backend === 'claude') return CLAUDE_MODE_OPTIONS;
    if (agent?.backend === 'codex') return CODEX_MODE_OPTIONS;
    return [];
  }, [agent?.backend]);

  const fallbackMode = agent?.backend === 'claude' ? 'default' : 'auto';
  const current = mode?.mode || fallbackMode;
  const currentOption = options.find((item) => item.id === current);
  const label = currentOption?.label ?? current;

  useEffect(() => {
    setError('');
    setOpen(false);
  }, [agent?.conversationId]);

  /** 提交权限模式切换请求，YOLO模式会先要求用户二次确认。 */
  async function submit(nextMode: string): Promise<void> {
    if (!agent || submitting || nextMode === current) {
      setOpen(false);
      return;
    }

    const option = options.find((item) => item.id === nextMode);
    if (option?.danger) {
      const confirmed = window.confirm(
        `确定要切换到「${option.label}」吗？该模式会放宽权限限制，建议只在隔离环境中使用。`
      );
      if (!confirmed) return;
    }

    try {
      setSubmitting(true);
      setError('');
      await onSetMode(nextMode);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="permission-mode-picker">
      <button
        type="button"
        className="tool-pill"
        disabled={!agent || options.length === 0}
        onClick={() => setOpen((value) => !value)}
      >
        权限：{label} ▼
      </button>

      {open && options.length > 0 ? (
        <div className="tool-popover permission-mode-popover">
          <label className="field">
            <span>权限模式</span>
            <select
              value={current}
              disabled={submitting}
              onChange={(event) => {
                void submit(event.target.value);
              }}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
              {!options.some((option) => option.id === current) ? (
                <option value={current}>{current}</option>
              ) : null}
            </select>
          </label>

          {currentOption?.description ? (
            <p className={currentOption.danger ? 'warning-text compact' : 'hint-text compact'}>
              {currentOption.description}
            </p>
          ) : null}

          {error ? <p className="error-text compact">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
