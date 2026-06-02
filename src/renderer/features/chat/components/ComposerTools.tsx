import type React from 'react';
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../../shared/types';
import { AgentCommandsMenu } from './AgentCommandsMenu';
import { ModelPicker } from './ModelPicker';
import { PermissionModePicker } from './PermissionModePicker';
import { UsageChip } from './UsageChip';

/** Composer 工具栏展示所需的运行时状态。 */
export type ComposerToolsProps = {
  activeAgent?: TeamAgent | null;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  imagePicker?: React.ReactNode;
  onSetModel: (model: string) => Promise<void>;
  onSetMode: (mode: string) => Promise<void>;
};

/**
 * 消息输入框的工具栏。
 *
 * 模型、图片、usage、命令和模式状态放在同一行，方便发送前调整运行时上下文。
 */
export function ComposerTools({
  activeAgent,
  usage,
  commands,
  models,
  mode,
  imagePicker,
  onSetModel,
  onSetMode,
}: ComposerToolsProps): React.ReactElement {
  return (
    <div className="composer-tools">
      <ModelPicker agent={activeAgent} models={models} onSetModel={onSetModel} />
      <PermissionModePicker agent={activeAgent} mode={mode} onSetMode={onSetMode} />
      {imagePicker}
      <UsageChip usage={usage} />
      <AgentCommandsMenu commands={commands} />
    </div>
  );
}
