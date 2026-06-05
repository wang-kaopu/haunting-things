import { useCallback, useEffect, useState } from 'react';
import type { Workspace, WorkspaceDirectoryListing } from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';

/** 管理项目根目录内的工作区目录浏览和选择。 */
export function useWorkspacePicker(): {
  listing: WorkspaceDirectoryListing | null;
  loading: boolean;
  browse: (relativePath?: string) => Promise<void>;
  refresh: () => Promise<void>;
  goParent: () => Promise<void>;
  selectCurrentDirectory: () => Promise<Workspace>;
} {
  const [listing, setListing] = useState<WorkspaceDirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (relativePath = '.') => {
    setLoading(true);

    try {
      const result = await bridge.invoke('workspace.browse', {
        relativePath,
      });
      setListing(result);
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
    return bridge.invoke('workspace.selectDirectory', {
      relativePath: listing?.relativePath ?? '.',
    });
  }, [listing?.relativePath]);

  useEffect(() => {
    void browse('.');
  }, [browse]);

  return {
    listing,
    loading,
    browse,
    refresh,
    goParent,
    selectCurrentDirectory,
  };
}
