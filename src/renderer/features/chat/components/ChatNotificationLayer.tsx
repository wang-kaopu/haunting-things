import type { ReactElement } from 'react';
import { AlertCircleIcon, CheckCircleIcon, InfoIcon, XIcon } from 'lucide-react';
import type { AppNotificationLevel, ChatNotification } from '@renderer/shared/types/ui';
import { Button } from '@renderer/shared/components/ui/button';

const MAX_VISIBLE_CHAT_NOTIFICATIONS = 2;

/** 对话区域右上角的局部通知层，用于承载后台 Agent 和 Team 消息提醒。 */
export type ChatNotificationLayerProps = {
  items: ChatNotification[];
  onDismiss: (id: string) => void;
  onOpenTarget?: (item: ChatNotification) => void;
};

/**
 * 在 Chat 面板内展示轻量通知，避免全局 toast 遮挡页面右上角控件。
 *
 * @param props - 通知列表、关闭回调和可选跳转回调
 * @returns Chat 局部通知层
 */
export function ChatNotificationLayer({
  items,
  onDismiss,
  onOpenTarget,
}: ChatNotificationLayerProps): ReactElement | null {
  if (items.length === 0) return null;

  const visible = items.slice(-MAX_VISIBLE_CHAT_NOTIFICATIONS).reverse();
  const hiddenCount = Math.max(0, items.length - visible.length);

  return (
    <div className="pointer-events-none absolute right-4 top-16 z-30 flex w-[min(360px,calc(100%-32px))] flex-col gap-2 max-[640px]:left-4 max-[640px]:right-4 max-[640px]:w-auto">
      {visible.map((item) => (
        <ChatNotificationCard
          key={item.id}
          item={item}
          onDismiss={onDismiss}
          onOpenTarget={onOpenTarget}
        />
      ))}
      {hiddenCount > 0 ? (
        <div className="pointer-events-auto self-end rounded-lg border border-border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow-[0_10px_32px_rgba(15,23,42,0.12)]">
          还有 {hiddenCount} 条新通知
        </div>
      ) : null}
    </div>
  );
}

/**
 * 渲染单条 Chat 局部通知。
 *
 * @param props - 通知内容、关闭回调和可选跳转回调
 * @returns 通知卡片
 */
function ChatNotificationCard({
  item,
  onDismiss,
  onOpenTarget,
}: {
  item: ChatNotification;
  onDismiss: (id: string) => void;
  onOpenTarget?: (item: ChatNotification) => void;
}): ReactElement {
  const Icon = iconForLevel(item.level);
  const tone = toneForLevel(item.level);
  const canOpen = Boolean(onOpenTarget && (item.teamId || item.slotId || item.conversationId));

  return (
    <div
      className={`pointer-events-auto grid grid-cols-[20px_minmax(0,1fr)_28px] gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-[0_16px_48px_rgba(15,23,42,0.16)] ${tone}`}
      role="status"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4" />
      <button
        type="button"
        className="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left disabled:cursor-default"
        disabled={!canOpen}
        onClick={() => onOpenTarget?.(item)}
      >
        <div className="truncate text-sm font-semibold leading-5">{item.title}</div>
        <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">{item.message}</div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 rounded-full"
        aria-label="关闭通知"
        title="关闭通知"
        onClick={() => onDismiss(item.id)}
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * 根据通知等级选择图标。
 *
 * @param level - 通知等级
 * @returns 对应 lucide 图标组件
 */
function iconForLevel(level: AppNotificationLevel): typeof InfoIcon {
  if (level === 'success') return CheckCircleIcon;
  if (level === 'warning' || level === 'error') return AlertCircleIcon;
  return InfoIcon;
}

/**
 * 根据通知等级选择边框和图标颜色。
 *
 * @param level - 通知等级
 * @returns Tailwind className 片段
 */
function toneForLevel(level: AppNotificationLevel): string {
  if (level === 'success') return 'border-emerald-200 text-emerald-700';
  if (level === 'warning') return 'border-amber-200 text-amber-700';
  if (level === 'error') return 'border-red-200 text-red-700';
  return 'border-sky-200 text-sky-700';
}
