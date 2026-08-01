import type React from 'react';
import type { ConversationUsage } from '@shared/types';
import { formatUsagePercent, formatUsageShort } from '@renderer/shared/utils/format';

/** 上下文用量徽标接收的用量快照。 */
export type UsageChipProps = {
  usage?: ConversationUsage | null;
};

/** 以紧凑徽标展示上下文用量，避免占用聊天头部过多空间。 */
export function UsageChip({ usage }: UsageChipProps): React.ReactElement | null {
  if (!usage) return null;

  return (
    <span
      className="inline-flex whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700"
      title={`Updated at ${new Date(usage.updatedAt).toLocaleTimeString()}`}
    >
      {formatUsageShort(usage)} · {formatUsagePercent(usage)}
    </span>
  );
}
