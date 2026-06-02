import { useCallback, useEffect, useState } from 'react';
import type { ServerInfo } from '../../../shared/types';
import { bridge } from '../bridgeClient';
import { normalizeServerInfo } from '../utils/backendData';

/** 服务监听地址和远程访问配置状态。 */
export type UseServerInfoResult = {
  serverInfo: ServerInfo | null;
  loading: boolean;
  error: string;
  setRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

/**
 * 读取和更新服务端监听信息。
 *
 * 远程访问切换后会等待服务重启窗口，再重新拉取真实监听地址。
 */
export function useServerInfo(): UseServerInfoResult {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadServerInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const info = normalizeServerInfo(await bridge.invoke('server.info', undefined));
      if (!info) throw new Error('服务端信息响应格式无效');
      setServerInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const setRemoteAccess = useCallback(
    async (allowRemote: boolean) => {
      try {
        setLoading(true);
        setError('');

        const target = normalizeServerInfo(await bridge.invoke('server.setRemoteAccess', { allowRemote }));
        if (!target) throw new Error('服务端信息响应格式无效');
        setServerInfo(target);

        await delay(1800);
        await loadServerInfo();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [loadServerInfo]
  );

  useEffect(() => {
    void loadServerInfo();
  }, [loadServerInfo]);

  return {
    serverInfo,
    loading,
    error,
    setRemoteAccess,
  };
}

/**
 * 等待服务端完成监听地址重启。
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
