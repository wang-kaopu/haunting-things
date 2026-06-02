import type React from 'react';
import type { ServerInfo } from '../../../../shared/types';

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
    <div className="settings-item settings-item-remote">
      <div className="settings-item-main">
        <div className="settings-item-copy">
          <strong>远程访问</strong>
          <span>允许同一网络或 Tailscale 设备访问当前服务。</span>
        </div>

        <label className="settings-switch" aria-label="远程访问">
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

      {error ? <p className="settings-error">{error}</p> : null}

      {!serverInfo ? (
        <p className="settings-muted">正在读取服务信息...</p>
      ) : null}

      {serverInfo?.restarting ? (
        <p className="settings-muted">正在切换监听地址...</p>
      ) : null}

      {serverInfo && allowRemote && urls.length > 0 ? (
        <div className="settings-item-detail">
          <div className="remote-url-list">
            {urls.map((url) => (
              <RemoteUrlRow key={url} url={url} />
            ))}
          </div>

          <p className="settings-muted">
            在其他设备浏览器中打开以上地址，然后使用当前账号密码登录。
          </p>
          <p className="settings-muted">
            切换远程访问会短暂重启 HTTP/WebSocket 监听，页面会自动重连。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RemoteUrlRow({ url }: { url: string }): React.ReactElement {
  return (
    <div className="remote-url-row">
      <div>
        <span className="remote-url-label">{formatRemoteUrlLabel(url)}</span>
        <code>{url}</code>
      </div>

      <button
        type="button"
        className="settings-copy-button"
        onClick={() => void navigator.clipboard.writeText(url)}
      >
        复制
      </button>
    </div>
  );
}

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

function isTailscaleIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}
