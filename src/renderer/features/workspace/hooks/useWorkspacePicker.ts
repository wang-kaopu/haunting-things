import { useCallback, useEffect, useState } from 'react';
import type { Workspace, WorkspaceDirectoryListing } from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';
import { normalizeWorkspace, normalizeWorkspaceDirectoryListing } from '@renderer/shared/utils/backendData';

/** 管理项目根目录内的工作区目录浏览和选择。 */
export function useWorkspacePicker(): {
  listing: WorkspaceDirectoryListing | null;
  loading: boolean;
  error: string;
  browse: (relativePath?: string) => Promise<void>;
  refresh: () => Promise<void>;
  goParent: () => Promise<void>;
  selectCurrentDirectory: () => Promise<Workspace>;
} {
  const [listing, setListing] = useState<WorkspaceDirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const browse = useCallback(async (relativePath = '.') => {
    setLoading(true);
    setError('');

    try {
      const result = normalizeWorkspaceDirectoryListing(
        await bridge.invoke('workspace.browse', {
          relativePath,
        })
      );
      if (!result) throw new Error('目录浏览响应格式无效');
      setListing(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await browse(listing?.relativePath ?? '.');
  }, [browse, listing?.relativePath]);

  const goParent = useCallback(async () => {
    if (!listing?.parentRelativePath) return;
    await browse(listing.parentRelativePath);
  }, [browse, listing?.parentRelativePath]);

  const selectCurrentDirectory = useCallback(async () => {
    const workspace = normalizeWorkspace(
      await bridge.invoke('workspace.selectDirectory', {
        relativePath: listing?.relativePath ?? '.',
      })
    );
    if (!workspace) throw new Error('工作区响应格式无效');
    return workspace;
  }, [listing?.relativePath]);

  useEffect(() => {
    void browse('.');
  }, [browse]);

  return {
    listing,
    loading,
    error,
    browse,
    refresh,
    goParent,
    selectCurrentDirectory,
  };
}
