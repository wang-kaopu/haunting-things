import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { SettingsPanel } from '@renderer/features/settings/components/SettingsPanel';
import { PanelDialogShell } from '@renderer/shared/components/PanelDialogShell';

/** 设置弹窗的打开状态、服务信息和远程访问切换入口。 */
export type SettingsDialogProps = {
  open: boolean;
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

/** 设置弹窗，复用面板式弹窗骨架承载设置内容。 */
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
    <PanelDialogShell
      open={open}
      titleId="settings-title"
      title="设置"
      description="管理应用偏好、访问方式和运行环境。"
      closeLabel="关闭设置"
      onClose={onClose}
    >
      <SettingsPanel
        serverInfo={serverInfo}
        loading={loading}
        error={error}
        onSetRemoteAccess={onSetRemoteAccess}
      />
    </PanelDialogShell>
  );
}
