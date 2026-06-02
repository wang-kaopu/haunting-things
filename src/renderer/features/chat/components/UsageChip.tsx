import type React from 'react';
import type { ConversationUsage } from '../../../../shared/types';
import { formatUsagePercent, formatUsageShort } from '../../../shared/utils/format';

export type UsageChipProps = {
  usage?: ConversationUsage | null;
};

/** 以紧凑徽标展示上下文用量，避免占用聊天头部过多空间。 */
export function UsageChip({ usage }: UsageChipProps): React.ReactElement | null {
  if (!usage) return null;

  return (
    <span className="usage-chip" title={`Updated at ${new Date(usage.updatedAt).toLocaleTimeString()}`}>
      {formatUsageShort(usage)} · {formatUsagePercent(usage)}
    </span>
  );
}
