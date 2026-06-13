import type React from 'react';
import type { ServerInfo } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import { cn } from '@renderer/shared/lib/utils';

/** 远程访问设置项需要的服务状态和切换回调。 */
export type RemoteAccessSettingProps = {
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

/** 远程访问设置项——设置面板中的一条。 */
export function RemoteAccessSetting({
  serverInfo,
  loading,
  error,
  onSetRemoteAccess,
}: RemoteAccessSettingProps): React.ReactElement {
  const urls = Array.isArray(serverInfo?.urls) ? serverInfo.urls : [];
  const allowRemote = serverInfo?.allowRemote ?? false;
  const switching = loading || serverInfo?.restarting;

  return (
    <div className="grid gap-3 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="grid min-w-0 gap-1">
          <strong className="text-sm font-medium text-foreground">远程访问</strong>
          <span className="text-xs leading-5 text-muted-foreground">
            允许同一网络或 Tailscale 设备访问当前服务。
          </span>
        </div>

        <label className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-muted transition-colors has-[:checked]:bg-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50" aria-label="远程访问">
          <input
            className="peer sr-only"
            type="checkbox"
            checked={allowRemote}
            disabled={!serverInfo || switching}
            onChange={(event) =>
              void onSetRemoteAccess(event.currentTarget.checked)
            }
          />
          <span aria-hidden="true" className="ml-1 size-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
        </label>
      </div>

      {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      {!serverInfo ? (
        <p className="text-xs leading-5 text-muted-foreground">正在读取服务信息...</p>
      ) : null}

      {serverInfo?.restarting ? (
        <p className="text-xs leading-5 text-muted-foreground">正在切换监听地址...</p>
      ) : null}

      {serverInfo && allowRemote && urls.length > 0 ? (
        <div className="grid gap-2">
          <div className="grid gap-2">
            {urls.map((url) => (
              <RemoteUrlRow key={url} url={url} />
            ))}
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            在其他设备浏览器中打开以上地址，然后使用当前账号密码登录。
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            切换远程访问会短暂重启 HTTP/WebSocket 监听，页面会自动重连。
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** 展示一个远程访问地址，并提供复制入口。 */
function RemoteUrlRow({ url }: { url: string }): React.ReactElement {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-muted p-3">
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{formatRemoteUrlLabel(url)}</span>
        <code className="mt-1 block break-all text-xs text-foreground">{url}</code>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={cn('h-8 px-3')}
        onClick={() => void navigator.clipboard.writeText(url)}
      >
        复制
      </Button>
    </div>
  );
}

/** 根据地址主机名判断远程地址来源标签。 */
function formatRemoteUrlLabel(url: string): string {
  try {
    const { hostname } = new URL(url);

    if (isTailscaleIp(hostname)) {
      return 'Tailscale';
    }

    return '局域网';
  } catch {
    return '访问地址';
  }
}

/** 判断 IPv4 地址是否位于 Tailscale CGNAT 网段。 */
function isTailscaleIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}
