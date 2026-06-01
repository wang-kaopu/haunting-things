import { useEffect, useState } from 'react';
import type React from 'react';
import type { ConversationModels, TeamAgent } from '../../../../shared/types';

export type ModelPickerProps = {
  agent?: TeamAgent | null;
  models?: ConversationModels | null;
  onSetModel: (model: string) => Promise<void>;
};

export function ModelPicker({ agent, models, onSetModel }: ModelPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const options = Array.isArray(models?.models) ? models.models : [];
  const current = agent?.model ?? models?.currentModelId ?? '';

  useEffect(() => {
    setError('');
  }, [agent?.conversationId, current]);

  async function submit(model: string): Promise<void> {
    const nextModel = model.trim();
    if (!nextModel || submitting) return;
    try {
      setSubmitting(true);
      setError('');
      await onSetModel(nextModel);
      setCustomModel('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="model-picker">
      <button type="button" className="tool-pill" disabled={!agent} onClick={() => setOpen((value) => !value)}>
        模型：{current || '手动输入'} ▼
      </button>
      {open ? (
        <div className="tool-popover model-popover">
          {options.length > 0 ? (
            <label className="field">
              <span>模型</span>
              <select
                value={current}
                disabled={submitting}
                onChange={(event) => {
                  void submit(event.target.value);
                }}
              >
                {!current ? <option value="">默认</option> : null}
                {current && !options.some((model) => model.id === current) ? <option value={current}>{current}</option> : null}
                {options.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name || model.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>手动模型 ID</span>
            <div className="inline-form horizontal">
              <input
                value={customModel}
                placeholder={current || '输入模型 ID'}
                disabled={submitting}
                onChange={(event) => setCustomModel(event.target.value)}
              />
              <button type="button" disabled={submitting || !customModel.trim()} onClick={() => void submit(customModel)}>
                应用
              </button>
            </div>
          </label>
          {error ? <p className="error-text compact">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
