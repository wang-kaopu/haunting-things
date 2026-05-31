import { useState } from 'react';
import type React from 'react';
import type { ConversationCommands } from '../../../shared/types';

export type AgentCommandsMenuProps = {
  commands?: ConversationCommands | null;
};

export function AgentCommandsMenu({ commands }: AgentCommandsMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const count = commands?.commands.length ?? 0;

  return (
    <div className="commands-menu">
      <button type="button" className="tool-pill" onClick={() => setOpen((value) => !value)}>
        命令 {count}
      </button>
      {open ? (
        <div className="tool-popover commands-popover">
          {count === 0 ? (
            <p className="muted">暂无命令快照。</p>
          ) : (
            commands?.commands.map((command) => (
              <details key={command.name} className="command-mini">
                <summary>
                  <code>{command.name}</code>
                  {command.description ? <span>{command.description}</span> : null}
                </summary>
                {command.input != null ? <pre>{JSON.stringify(command.input, null, 2)}</pre> : <p className="muted">暂无输入 schema。</p>}
              </details>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
