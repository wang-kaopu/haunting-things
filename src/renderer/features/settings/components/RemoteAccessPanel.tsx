import type React from 'react';
import type { ServerInfo } from '@shared/types';

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
  const urls = Array.isArray(serverInfo?.urls) ? serverInfo.urls : [];
  const allowRemote = serverInfo?.allowRemote ?? false;
  const switching = loading || serverInfo?.restarting;

  return (
    <section className="settings-card">
      <label className="remote-toggle-row">
        <span>
          <strong>允许远程访问</strong>
          <small>允许同一网络或 Tailscale 设备访问当前服务。</small>
        </span>
        <input
          type="checkbox"
          checked={allowRemote}
          disabled={!serverInfo || switching}
          onChange={(event) => void onSetRemoteAccess(event.currentTarget.checked)}
        />
      </label>

      {error ? <p className="error-text">{error}</p> : null}

      {!serverInfo ? (
        <p className="muted">正在读取服务信息...</p>
      ) : (
        <>
          {serverInfo.restarting ? <p className="muted">正在切换监听地址...</p> : null}

          {urls.length > 0 ? (
            <div className="remote-url-list">
              {urls.map((url) => (
                <RemoteUrlRow key={url} url={url} />
              ))}
            </div>
          ) : null}

          {urls.length > 0 ? <p className="muted">在其他设备浏览器中打开以上地址，然后使用当前账号密码登录。</p> : null}

          <p className="muted">切换远程访问会短暂重启 HTTP/WebSocket 监听，页面会自动重连。</p>
        </>
      )}
    </section>
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
        className="panel-dialog-copy-button"
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
