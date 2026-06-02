import type React from 'react';
import type { ConversationCommands } from '../../../../shared/types';

export type AgentCommandsMenuProps = {
  commands?: ConversationCommands | null;
  disabled?: boolean;
  onSelectCommand: (commandName: string) => void;
};

/** 展示 Agent 上报的可用命令快照，并将选中的命令插入消息输入框。 */
export function AgentCommandsMenu({
  commands,
  disabled,
  onSelectCommand,
}: AgentCommandsMenuProps): React.ReactElement {
  const commandList = Array.isArray(commands?.commands) ? commands.commands : [];
  const count = commandList.length;

  /** 处理一次命令选择；选择器保持占位值，方便连续插入同一个命令。 */
  function selectCommand(commandName: string): void {
    const normalized = commandName.trim();
    if (!normalized) return;
    onSelectCommand(normalized);
  }

  return (
    <div className="commands-menu">
      <label className="toolbar-select-label">
        <span></span>
        <select
          className="toolbar-select command-select"
          value=""
          disabled={disabled || count === 0}
          title={count > 0 ? '可用命令' : '暂无命令快照'}
          onChange={(event) => {
            selectCommand(event.target.value);
          }}
        >
          <option value="" disabled hidden>
            命令
          </option>
          {commandList.map((command) => (
            <option key={command.name} value={command.name}>
              {command.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
