import type React from 'react';
import type { ServerInfo } from '../../../shared/types';

export type RemoteAccessPanelProps = {
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onRefresh: () => Promise<void>;
};

export function RemoteAccessPanel({
  serverInfo,
  loading,
  error,
  onRefresh,
}: RemoteAccessPanelProps): React.ReactElement {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <div>
          <h3>远程访问</h3>
          <p className="muted">
            {serverInfo?.allowRemote
              ? '已允许局域网 / Tailscale 内访问。'
              : '当前仅允许本机访问。'}
          </p>
        </div>

        <button type="button" disabled={loading} onClick={() => void onRefresh()}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {!serverInfo ? (
        <p className="muted">正在读取服务信息...</p>
      ) : (
        <>
          <div className="remote-url-list">
            {serverInfo.urls.map((url) => (
              <RemoteUrlRow key={url} url={url} />
            ))}
          </div>

          <p className="muted">
            在其他设备浏览器中打开以上地址，然后使用当前账号密码登录。
          </p>

          {!serverInfo.allowRemote ? (
            <p className="muted">
              如需允许局域网或 Tailscale 访问，请使用 HOST=0.0.0.0 或
              ALLOW_REMOTE=true 启动服务。
            </p>
          ) : null}
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

    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return '本机';
    }

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
