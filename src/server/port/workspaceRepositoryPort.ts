import type { Workspace } from '@shared/types';

/** 工作区服务依赖的持久化接口。 */
export interface WorkspaceRepositoryPort {
  createWorkspace(workspace: Workspace): Workspace;
  getWorkspace(id: string): Workspace | null;
  getWorkspaceByPath(workspacePath: string): Workspace | null;
  listWorkspaces(): Workspace[];
  touchWorkspace(id: string): Workspace | null;
  updateWorkspace(input: {
    id: string;
    name?: string;
    path?: string;
    existsOnDisk?: boolean;
  }): Workspace | null;
  deleteWorkspace(id: string): void;
  findOrCreateServerWorkspace(input: { path: string; name?: string }): Workspace;
  createTemporaryWorkspace(input: { baseDir: string; name?: string }): Workspace;
}
