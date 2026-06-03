import { useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry } from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';
import { normalizeWorkspaceEntryList } from '@renderer/shared/utils/backendData';

/** 加载工作区文件树，并避免旧请求覆盖新结果。 */
export function useWorkspaceTree(workspaceId?: string): {
  entries: WorkspaceEntry[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
} {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadSeqRef = useRef(0);

  /** 重新加载工作区文件树。 */
  async function refresh(): Promise<void> {
    if (!workspaceId) {
      setEntries([]);
      return;
    }

    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    setLoading(true);
    setError('');
    try {
      const result = await bridge.invoke('workspace.tree', { workspaceId });
      if (loadSeqRef.current !== seq) return;
      setEntries(normalizeWorkspaceEntryList(result));
    } catch (err) {
      if (loadSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [workspaceId]);

  return { entries, loading, error, refresh };
}
