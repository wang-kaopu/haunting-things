import path from 'node:path';
import type { WorkspaceRoot } from '@shared/types';

/**
 * 管理 WebUI 可浏览的唯一项目根目录。
 *
 * WebUI 只能提交 relativePath，不能提交绝对路径或切换 root。
 */
export class WorkspaceRootService {
  private readonly root: WorkspaceRoot;

  constructor(projectRoot = process.cwd()) {
    const normalized = path.resolve(projectRoot);
    this.root = {
      id: 'project-root',
      name: path.basename(normalized) || normalized,
      path: normalized,
    };
  }

  /** 返回启动项目路径对应的唯一根目录。 */
  getRoot(): WorkspaceRoot {
    return this.root;
  }

  /** 将相对路径解析到项目根目录内，禁止逃逸 project root。 */
  resolve(relativePath = '.'): string {
    return resolveInsideRoot(this.root.path, relativePath);
  }
}

/** 将相对路径解析到项目根目录内。 */
export function resolveInsideRoot(rootPath: string, relativePath = '.'): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath || '.');
  const relative = path.relative(root, target);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes project root');
  }

  return target;
}
