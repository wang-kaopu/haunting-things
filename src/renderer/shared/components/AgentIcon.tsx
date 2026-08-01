import type React from 'react';
import { BotIcon } from 'lucide-react';
import type { AgentBackend } from '@shared/types';
import claudeIcon from '@renderer/assets/icons/agents/claude.svg';
import codexIcon from '@renderer/assets/icons/agents/openai.svg';
import { cn } from '@renderer/shared/lib/utils';

const agentIconMap: Record<AgentBackend, { src: string; alt: string }> = {
  claude: { src: claudeIcon, alt: 'Claude' },
  codex: { src: codexIcon, alt: 'Codex' },
};

export type AgentIconProps = {
  backend?: AgentBackend;
  className?: string;
  title?: string;
};

/** 品牌 Agent 使用品牌图标；默认 Agent 使用 Lucide 图标。 */
export function AgentIcon({ backend, className, title }: AgentIconProps): React.ReactElement {
  const brandIcon = backend ? agentIconMap[backend] : undefined;

  if (brandIcon) {
    return <img className={className} src={brandIcon.src} alt={brandIcon.alt} title={title ?? brandIcon.alt} />;
  }

  return <BotIcon className={cn(className, 'scale-[0.875]')} role="img" aria-label="Assistant" />;
}
