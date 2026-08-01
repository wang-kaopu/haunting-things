import { useCallback, useEffect, useState } from 'react';
import type { ServerInfo } from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';
import { normalizeServerInfo } from '@renderer/shared/utils/backendData';

const RESTART_POLL_INTERVAL_MS = 250;
const RESTART_TIMEOUT_MS = 10_000;

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
 * 远程访问切换后会轮询服务重启状态，再读取真实监听地址。
 */
export function useServerInfo(): UseServerInfoResult {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /** 获取并校验当前服务监听信息。 */
  const requestServerInfo = useCallback(async (): Promise<ServerInfo> => {
    const info = normalizeServerInfo(await bridge.invoke('server.info', undefined));
    if (!info) throw new Error('服务端信息响应格式无效');
    return info;
  }, []);

  const loadServerInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      setServerInfo(await requestServerInfo());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [requestServerInfo]);

  const setRemoteAccess = useCallback(
    async (allowRemote: boolean) => {
      try {
        setLoading(true);
        setError('');

        const target = normalizeServerInfo(await bridge.invoke('server.setRemoteAccess', { allowRemote }));
        if (!target) throw new Error('服务端信息响应格式无效');
        setServerInfo(target);

        if (target.restarting) {
          await bridge.waitForReconnect(RESTART_TIMEOUT_MS);
        }
        await waitForRestart(requestServerInfo, setServerInfo);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [requestServerInfo]
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
 * 轮询服务状态，等待监听地址重绑完成。
 */
async function waitForRestart(
  requestServerInfo: () => Promise<ServerInfo>,
  setServerInfo: (info: ServerInfo) => void
): Promise<void> {
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const info = await requestServerInfo();
      setServerInfo(info);
      if (!info.restarting) return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await delay(RESTART_POLL_INTERVAL_MS);
  }

  throw lastError ?? new Error('服务重启超时，请检查监听地址是否可用。');
}

/** 等待下一次服务状态轮询。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
