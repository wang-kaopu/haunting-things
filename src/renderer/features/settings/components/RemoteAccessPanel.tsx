import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { RemoteAccessSetting } from '@renderer/features/settings/components/RemoteAccessSetting';

/** 远程访问设置面板输入。 */
export type RemoteAccessPanelProps = {
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

/**
 * 新 风格远程访问设置面板。
 *
 * 切换后服务会短暂重启监听地址，面板保留当前状态并提示用户等待自动重连。
 */
export function RemoteAccessPanel({
  serverInfo,
  loading,
  error,
  onSetRemoteAccess,
}: RemoteAccessPanelProps): React.ReactElement {
  return (
    <section className="grid gap-4">
      <RemoteAccessSetting
        serverInfo={serverInfo}
        loading={loading}
        error={error}
        onSetRemoteAccess={onSetRemoteAccess}
      />
    </section>
  );
}
