import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Workspace } from '@shared/types';
import type { Db } from '@server/db/connection';
import { rowToWorkspace } from '@server/db/mappers';
import { createId } from '@server/id';

/** 负责独立工作区实体的持久化和路径标准化。 */
export class WorkspaceRepository {
  constructor(private readonly db: Db) {}

  /** 写入工作区实体。 */
  createWorkspace(workspace: Workspace): Workspace {
    this.db
      .prepare(
        `INSERT INTO workspaces (
          id, name, path, kind, is_temporary, exists_on_disk,
          last_opened_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workspace.id,
        workspace.name,
        normalizeWorkspacePath(workspace.path),
        workspace.kind,
        workspace.isTemporary ? 1 : 0,
        workspace.existsOnDisk ? 1 : 0,
        workspace.lastOpenedAt ?? null,
        workspace.createdAt,
        workspace.updatedAt
      );
    return workspace;
  }

  /** 按 ID 读取工作区。 */
  getWorkspace(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
    return row ? rowToWorkspace(row) : null;
  }

  /** 按标准化路径读取工作区。 */
  getWorkspaceByPath(workspacePath: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE path = ?').get(normalizeWorkspacePath(workspacePath)) as any;
    return row ? rowToWorkspace(row) : null;
  }

  /** 按最近打开/更新时间列出工作区。 */
  listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC')
      .all() as any[];
    return rows.map(rowToWorkspace);
  }

  /** 更新最近打开时间。 */
  touchWorkspace(id: string): Workspace | null {
    const now = Date.now();
    this.db.prepare('UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    return this.getWorkspace(id);
  }

  /** 更新工作区可变元数据。 */
  updateWorkspace(input: {
    id: string;
    name?: string;
    path?: string;
    existsOnDisk?: boolean;
  }): Workspace | null {
    const current = this.getWorkspace(input.id);
    if (!current) return null;
    this.db
      .prepare(
        `UPDATE workspaces
         SET name = ?,
             path = ?,
             exists_on_disk = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name?.trim() || current.name,
        input.path ? normalizeWorkspacePath(input.path) : current.path,
        (input.existsOnDisk ?? current.existsOnDisk) ? 1 : 0,
        Date.now(),
        input.id
      );
    return this.getWorkspace(input.id);
  }

  /** 删除工作区记录；仅供服务层在确认没有下级引用后调用。 */
  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  /** 复用或创建服务端工作区。 */
  findOrCreateServerWorkspace(input: { path: string; name?: string }): Workspace {
    const workspacePath = normalizeWorkspacePath(input.path);
    const existing = this.getWorkspaceByPath(workspacePath);
    if (existing) return this.touchWorkspace(existing.id) ?? existing;

    const now = Date.now();
    return this.createWorkspace({
      id: createId(),
      name: input.name?.trim() || path.basename(workspacePath) || workspacePath,
      path: workspacePath,
      kind: 'server',
      isTemporary: false,
      existsOnDisk: existsSync(workspacePath),
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** 创建应用托管的对话工作区目录。 */
  createTemporaryWorkspace(input: { baseDir: string; name?: string }): Workspace {
    const id = createId();
    const workspacePath = path.join(input.baseDir, 'workspaces', id);
    mkdirSync(workspacePath, { recursive: true });

    const now = Date.now();
    return this.createWorkspace({
      id,
      name: input.name?.trim() || '对话',
      path: workspacePath,
      kind: 'temporary',
      isTemporary: true,
      existsOnDisk: true,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/** 标准化工作区路径，确保唯一约束基于真实绝对路径。 */
export function normalizeWorkspacePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('workspace path is required');
  return path.resolve(trimmed);
}
