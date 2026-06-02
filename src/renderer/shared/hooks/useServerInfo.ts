import { useCallback, useEffect, useState } from 'react';
import type { ServerInfo } from '../../../shared/types';
import { bridge } from '../bridgeClient';
import { normalizeServerInfo } from '../utils/backendData';

export type UseServerInfoResult = {
  serverInfo: ServerInfo | null;
  loading: boolean;
  error: string;
  refreshServerInfo: () => Promise<void>;
  setRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

export function useServerInfo(): UseServerInfoResult {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshServerInfo = useCallback(async () => {
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
        await refreshServerInfo();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [refreshServerInfo]
  );

  useEffect(() => {
    void refreshServerInfo();
  }, [refreshServerInfo]);

  return {
    serverInfo,
    loading,
    error,
    refreshServerInfo,
    setRemoteAccess,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
