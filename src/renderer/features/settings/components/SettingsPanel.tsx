import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { RemoteAccessSetting } from '@renderer/features/settings/components/RemoteAccessSetting';

export type SettingsPanelProps = {
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

/** 设置面板内容——"通用"分组下挂载各设置项。 */
export function SettingsPanel({
  serverInfo,
  loading,
  error,
  onSetRemoteAccess,
}: SettingsPanelProps): React.ReactElement {
  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3>通用</h3>

        <RemoteAccessSetting
          serverInfo={serverInfo}
          loading={loading}
          error={error}
          onSetRemoteAccess={onSetRemoteAccess}
        />
      </section>
    </div>
  );
}
