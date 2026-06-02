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

/** 渲染当前团队和 Agent 的顶部状态栏，集中展示模型、用量和运行阶段。 */
export function ChatHeader({
  team,
  activeAgent,
  activePhase,
  usage,
  onAddAgentClick,
}: ChatHeaderProps): React.ReactElement {
  return (
    <header className="chat-header">
      <div className="chat-title">
        <h2>{team?.name ?? '未选择团队'}</h2>
        <p className="muted">
          {activeAgent ? `${activeAgent.name} · ${activeAgent.backend}${activeAgent.model ? ` · ${activeAgent.model}` : ''}` : '暂无 Agent'}
        </p>
        <div className="status-row">
          <UsageChip usage={usage} />
          {activePhase ? <span className={`phase-badge ${activePhase}`}>{formatPhase(activePhase)}</span> : null}
        </div>
      </div>
      <button type="button" onClick={onAddAgentClick} disabled={!team}>
        添加 Agent
      </button>
    </header>
  );
}
