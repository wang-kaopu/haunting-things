import type React from 'react';
import type { AgentTurnPhase, ConversationCommands, ConversationMode, TeamAgent } from '../../../shared/types';
import { formatAgentStatus, formatPhase } from '../utils/format';

export type TeamMemberCardProps = {
  agent: TeamAgent;
  active: boolean;
  phase?: AgentTurnPhase;
  commands?: ConversationCommands | null;
  mode?: ConversationMode | null;
  onSelect: () => void;
};

export function TeamMemberCard({
  agent,
  active,
  phase,
  commands,
  mode,
  onSelect,
}: TeamMemberCardProps): React.ReactElement {
  const commandCount = commands?.commands.length ?? 0;

  return (
    <button type="button" className={`member-card${active ? ' selected' : ''}`} onClick={onSelect}>
      <span className="member-card-row">
        <span className="agent-name">{agent.name}</span>
        <span className={`agent-badge ${agent.status}`}>{formatAgentStatus(agent.status)}</span>
      </span>
      <span className="member-card-meta">
        {agent.backend}
        {agent.model ? ` · ${agent.model}` : ' · 默认模型'}
        {commandCount > 0 ? ` · ${commandCount} 命令` : ''}
      </span>
      {(phase && phase !== 'done') || mode?.mode ? (
        <span className="member-card-meta">
          {phase && phase !== 'done' ? formatPhase(phase) : ''}
          {phase && phase !== 'done' && mode?.mode ? ' · ' : ''}
          {mode?.mode ? `模式 ${mode.mode}` : ''}
        </span>
      ) : null}
    </button>
  );
}
