import { useCallback, useEffect, useState } from 'react';
import type { ServerInfo } from '../../../shared/types';
import { bridge } from '../../bridgeClient';

export type UseServerInfoResult = {
  serverInfo: ServerInfo | null;
  loading: boolean;
  error: string;
  refreshServerInfo: () => Promise<void>;
};

export function useServerInfo(): UseServerInfoResult {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshServerInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const info = await bridge.invoke('server.info', undefined);
      setServerInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshServerInfo();
  }, [refreshServerInfo]);

  return {
    serverInfo,
    loading,
    error,
    refreshServerInfo,
  };
}
