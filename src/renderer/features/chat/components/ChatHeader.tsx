import type React from 'react';
import type { AgentTurnPhase, ConversationUsage, Team, TeamAgent } from '../../../../shared/types';
import { formatPhase } from '../../../shared/utils/format';
import { UsageChip } from './UsageChip';

export type ChatHeaderProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  onAddAgentClick: () => void;
};

/** GPT 风格简化的顶部状态栏。 */
export function ChatHeader({
  team,
  activeAgent,
  activePhase,
  usage,
  onAddAgentClick,
}: ChatHeaderProps): React.ReactElement {
  return (
    <header className="chat-header">
      <div className="chat-header__title">
        <strong>{team?.name ?? '未选择团队'}</strong>
        {activeAgent ? <span>{activeAgent.name}</span> : <span>暂无 Agent</span>}
      </div>

      <div className="chat-header__status">
        <UsageChip usage={usage} />
        {activePhase ? <span className={`phase-badge ${activePhase}`}>{formatPhase(activePhase)}</span> : null}
      </div>

      <div className="chat-header__actions">
        <button type="button" onClick={onAddAgentClick} disabled={!team}>
          ＋ 添加 Agent
        </button>
      </div>
    </header>
  );
}
