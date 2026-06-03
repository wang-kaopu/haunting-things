import type { AgentBackend } from '@shared/types';

import claudeIcon from '@renderer/assets/icons/agents/claude.svg';
import codexIcon from '@renderer/assets/icons/agents/openai.svg';
import defaultIcon from '@renderer/assets/icons/agents/default.svg';

const agentIconMap: Record<AgentBackend, string> = {
  claude: claudeIcon,
  codex: codexIcon,
};

/** 根据 Agent 后端类型获取对应图标路径。 */
export function getAgentIconSrc(backend?: AgentBackend): string {
  return backend ? (agentIconMap[backend] ?? defaultIcon) : defaultIcon;
}

/** 根据 Agent 后端类型获取图标 alt 文本。 */
export function getAgentIconAlt(backend?: AgentBackend): string {
  if (backend === 'claude') return 'Claude';
  if (backend === 'codex') return 'Codex';
  return 'Assistant';
}
