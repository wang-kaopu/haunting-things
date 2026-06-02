import type React from 'react';
import type { AgentTurnPhase, ConversationUsage, Team, TeamAgent } from '../../../../shared/types';
import { formatPhase } from '../../../shared/utils/format';
import { UsageChip } from './UsageChip';

export type ChatHeaderProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  onOpenSidebar?: () => void;
};

/** GPT 风格简化的顶部状态栏——移动端左侧显示 SVG 菜单图标按钮。 */
export function ChatHeader({
  team,
  activeAgent,
  activePhase,
  usage,
  onOpenSidebar,
}: ChatHeaderProps): React.ReactElement {
  return (
    <header className="chat-header">
      <div className="chat-header-main">
        {onOpenSidebar ? (
          <button
            type="button"
            className="mobile-sidebar-trigger"
            aria-label="打开侧边栏"
            title="打开侧边栏"
            onClick={onOpenSidebar}
          >
            <MenuIcon />
          </button>
        ) : null}
        <div className="chat-header__title">
          <strong>{team?.name ?? '未选择团队'}</strong>
          {activeAgent ? <span>{activeAgent.name}</span> : <span>暂无 Agent</span>}
        </div>
      </div>

      <div className="chat-header__status">
        <UsageChip usage={usage} />
        {activePhase ? <span className={`phase-badge ${activePhase}`}>{formatPhase(activePhase)}</span> : null}
      </div>
    </header>
  );
}

/** 三横线菜单图标（hamburger menu）。 */
function MenuIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
