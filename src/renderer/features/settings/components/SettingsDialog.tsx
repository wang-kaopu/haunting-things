import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { SettingsPanel } from '@renderer/features/settings/components/SettingsPanel';

export type SettingsDialogProps = {
  open: boolean;
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

/** 设置弹窗——遮罩 + 新 风格容器 + 头部 + 内容。 */
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
    <div className="settings-overlay" role="presentation">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-dialog-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p>管理应用偏好、访问方式和运行环境。</p>
          </div>

          <button
            type="button"
            className="settings-close-button"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <SettingsPanel
          serverInfo={serverInfo}
          loading={loading}
          error={error}
          onSetRemoteAccess={onSetRemoteAccess}
        />
      </section>
    </div>
  );
}
