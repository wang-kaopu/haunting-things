import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace, WorkspaceCreateInput, WorkspaceEntry, WorkspaceTreeInput } from '@shared/types';
import type { WorkspaceRepositoryPort } from '@server/db/workspaceRepository';
import { normalizeWorkspacePath } from '@server/db/workspaceRepository';

const MAX_READ_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_WRITE_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_WORKSPACE_SEARCH_RESULTS = 500;
const MAX_TREE_DEPTH = 2;

/**
 * 管理工作区实体和工作区内文件操作。
 *
 * 所有文件操作都通过 workspaceId + relativePath 定位，并限制在 workspace 根目录内。
 */
export class WorkspaceService {
  constructor(
    private readonly repo: WorkspaceRepositoryPort,
    private readonly dataDir: string
  ) {}

  /** 创建本地或托管工作区；未传 path 时创建临时工作区。 */
  create(input: WorkspaceCreateInput): Workspace {
    if (!input.path?.trim()) {
      return this.createTemporary({ name: input.name });
    }

    const workspace = this.repo.findOrCreateLocalWorkspace({
      path: input.path,
      name: input.name,
    });

    if (input.kind === 'managed' && workspace.kind !== 'managed') {
      return this.repo.updateWorkspace({ id: workspace.id, name: workspace.name, path: workspace.path }) ?? workspace;
    }

    return workspace;
  }

  /** 创建临时工作区。 */
  createTemporary(input: { name?: string } = {}): Workspace {
    return this.repo.createTemporaryWorkspace({
      baseDir: this.dataDir,
      name: input.name,
    });
  }

  /** 列出所有工作区。 */
  list(): Workspace[] {
    return this.repo.listWorkspaces();
  }

  /** 按 ID 读取工作区。 */
  get(workspaceId: string): Workspace | null {
    return this.repo.getWorkspace(workspaceId);
  }

  /** 解析已有工作区；必要时创建临时工作区。 */
  resolveOrCreate(input: {
    workspaceId?: string;
    createTemporaryWhenMissing?: boolean;
  }): Workspace {
    if (input.workspaceId) {
      const workspace = this.repo.getWorkspace(input.workspaceId);
      if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
      return this.repo.touchWorkspace(workspace.id) ?? workspace;
    }

    if (input.createTemporaryWhenMissing) {
      return this.createTemporary({ name: 'Temporary Session' });
    }

    throw new Error('workspaceId is required');
  }

  /** 获取工作区真实路径。 */
  getWorkspacePath(workspaceId: string): string {
    const workspace = this.repo.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return workspace.path;
  }

  /** 加载工作区文件树。 */
  async tree(input: WorkspaceTreeInput): Promise<WorkspaceEntry[]> {
    const workspace = this.requireWorkspace(input.workspaceId);
    const root = resolveInsideWorkspace(workspace.path, input.relativePath);
    const keyword = input.search?.trim().toLowerCase();

    if (keyword) {
      const results: WorkspaceEntry[] = [];
      await this.searchEntries(workspace.path, root, keyword, results);
      return results;
    }

    return this.listEntries(workspace.path, root, 0);
  }

  /** 读取工作区内文本文件。 */
  async readTextFile(input: { workspaceId: string; relativePath: string }): Promise<{ content: string }> {
    const workspace = this.requireWorkspace(input.workspaceId);
    const target = resolveInsideWorkspace(workspace.path, input.relativePath);
    const info = await stat(target);
    if (!info.isFile()) throw new Error('Path is not a file');
    if (info.size > MAX_READ_TEXT_FILE_BYTES) throw new Error('File is too large to read');
    return { content: await readFile(target, 'utf8') };
  }

  /** 写入工作区内文本文件。 */
  async writeTextFile(input: { workspaceId: string; relativePath: string; content: string }): Promise<{ written: true }> {
    const size = Buffer.byteLength(input.content, 'utf8');
    if (size > MAX_WRITE_TEXT_FILE_BYTES) throw new Error('File is too large to write');

    const workspace = this.requireWorkspace(input.workspaceId);
    const target = resolveInsideWorkspace(workspace.path, input.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.content, 'utf8');
    return { written: true };
  }

  /** 创建工作区内目录。 */
  async mkdir(input: { workspaceId: string; relativePath: string }): Promise<{ created: true }> {
    const workspace = this.requireWorkspace(input.workspaceId);
    const target = resolveInsideWorkspace(workspace.path, input.relativePath);
    await mkdir(target, { recursive: true });
    return { created: true };
  }

  /** 重命名工作区内文件或目录。 */
  async rename(input: { workspaceId: string; relativePath: string; newName: string }): Promise<{ renamed: true }> {
    const newName = input.newName.trim();
    if (!newName || newName.includes('/') || newName.includes('\\')) throw new Error('Invalid new name');

    const workspace = this.requireWorkspace(input.workspaceId);
    const source = resolveInsideWorkspace(workspace.path, input.relativePath);
    assertNotWorkspaceRoot(workspace.path, source);
    const target = resolveInsideWorkspace(workspace.path, path.join(path.dirname(input.relativePath), newName));
    await rename(source, target);
    return { renamed: true };
  }

  /** 删除工作区内文件或目录，禁止删除根目录。 */
  async deleteEntry(input: { workspaceId: string; relativePath: string }): Promise<{ deleted: true }> {
    const workspace = this.requireWorkspace(input.workspaceId);
    const target = resolveInsideWorkspace(workspace.path, input.relativePath);
    assertNotWorkspaceRoot(workspace.path, target);
    await rm(target, { recursive: true, force: true });
    return { deleted: true };
  }

  /** 调用系统默认程序打开路径。 */
  async openPath(input: { workspaceId: string; relativePath?: string }): Promise<{ opened: true }> {
    const target = this.resolveWorkspaceTarget(input.workspaceId, input.relativePath);
    launchPath(target, false);
    return { opened: true };
  }

  /** 调用系统文件管理器定位路径。 */
  async revealPath(input: { workspaceId: string; relativePath?: string }): Promise<{ revealed: true }> {
    const target = this.resolveWorkspaceTarget(input.workspaceId, input.relativePath);
    launchPath(target, true);
    return { revealed: true };
  }

  /** 获取工作区并同步磁盘存在状态。 */
  private requireWorkspace(workspaceId: string): Workspace {
    const workspace = this.repo.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    const existsOnDisk = existsSync(workspace.path);
    if (workspace.existsOnDisk !== existsOnDisk) {
      this.repo.updateWorkspace({ id: workspace.id, existsOnDisk });
    }
    if (!existsOnDisk) throw new Error(`Workspace path does not exist: ${workspace.path}`);
    return workspace;
  }

  /** 解析工作区内的目标路径。 */
  private resolveWorkspaceTarget(workspaceId: string, relativePath?: string): string {
    const workspace = this.requireWorkspace(workspaceId);
    return resolveInsideWorkspace(workspace.path, relativePath);
  }

  /** 按固定深度读取目录树。 */
  private async listEntries(workspacePath: string, dir: string, depth: number): Promise<WorkspaceEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const result: WorkspaceEntry[] = [];

    for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      const info = await stat(fullPath);
      const item = toWorkspaceEntry(workspacePath, fullPath, entry.isDirectory(), entry.isFile(), info);
      if (entry.isDirectory() && depth < MAX_TREE_DEPTH) {
        item.children = await this.listEntries(workspacePath, fullPath, depth + 1);
      }
      result.push(item);
    }

    return result;
  }

  /** 在工作区内搜索文件名并限制结果数量。 */
  private async searchEntries(
    workspacePath: string,
    dir: string,
    keyword: string,
    results: WorkspaceEntry[]
  ): Promise<void> {
    if (results.length >= MAX_WORKSPACE_SEARCH_RESULTS) return;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= MAX_WORKSPACE_SEARCH_RESULTS) return;
      const fullPath = path.join(dir, entry.name);
      const info = await stat(fullPath);
      if (entry.name.toLowerCase().includes(keyword)) {
        results.push(toWorkspaceEntry(workspacePath, fullPath, entry.isDirectory(), entry.isFile(), info));
      }
      if (entry.isDirectory()) {
        await this.searchEntries(workspacePath, fullPath, keyword, results);
      }
    }
  }
}

/** 将相对路径解析到工作区根目录内，禁止逃逸。 */
export function resolveInsideWorkspace(workspacePath: string, relativePath = '.'): string {
  const root = normalizeWorkspacePath(workspacePath);
  const target = path.resolve(root, relativePath || '.');
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes workspace');
  }
  return target;
}

/** 将文件系统 stat 结果转换为前端文件树节点。 */
function toWorkspaceEntry(
  workspacePath: string,
  fullPath: string,
  isDir: boolean,
  isFile: boolean,
  info: { size: number; mtimeMs: number }
): WorkspaceEntry {
  return {
    name: path.basename(fullPath),
    fullPath,
    relativePath: path.relative(workspacePath, fullPath) || '.',
    isDir,
    isFile,
    size: isFile ? info.size : undefined,
    modifiedAt: Math.floor(info.mtimeMs),
  };
}

/** 禁止对工作区根目录执行破坏性操作。 */
function assertNotWorkspaceRoot(workspacePath: string, target: string): void {
  if (normalizeWorkspacePath(workspacePath) === path.resolve(target)) {
    throw new Error('Cannot modify workspace root');
  }
}

/** 使用当前系统的文件管理器打开或定位路径。 */
function launchPath(target: string, reveal: boolean): void {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const args = platform === 'darwin' && reveal ? ['-R', target] : [target];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
