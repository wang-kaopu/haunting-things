import { useEffect, useState } from 'react';
import type React from 'react';
import type { ConversationModels, TeamAgent } from '@shared/types';
import { CustomSelect } from '@renderer/shared/components/CustomSelect';

/** Agent 模型选择器需要的模型快照与设置回调。 */
export type ModelPickerProps = {
  agent?: TeamAgent | null;
  models?: ConversationModels | null;
  onSetModel: (model: string) => Promise<void>;
};

/** 展示当前 Agent 的模型选择器——使用自制下拉框替代原生 select。 */
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

  /** 提交新的模型选择，并避免重复提交当前模型。 */
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
      <CustomSelect
        compact
        className="model-select"
        ariaLabel="模型"
        value={selectedValue}
        placeholder="默认模型"
        disabled={!agent || !hasOptions || submitting}
        options={[
          ...(!current || !hasOptions
            ? [{ value: '', label: '默认模型', disabled: true }]
            : []),
          ...(current && !options.some((model) => model.id === current)
            ? [{ value: current, label: current }]
            : []),
          ...options.map((model) => ({
            value: model.id,
            label: model.name || model.id,
          })),
        ]}
        onChange={(nextValue) => {
          void submit(nextValue);
        }}
      />
      {error ? <p className="error-text compact toolbar-select-error">{error}</p> : null}
    </div>
  );
}
