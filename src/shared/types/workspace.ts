/** 工作区来源类型。 */
export type WorkspaceKind = 'server' | 'temporary' | 'managed';

/** 独立工作区实体，conversation/team 只通过 workspaceId 引用它。 */
export type Workspace = {
  id: string;
  name: string;
  path: string;
  kind: WorkspaceKind;
  isTemporary: boolean;
  existsOnDisk: boolean;
  lastOpenedAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** 工作区文件树条目。 */
export type WorkspaceEntry = {
  name: string;
  fullPath: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  size?: number;
  modifiedAt?: number;
  children?: WorkspaceEntry[];
};

/** 服务端允许 WebUI 浏览的工作区根目录。 */
export type WorkspaceRoot = {
  id: string;
  name: string;
  path: string;
};

/** 服务端目录浏览列表中的单个条目。 */
export type WorkspaceDirectoryEntry = {
  name: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  size?: number;
  modifiedAt?: number;
};

/** 服务端目录浏览结果。 */
export type WorkspaceDirectoryListing = {
  root: WorkspaceRoot;
  relativePath: string;
  absolutePath: string;
  parentRelativePath?: string;
  entries: WorkspaceDirectoryEntry[];
};

/** 查询工作区文件树的输入。 */
export type WorkspaceTreeInput = {
  workspaceId: string;
  relativePath?: string;
  search?: string;
};
