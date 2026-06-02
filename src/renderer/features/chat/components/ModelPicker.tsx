import { useEffect, useState } from 'react';
import type React from 'react';
import type { ConversationModels, TeamAgent } from '../../../../shared/types';

export type ModelPickerProps = {
  agent?: TeamAgent | null;
  models?: ConversationModels | null;
  onSetModel: (model: string) => Promise<void>;
};

/** 展示当前 Agent 的模型选择器，并把运行时模型切换提交给后端。 */
export function ModelPicker({ agent, models, onSetModel }: ModelPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const options = Array.isArray(models?.models) ? models.models : [];
  const current = agent?.model ?? models?.currentModelId ?? '';
  const hasOptions = options.length > 0;
  const currentLabel = current
    ? options.find((model) => model.id === current)?.name || current
    : '默认模型';

  useEffect(() => {
    setError('');
  }, [agent?.conversationId, current]);

  /** 提交模型切换请求，并在成功后关闭弹层减少重复操作。 */
  async function submit(model: string): Promise<void> {
    const nextModel = model.trim();
    if (!nextModel || submitting) return;
    try {
      setSubmitting(true);
      setError('');
      await onSetModel(nextModel);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="model-picker">
      <button type="button" className="tool-pill" disabled={!agent || !hasOptions} onClick={() => setOpen((value) => !value)}>
        {hasOptions ? `模型：${currentLabel} ▼` : '默认模型'}
      </button>
      {open && hasOptions ? (
        <div className="tool-popover model-popover">
          <label className="field">
            <span>模型</span>
            <select
              value={current}
              disabled={submitting}
              onChange={(event) => {
                void submit(event.target.value);
              }}
            >
              {!current ? <option value="">默认模型</option> : null}
              {current && !options.some((model) => model.id === current) ? <option value={current}>{current}</option> : null}
              {options.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="error-text compact">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
