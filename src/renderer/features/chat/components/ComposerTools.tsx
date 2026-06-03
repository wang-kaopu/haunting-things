import type React from 'react';
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  TeamAgent,
} from '../../../../shared/types';
import { AgentCommandsMenu } from './AgentCommandsMenu';
import { ModelPicker } from './ModelPicker';
import { PermissionModePicker } from './PermissionModePicker';

/** Composer 工具栏展示所需的运行时状态。 */
export type ComposerToolsProps = {
  activeAgent?: TeamAgent | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  imagePicker?: React.ReactNode;
  disabled?: boolean;
  onSelectCommand: (commandName: string) => void;
  onSetModel: (model: string) => Promise<void>;
  onSetMode: (mode: string) => Promise<void>;
};

/**
 * 消息输入框工具栏——顺序接近 新 网页版。
 *
 * 左侧：附件图标 → 模型 → 权限 → 命令
 * 右侧：发送按钮（由 SendBox 管理）
 */
export function ComposerTools({
  activeAgent,
  commands,
  models,
  mode,
  imagePicker,
  disabled,
  onSelectCommand,
  onSetModel,
  onSetMode,
}: ComposerToolsProps): React.ReactElement {
  return (
    <div className="composer-tools">
      {imagePicker}
      <ModelPicker agent={activeAgent} models={models} onSetModel={onSetModel} />
      <PermissionModePicker agent={activeAgent} mode={mode} onSetMode={onSetMode} />
      <AgentCommandsMenu commands={commands} disabled={disabled} onSelectCommand={onSelectCommand} />
    </div>
  );
}
