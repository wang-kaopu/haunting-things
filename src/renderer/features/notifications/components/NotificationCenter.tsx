import { useEffect, useRef } from 'react';
import type React from 'react';
import { toast } from 'sonner';
import { Toaster } from '@renderer/shared/components/ui/sonner';
import type { AppNotification, AppNotificationLevel } from '@renderer/shared/types/ui';

/** Toast 通知中心输入。 */
export type NotificationCenterProps = {
  items: AppNotification[];
  onRemove: (id: string) => void;
};

const TOAST_LEVEL_MAP: Record<AppNotificationLevel, typeof toast.info> = {
  info: toast.info,
  success: toast.success,
  warning: toast.warning,
  error: toast.error,
};

/**
 * 同步应用通知队列到 sonner，并渲染全局 toast 容器。
 */
export function NotificationCenter({ items, onRemove }: NotificationCenterProps): React.ReactElement {
  const activeToastIds = useRef(new Set<string>());

  useEffect(() => {
    const nextIds = new Set(items.map((item) => item.id));

    for (const id of activeToastIds.current) {
      if (!nextIds.has(id)) {
        toast.dismiss(id);
        activeToastIds.current.delete(id);
      }
    }

    for (const item of items) {
      if (activeToastIds.current.has(item.id)) continue;

      const showToast = TOAST_LEVEL_MAP[item.level] ?? toast.info;
      activeToastIds.current.add(item.id);
      showToast(item.title, {
        id: item.id,
        description: item.message,
        duration: Math.max(1000, item.expiresAt - Date.now()),
        closeButton: true,
        onDismiss: () => onRemove(item.id),
        onAutoClose: () => onRemove(item.id),
      });
    }
  }, [items, onRemove]);

  return <Toaster position="top-right" richColors visibleToasts={6} />;
}
