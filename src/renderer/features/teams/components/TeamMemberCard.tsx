import type React from 'react';
import type { AgentTurnPhase, ConversationCommands, ConversationMode, TeamAgent } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import { cn } from '@renderer/shared/lib/utils';
import { getAgentIconAlt, getAgentIconSrc } from '@renderer/shared/utils/agentIcon';
import { formatAgentStatus, formatPhase } from '@renderer/shared/utils/format';

/** 团队成员卡片展示的 Agent 状态、运行时快照和选中回调。 */
export type TeamMemberCardProps = {
  agent: TeamAgent;
  active: boolean;
  phase?: AgentTurnPhase;
  commands?: ConversationCommands | null;
  mode?: ConversationMode | null;
  onSelect: () => void;
};

/** 渲染单个 Agent 卡片，合并展示状态、模型、命令数量和当前运行阶段。 */
export function TeamMemberCard({
  agent,
  active,
  phase,
  commands,
  mode,
  onSelect,
}: TeamMemberCardProps): React.ReactElement {
  const commandCount = Array.isArray(commands?.commands) ? commands.commands.length : 0;
  const runtimeLabel = getRuntimeLabel(phase, mode);

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'grid h-auto min-h-[76px] w-full grid-cols-[28px_minmax(0,1fr)] items-start gap-3 rounded-lg px-3 py-3 text-left font-normal',
        active && 'bg-[var(--sidebar-active)] hover:bg-[var(--sidebar-active)]'
      )}
      title={agent.name}
      onClick={onSelect}
    >
      <img
        className="mt-0.5 size-7 shrink-0 rounded object-contain"
        src={getAgentIconSrc(agent.backend)}
        alt={getAgentIconAlt(agent.backend)}
      />
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{agent.name}</span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', getStatusClassName(agent.status))}>
            {formatAgentStatus(agent.status)}
          </span>
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {agent.backend}
          {agent.model ? ` · ${agent.model}` : ' · 默认模型'}
          {commandCount > 0 ? ` · ${commandCount} 命令` : ''}
        </span>
        {runtimeLabel ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {runtimeLabel}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

/** 将 Agent 运行状态映射为轻量标签样式。 */
function getStatusClassName(status: TeamAgent['status']): string {
  if (status === 'active') return 'bg-green-100 text-green-700';
  if (status === 'failed') return 'bg-red-100 text-red-700';
  if (status === 'stopped') return 'bg-muted text-muted-foreground';
  return 'bg-muted text-muted-foreground';
}

/** 组合当前运行阶段和权限模式，避免卡片里出现多行条件拼接。 */
function getRuntimeLabel(phase?: AgentTurnPhase, mode?: ConversationMode | null): string {
  const phaseLabel = phase && phase !== 'done' ? formatPhase(phase) : '';
  const modeLabel = mode?.mode ? `模式 ${mode.mode}` : '';

  return [phaseLabel, modeLabel].filter(Boolean).join(' · ');
}
