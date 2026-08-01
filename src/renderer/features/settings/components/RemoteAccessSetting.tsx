import type React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ServerInfo } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';

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
    <div className="grid gap-4">
      <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="grid min-w-0 gap-1">
          <strong className="text-sm font-medium text-foreground">远程访问</strong>
          <span className="text-xs leading-5 text-muted-foreground">
            允许同一网络或 Tailscale 设备访问当前服务。
          </span>
        </div>

        <RemoteAccessSwitch
          checked={allowRemote}
          disabled={!serverInfo || switching}
          onCheckedChange={(checked) => void onSetRemoteAccess(checked)}
        />
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

/** 设置面板中的远程访问开关。 */
function RemoteAccessSwitch({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label="远程访问"
      disabled={disabled}
      className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-0 bg-muted p-0 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=checked]:bg-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

/** 展示一个远程访问地址，并提供复制入口。 */
function RemoteUrlRow({ url }: { url: string }): React.ReactElement {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-muted px-3 py-2">
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{formatRemoteUrlLabel(url)}</span>
        <code className="mt-1 block break-all text-xs text-foreground">{url}</code>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
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
