import type React from 'react';
import type { AppNotification } from '@renderer/shared/types/ui';
import { ToastItem } from '@renderer/features/notifications/components/ToastItem';

/** Toast 通知中心输入。 */
export type NotificationCenterProps = {
  items: AppNotification[];
  onRemove: (id: string) => void;
};

/**
 * 渲染全局 toast 通知队列。
 */
export function NotificationCenter({ items, onRemove }: NotificationCenterProps): React.ReactElement | null {
  if (items.length === 0) return null;

  return (
    <section className="notification-center" aria-live="polite">
      {items.map((item) => (
        <ToastItem key={item.id} item={item} onClose={() => onRemove(item.id)} />
      ))}
    </section>
  );
}
