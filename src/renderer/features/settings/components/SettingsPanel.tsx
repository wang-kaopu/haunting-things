import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { RemoteAccessSetting } from '@renderer/features/settings/components/RemoteAccessSetting';

/** 设置面板聚合展示的服务信息与偏好设置回调。 */
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
    <div className="min-h-0 overflow-y-auto px-6 py-5">
      <section className="grid gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">通用</h3>
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
