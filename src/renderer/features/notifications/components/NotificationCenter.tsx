import type React from 'react';
import type { AppNotification } from '../../../shared/types/ui';
import { ToastItem } from './ToastItem';

export type NotificationCenterProps = {
  items: AppNotification[];
  onRemove: (id: string) => void;
};

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
