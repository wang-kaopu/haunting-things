import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { SettingsPanel } from '@renderer/features/settings/components/SettingsPanel';
import {
  Dialog,
  DialogContent,
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
  onLogout: () => void;
};

/** 设置弹窗，复用统一 Dialog 骨架承载偏好设置内容。 */
export function SettingsDialog({
  open,
  serverInfo,
  loading,
  error,
  onClose,
  onSetRemoteAccess,
  onLogout,
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
        </DialogHeader>
        <SettingsPanel
          serverInfo={serverInfo}
          loading={loading}
          error={error}
          onSetRemoteAccess={onSetRemoteAccess}
          onLogout={onLogout}
        />
      </DialogContent>
    </Dialog>
  );
}
