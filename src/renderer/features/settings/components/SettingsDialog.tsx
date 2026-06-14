import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { SettingsPanel } from '@renderer/features/settings/components/SettingsPanel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/shared/components/ui/dialog';

/** 设置弹窗的打开状态、服务信息和远程访问切换入口。 */
export type SettingsDialogProps = {
  open: boolean;
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

/** 设置弹窗，复用统一 Dialog 骨架承载偏好设置内容。 */
export function SettingsDialog({
  open,
  serverInfo,
  loading,
  error,
  onClose,
  onSetRemoteAccess,
}: SettingsDialogProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))] rounded-xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>管理应用偏好、访问方式和运行环境。</DialogDescription>
        </DialogHeader>
        <SettingsPanel
          serverInfo={serverInfo}
          loading={loading}
          error={error}
          onSetRemoteAccess={onSetRemoteAccess}
        />
      </DialogContent>
    </Dialog>
  );
}
