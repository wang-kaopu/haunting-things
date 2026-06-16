import type React from 'react';
import { LogOutIcon } from 'lucide-react';
import type { ServerInfo } from '@shared/types';
import { RemoteAccessSetting } from '@renderer/features/settings/components/RemoteAccessSetting';
import { Button } from '@renderer/shared/components/ui/button';

/** 设置面板聚合展示的服务信息与偏好设置回调。 */
export type SettingsPanelProps = {
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
  onLogout: () => void;
};

/** 设置面板内容，按分组承载各设置项。 */
export function SettingsPanel({
  serverInfo,
  loading,
  error,
  onSetRemoteAccess,
  onLogout,
}: SettingsPanelProps): React.ReactElement {
  return (
    <div className="grid min-h-0 gap-6 overflow-y-auto px-6 py-5">
      <section className="grid gap-4">
        <h3 className="text-xs font-medium text-muted-foreground">通用</h3>
        <RemoteAccessSetting
          serverInfo={serverInfo}
          loading={loading}
          error={error}
          onSetRemoteAccess={onSetRemoteAccess}
        />
      </section>
      <section className="grid gap-4 border-t border-border pt-5">
        <h3 className="text-xs font-medium text-muted-foreground">账户</h3>
        <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="grid min-w-0 gap-1">
            <strong className="text-sm font-medium text-foreground">退出登录</strong>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="size-8"
            aria-label="退出登录"
            title="退出登录"
            onClick={onLogout}
          >
            <LogOutIcon aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
