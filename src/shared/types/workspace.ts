/** 工作区来源类型。 */
export type WorkspaceKind = 'local' | 'temporary' | 'managed';

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

/** 创建工作区的输入。 */
export type WorkspaceCreateInput = {
  name?: string;
  path?: string;
  kind?: WorkspaceKind;
};

/** 查询工作区文件树的输入。 */
export type WorkspaceTreeInput = {
  workspaceId: string;
  relativePath?: string;
  search?: string;
};
