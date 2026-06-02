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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const options = Array.isArray(models?.models) ? models.models : [];
  const current = agent?.model ?? models?.currentModelId ?? '';
  const hasOptions = options.length > 0;
  const selectedValue = hasOptions ? current : '';

  useEffect(() => {
    setError('');
  }, [agent?.conversationId, current]);

  /** 提交模型切换请求，并在切换期间禁用选择器避免重复操作。 */
  async function submit(model: string): Promise<void> {
    const nextModel = model.trim();
    if (!nextModel || submitting || nextModel === current) return;
    try {
      setSubmitting(true);
      setError('');
      await onSetModel(nextModel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="model-picker">
      <label className="toolbar-select-label">
        <span>模型</span>
        <select
          className="toolbar-select model-select"
          value={selectedValue}
          disabled={!agent || !hasOptions || submitting}
          onChange={(event) => {
            void submit(event.target.value);
          }}
        >
          {!current || !hasOptions ? <option value="">默认模型</option> : null}
          {current && !options.some((model) => model.id === current) ? <option value={current}>{current}</option> : null}
          {options.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name || model.id}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="error-text compact toolbar-select-error">{error}</p> : null}
    </div>
  );
}
