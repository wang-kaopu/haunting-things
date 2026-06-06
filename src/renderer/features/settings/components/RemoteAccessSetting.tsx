import type React from 'react';
import type { ServerInfo } from '@shared/types';

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
    <div className="panel-dialog-item">
      <div className="panel-dialog-item-main">
        <div className="panel-dialog-item-copy">
          <strong>远程访问</strong>
          <span>允许同一网络或 Tailscale 设备访问当前服务。</span>
        </div>

        <label className="panel-dialog-switch" aria-label="远程访问">
          <input
            type="checkbox"
            checked={allowRemote}
            disabled={!serverInfo || switching}
            onChange={(event) =>
              void onSetRemoteAccess(event.currentTarget.checked)
            }
          />
          <span aria-hidden="true" />
        </label>
      </div>

      {error ? <p className="panel-dialog-error">{error}</p> : null}

      {!serverInfo ? (
        <p className="panel-dialog-muted">正在读取服务信息...</p>
      ) : null}

      {serverInfo?.restarting ? (
        <p className="panel-dialog-muted">正在切换监听地址...</p>
      ) : null}

      {serverInfo && allowRemote && urls.length > 0 ? (
        <div className="panel-dialog-item-detail">
          <div className="remote-url-list">
            {urls.map((url) => (
              <RemoteUrlRow key={url} url={url} />
            ))}
          </div>

          <p className="panel-dialog-muted">
            在其他设备浏览器中打开以上地址，然后使用当前账号密码登录。
          </p>
          <p className="panel-dialog-muted">
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
    <div className="remote-url-row">
      <div>
        <span className="remote-url-label">{formatRemoteUrlLabel(url)}</span>
        <code>{url}</code>
      </div>

      <button
        type="button"
        className="panel-dialog-copy-button"
        onClick={() => void navigator.clipboard.writeText(url)}
      >
        复制
      </button>
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
