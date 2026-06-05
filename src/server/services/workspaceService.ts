import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Workspace,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryListing,
  WorkspaceEntry,
  WorkspaceRoot,
  WorkspaceTreeInput,
} from '@shared/types';
import type { WorkspaceRepositoryPort } from '@server/db/workspaceRepository';
import { normalizeWorkspacePath } from '@server/db/workspaceRepository';
import type { WorkspaceRootService } from '@server/services/workspaceRootService';

const MAX_READ_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_WRITE_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_WORKSPACE_SEARCH_RESULTS = 500;
const MAX_TREE_DEPTH = 2;
const DEFAULT_IGNORED_NAMES = new Set(['.git', 'node_modules', 'dist', 'dist-server', 'build', '.next', '.turbo', '.cache']);

/**
 * 管理工作区实体和工作区内文件操作。
 *
 * 所有文件操作都通过 workspaceId + relativePath 定位，并限制在 workspace 根目录内。
 */
export class WorkspaceService {
  constructor(
    private readonly repo: WorkspaceRepositoryPort,
    private readonly rootService: WorkspaceRootService,
    private readonly dataDir: string
  ) {}

  /** 返回 WebUI 可浏览的唯一项目根目录。 */
  getRoot(): WorkspaceRoot {
    return this.rootService.getRoot();
  }

  /** 浏览启动项目根目录内的目录内容。 */
  async browse(input: { relativePath?: string }): Promise<WorkspaceDirectoryListing> {
    const root = this.rootService.getRoot();
    const relativePath = normalizeRelativePath(input.relativePath);
    const targetPath = this.rootService.resolve(relativePath);
    const info = await stat(targetPath).catch(() => null);
    if (!info?.isDirectory()) throw new Error('Selected path is not a directory');

    return {
      root,
      relativePath,
      absolutePath: targetPath,
      parentRelativePath: getParentRelativePath(relativePath),
      entries: await this.listDirectory(root.path, targetPath),
    };
  }

  /** 选择启动项目根目录内的目录并注册为 server workspace。 */
  async selectDirectory(input: { relativePath?: string }): Promise<Workspace> {
    const absolutePath = this.rootService.resolve(normalizeRelativePath(input.relativePath));
    const info = await stat(absolutePath).catch(() => null);
    if (!info?.isDirectory()) throw new Error('Selected path is not a directory');

    return this.createOrReuseServerWorkspace(absolutePath);
  }

  /** 创建对话工作区。 */
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

  /** 工作区不能被用户直接删除，只能在没有下级引用时由系统自动清理。 */
  delete(input: { workspaceId: string }): { deleted: true } {
    this.getRequired(input.workspaceId);
    throw new Error('Workspace cannot be deleted directly');
  }

  /**
   * 自动删除没有任何 Team/Conversation 引用的工作区记录。
   *
   * @param input.workspaceId - 待检查工作区 ID
   * @param input.teamCount - 当前工作区下的 Team 数量
   * @param input.conversationCount - 当前工作区下的 Conversation 数量
   * @returns 是否实际删除了工作区记录
   */
  deleteIfUnreferenced(input: {
    workspaceId: string;
    teamCount: number;
    conversationCount: number;
  }): { deleted: boolean } {
    const workspace = this.repo.getWorkspace(input.workspaceId);
    if (!workspace) return { deleted: false };
    if (input.teamCount > 0 || input.conversationCount > 0) return { deleted: false };

    this.repo.deleteWorkspace(input.workspaceId);
    return { deleted: true };
  }

  /** 读取已有工作区；不存在时抛出明确错误。 */
  getRequired(workspaceId: string): Workspace {
    const workspace = this.repo.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return this.repo.touchWorkspace(workspace.id) ?? workspace;
  }

  /** 解析已有工作区；必要时创建对话工作区。 */
  resolveOrCreate(input: {
    workspaceId?: string;
    createTemporaryWhenMissing?: boolean;
  }): Workspace {
    if (input.workspaceId) {
      return this.getRequired(input.workspaceId);
    }

    if (input.createTemporaryWhenMissing) {
      return this.createTemporary({ name: '对话' });
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

  /** 根据后端 allowlist 解析出的真实目录创建或复用 server workspace。 */
  private createOrReuseServerWorkspace(workspacePath: string): Workspace {
    return this.repo.findOrCreateServerWorkspace({
      path: workspacePath,
      name: path.basename(workspacePath) || workspacePath,
    });
  }

  /** 列出服务端目录浏览条目，只展示常规目录/文件并默认隐藏重型目录。 */
  private async listDirectory(rootPath: string, dir: string): Promise<WorkspaceDirectoryEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const result: WorkspaceDirectoryEntry[] = [];

    for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (DEFAULT_IGNORED_NAMES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const info = await stat(fullPath).catch(() => null);
      if (!info) continue;
      result.push(toWorkspaceDirectoryEntry(rootPath, fullPath, entry.isDirectory(), entry.isFile(), info));
    }

    return result;
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

/** 将服务端目录 stat 结果转换为目录浏览条目。 */
function toWorkspaceDirectoryEntry(
  rootPath: string,
  fullPath: string,
  isDir: boolean,
  isFile: boolean,
  info: { size: number; mtimeMs: number }
): WorkspaceDirectoryEntry {
  return {
    name: path.basename(fullPath),
    relativePath: normalizeRelativePath(path.relative(rootPath, fullPath)),
    isDir,
    isFile,
    size: isFile ? info.size : undefined,
    modifiedAt: Math.floor(info.mtimeMs),
  };
}

/** 规范化 WebUI 提交的项目根相对路径。 */
function normalizeRelativePath(value?: string): string {
  if (!value || value === '/') return '.';
  const normalized = value.replace(/\\/g, '/');
  return normalized || '.';
}

/** 计算目录浏览的父级相对路径。 */
function getParentRelativePath(relativePath: string): string | undefined {
  if (!relativePath || relativePath === '.') return undefined;
  const parent = path.posix.dirname(relativePath.replace(/\\/g, '/'));
  return parent === '.' ? '.' : parent;
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
