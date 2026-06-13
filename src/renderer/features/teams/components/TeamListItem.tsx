import type React from 'react';
import type { Team } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import { cn } from '@renderer/shared/lib/utils';

/** 单个团队条目的团队数据、选中态和操作回调。 */
export type TeamListItemProps = {
  team: Team;
  active: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
};

/** 新 风格侧边栏团队条目——和 Members 一样的一行式列表项。 */
export function TeamListItem({ team, active, onSelect, onDelete }: TeamListItemProps): React.ReactElement {
  void onDelete;

  return (
    <div className="grid h-8 grid-cols-[minmax(0,1fr)] items-center rounded-lg">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'h-8 min-w-0 justify-start gap-2 rounded-lg px-2 pl-12 text-left text-sm font-normal',
          active && 'bg-[#e7e7e7] hover:bg-[#e7e7e7]'
        )}
        title={team.name}
        onClick={onSelect}
      >
        <span className="min-w-0 flex-1 truncate text-[13px]">{team.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(team.updatedAt)}</span>
      </Button>
      {/*
        团队更多/删除入口暂时隐藏，避免侧边栏出现额外的重按钮视觉。
        后续重新设计团队管理入口时再恢复删除操作。
      */}
    </div>
  );
}

/** 将更新时间格式化为侧栏紧凑相对时间。 */
function formatRelativeTime(updatedAt: number): string {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} 分钟`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时`;
  return `${Math.floor(diffMs / day)} 天`;
}
