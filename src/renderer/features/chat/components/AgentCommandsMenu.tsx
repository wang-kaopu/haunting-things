import type React from 'react';
import type { ConversationCommands } from '@shared/types';
import { CustomSelect } from '@renderer/shared/components/CustomSelect';

/** Agent 命令下拉菜单的命令快照与选择回调。 */
export type AgentCommandsMenuProps = {
  commands?: ConversationCommands | null;
  disabled?: boolean;
  onSelectCommand: (commandName: string) => void;
};

/** 展示 Agent 上报的可用命令快照——使用自制下拉框。 */
export function AgentCommandsMenu({
  commands,
  disabled,
  onSelectCommand,
}: AgentCommandsMenuProps): React.ReactElement {
  const commandList = Array.isArray(commands?.commands) ? commands.commands : [];
  const count = commandList.length;

  /** 规范化命令名后交给发送框插入。 */
  function selectCommand(commandName: string): void {
    const normalized = commandName.trim();
    if (!normalized) return;
    onSelectCommand(normalized);
  }

  return (
    <div className="commands-menu">
      <CustomSelect
        compact
        className="command-select"
        ariaLabel="命令"
        value=""
        placeholder="命令"
        disabled={disabled || count === 0}
        options={commandList.map((command) => ({
          value: command.name,
          label: `/${command.name}`,
        }))}
        onChange={(nextValue) => {
          selectCommand(nextValue);
        }}
      />
    </div>
  );
}
