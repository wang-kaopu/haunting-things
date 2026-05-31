import type React from 'react';
import type { ConversationUsage } from '../../../shared/types';
import { formatUsagePercent, formatUsageShort } from '../utils/format';

export type UsageChipProps = {
  usage?: ConversationUsage | null;
};

export function UsageChip({ usage }: UsageChipProps): React.ReactElement | null {
  if (!usage) return null;

  return (
    <span className="usage-chip" title={`Updated at ${new Date(usage.updatedAt).toLocaleTimeString()}`}>
      {formatUsageShort(usage)} · {formatUsagePercent(usage)}
    </span>
  );
}
