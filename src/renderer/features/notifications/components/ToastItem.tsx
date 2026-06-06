import type React from 'react';
import type { AppNotification } from '@renderer/shared/types/ui';

/** 单条通知项的内容和关闭回调。 */
export type ToastItemProps = {
  item: AppNotification;
  onClose: () => void;
};

/** 渲染单条全局通知，提供手动关闭入口避免错误提示长期占用界面。 */
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
