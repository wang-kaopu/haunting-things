import type React from 'react';
import type { AppNotification } from '../../../shared/types/ui';

export type ToastItemProps = {
  item: AppNotification;
  onClose: () => void;
};

export function ToastItem({ item, onClose }: ToastItemProps): React.ReactElement {
  return (
    <article className={`toast ${item.level}`}>
      <div>
        <strong>{item.title}</strong>
        <p>{item.message}</p>
      </div>
      <button type="button" className="toast-close" aria-label="关闭通知" onClick={onClose}>
        ×
      </button>
    </article>
  );
}
