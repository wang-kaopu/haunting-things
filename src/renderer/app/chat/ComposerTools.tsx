import type React from 'react';
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../shared/types';
import { AgentCommandsMenu } from './AgentCommandsMenu';
import { ModelPicker } from './ModelPicker';
import { UsageChip } from './UsageChip';

export type ComposerToolsProps = {
  activeAgent?: TeamAgent | null;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onSetModel: (model: string) => Promise<void>;
};

export function ComposerTools({
  activeAgent,
  usage,
  commands,
  models,
  mode,
  onSetModel,
}: ComposerToolsProps): React.ReactElement {
  return (
    <div className="composer-tools">
      <ModelPicker agent={activeAgent} models={models} onSetModel={onSetModel} />
      <UsageChip usage={usage} />
      <AgentCommandsMenu commands={commands} />
      {mode?.mode ? <span className="mode-chip">模式：{mode.mode}</span> : null}
    </div>
  );
}
