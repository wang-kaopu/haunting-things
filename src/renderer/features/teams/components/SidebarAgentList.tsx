import type React from 'react';
import type { AgentTurnPhase, TeamAgent } from '../../../../shared/types';
import { getAgentIconAlt, getAgentIconSrc } from '../../../shared/utils/agentIcon';

export type SidebarAgentListProps = {
  agents: TeamAgent[];
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  onSelectAgent: (slotId: string) => void;
};

/**
 * 侧边栏紧凑成员状态列表。
 *
 * 每行仅显示红绿灯 + 后端图标 + 成员名字，
 * 不展示 backend、model、命令数、phase 文本等冗余信息。
 */
export function SidebarAgentList({
  agents,
  activeSlotId,
  phases = {},
  onSelectAgent,
}: SidebarAgentListProps): React.ReactElement {
  if (agents.length === 0) {
    return <p className="sidebar-empty">暂无成员</p>;
  }

  return (
    <div className="sidebar-agent-list">
      {agents.map((agent) => {
        const phase = phases[agent.conversationId];
        const busy =
          agent.status === 'active' || Boolean(phase && phase !== 'done');

        return (
          <button
            key={agent.slotId}
            type="button"
            className={`sidebar-agent-item${agent.slotId === activeSlotId ? ' selected' : ''}`}
            title={agent.name}
            onClick={() => onSelectAgent(agent.slotId)}
          >
            <span
              className={`sidebar-agent-status ${busy ? 'busy' : 'idle'}`}
              aria-label={busy ? '忙碌中' : '空闲'}
            />
            <img
              className="sidebar-agent-icon"
              src={getAgentIconSrc(agent.backend)}
              alt={getAgentIconAlt(agent.backend)}
            />
            <span className="sidebar-agent-name">{agent.name}</span>
          </button>
        );
      })}
    </div>
  );
}
