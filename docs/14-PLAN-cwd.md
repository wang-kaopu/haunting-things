1. 总体目标

改造后数据关系变成：

workspaces
  id
  name
  path
  kind
  is_temporary
  exists_on_disk
  last_opened_at
  created_at
  updated_at

conversations
  workspace_id -> workspaces.id

teams
  workspace_id -> workspaces.id

不再有：

conversations.workspace
teams.workspace
CreateConversationInput.workspace
CreateTeamInput.workspace

所有会话和团队都只通过 workspaceId 关联工作区。

2. 数据库 schema 方案

修改文件：

src/server/db/schema.ts
2.1 新增 workspaces 表
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  is_temporary INTEGER NOT NULL DEFAULT 0,
  exists_on_disk INTEGER NOT NULL DEFAULT 1,
  last_opened_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_kind_updated
ON workspaces(kind, updated_at);

CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened
ON workspaces(last_opened_at);

CREATE INDEX IF NOT EXISTS idx_workspaces_path
ON workspaces(path);

kind 建议：

export type WorkspaceKind = 'local' | 'temporary' | 'managed';
2.2 重写 conversations 表

不要 workspace TEXT。

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  backend TEXT NOT NULL,
  name TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,

  acp_session_id TEXT,
  session_mode TEXT,
  current_model_id TEXT,

  last_turn_id TEXT,
  last_stop_reason TEXT,
  last_error TEXT,

  usage_size INTEGER,
  usage_used INTEGER,
  usage_ratio REAL,
  usage_updated_at INTEGER,

  session_restore_status TEXT,
  session_restore_method TEXT,
  session_restore_error TEXT,
  session_restored_at INTEGER,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
);

索引：

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id
ON conversations(workspace_id);

CREATE INDEX IF NOT EXISTS idx_conversations_status
ON conversations(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_conversations_acp_session_id
ON conversations(acp_session_id);

CREATE INDEX IF NOT EXISTS idx_conversations_last_turn_id
ON conversations(last_turn_id);
2.3 重写 teams 表

不要 workspace TEXT。

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
);

索引：

CREATE INDEX IF NOT EXISTS idx_teams_workspace_id
ON teams(workspace_id);

CREATE INDEX IF NOT EXISTS idx_teams_status
ON teams(status, updated_at);
2.4 不做兼容迁移的处理

既然不做数据库兼容迁移，建议启动时检测旧表结构，发现旧库直接抛错，不自动回填：

function assertNoLegacyWorkspaceSchema(db: Database.Database): void {
  const conversationColumns = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>;
  const teamColumns = db.prepare(`PRAGMA table_info(teams)`).all() as Array<{ name: string }>;

  const hasLegacyConversationWorkspace = conversationColumns.some((column) => column.name === 'workspace');
  const hasLegacyTeamWorkspace = teamColumns.some((column) => column.name === 'workspace');

  if (hasLegacyConversationWorkspace || hasLegacyTeamWorkspace) {
    throw new Error(
      [
        'Incompatible database schema: legacy workspace TEXT column detected.',
        'This branch does not support workspace schema migration.',
        'Delete the local database and restart the app.',
      ].join(' ')
    );
  }
}

在 initializeSchema() 开头调用：

assertNoLegacyWorkspaceSchema(db);

本地开发处理方式：

删除旧 SQLite 数据库，重新初始化。

不要写：

ALTER TABLE conversations ADD COLUMN workspace_id ...
UPDATE conversations SET workspace_id = ...

也不要写任何旧 workspace TEXT 兼容读取逻辑。

3. Shared Types 方案

新增：

src/shared/types/workspace.ts
export type WorkspaceKind = 'local' | 'temporary' | 'managed';

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

export type WorkspaceCreateInput = {
  name?: string;
  path?: string;
  kind?: WorkspaceKind;
};

export type WorkspaceTreeInput = {
  workspaceId: string;
  relativePath?: string;
  search?: string;
};

修改：

src/shared/types/conversation.ts

Conversation 删除 workspace: string，只保留 workspaceId：

export type Conversation = {
  id: string;
  backend: AgentBackend;
  name: string;
  workspaceId: string;
  model?: string;
  status: ConversationStatus;

  acpSessionId?: string;
  sessionMode?: PermissionModeId;
  currentModelId?: string;

  lastTurnId?: string;
  lastStopReason?: StopReason;
  lastError?: string;

  usageSize?: number;
  usageUsed?: number;
  usageRatio?: number;
  usageUpdatedAt?: number;

  sessionRestoreStatus?: SessionRestoreStatus;
  sessionRestoreMethod?: string;
  sessionRestoreError?: string;
  sessionRestoredAt?: number;

  createdAt: number;
  updatedAt: number;
};

如果前端需要展示 workspace 名称，不建议塞进 Conversation 基础类型；可以新增 view model：

export type ConversationWithWorkspace = Conversation & {
  workspace: Workspace;
};

Team 同理：

export type Team = {
  id: string;
  name: string;
  workspaceId: string;
  status: TeamStatus;
  createdAt: number;
  updatedAt: number;
};

export type TeamWithWorkspace = Team & {
  workspace: Workspace;
};
4. Repository 方案

新增：

src/server/db/workspaceRepository.ts
export class WorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  createWorkspace(input: Workspace): Workspace;

  getWorkspace(id: string): Workspace | null;

  getWorkspaceByPath(path: string): Workspace | null;

  listWorkspaces(): Workspace[];

  touchWorkspace(id: string): Workspace | null;

  updateWorkspace(input: {
    id: string;
    name?: string;
    path?: string;
    existsOnDisk?: boolean;
  }): Workspace | null;

  deleteWorkspace(id: string): void;

  findOrCreateLocalWorkspace(input: {
    path: string;
    name?: string;
  }): Workspace;

  createTemporaryWorkspace(input: {
    baseDir: string;
    name?: string;
  }): Workspace;
}

路径必须标准化：

function normalizeWorkspacePath(input: string): string {
  return path.resolve(input.trim());
}

findOrCreateLocalWorkspace：

findOrCreateLocalWorkspace(input: { path: string; name?: string }): Workspace {
  const workspacePath = normalizeWorkspacePath(input.path);
  const existing = this.getWorkspaceByPath(workspacePath);
  if (existing) return existing;

  const now = Date.now();
  const workspace: Workspace = {
    id: createId(),
    name: input.name?.trim() || path.basename(workspacePath) || workspacePath,
    path: workspacePath,
    kind: 'local',
    isTemporary: false,
    existsOnDisk: existsSync(workspacePath),
    lastOpenedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  return this.createWorkspace(workspace);
}

createTemporaryWorkspace：

createTemporaryWorkspace(input: { baseDir: string; name?: string }): Workspace {
  const id = createId();
  const workspacePath = path.join(input.baseDir, 'workspaces', id);

  mkdirSync(workspacePath, { recursive: true });

  const now = Date.now();
  return this.createWorkspace({
    id,
    name: input.name?.trim() || 'Temporary Session',
    path: workspacePath,
    kind: 'temporary',
    isTemporary: true,
    existsOnDisk: true,
    lastOpenedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}
5. ConversationRepository 改造

修改：

src/server/db/conversationRepository.ts
src/server/db/mappers.ts
5.1 createConversation

不再接收 workspace，只接收 workspaceId：

createConversation(conversation: Conversation): Conversation {
  this.db
    .prepare(
      `INSERT INTO conversations (
        id, backend, name, workspace_id, model, status,
        acp_session_id, session_mode, current_model_id,
        last_turn_id, last_stop_reason, last_error,
        usage_size, usage_used, usage_ratio, usage_updated_at,
        session_restore_status, session_restore_method, session_restore_error, session_restored_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      conversation.id,
      conversation.backend,
      conversation.name,
      conversation.workspaceId,
      conversation.model ?? null,
      conversation.status,

      conversation.acpSessionId ?? null,
      conversation.sessionMode ?? null,
      conversation.currentModelId ?? null,

      conversation.lastTurnId ?? null,
      conversation.lastStopReason ?? null,
      conversation.lastError ?? null,

      conversation.usageSize ?? null,
      conversation.usageUsed ?? null,
      conversation.usageRatio ?? null,
      conversation.usageUpdatedAt ?? null,

      conversation.sessionRestoreStatus ?? null,
      conversation.sessionRestoreMethod ?? null,
      conversation.sessionRestoreError ?? null,
      conversation.sessionRestoredAt ?? null,

      conversation.createdAt,
      conversation.updatedAt
    );

  return conversation;
}
5.2 rowToConversation
export function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    backend: row.backend,
    name: row.name,
    workspaceId: row.workspace_id,
    model: row.model ?? undefined,
    status: row.status,

    acpSessionId: row.acp_session_id ?? undefined,
    sessionMode: row.session_mode ?? undefined,
    currentModelId: row.current_model_id ?? undefined,

    lastTurnId: row.last_turn_id ?? undefined,
    lastStopReason: row.last_stop_reason ?? undefined,
    lastError: row.last_error ?? undefined,

    usageSize: row.usage_size ?? undefined,
    usageUsed: row.usage_used ?? undefined,
    usageRatio: row.usage_ratio ?? undefined,
    usageUpdatedAt: row.usage_updated_at ?? undefined,

    sessionRestoreStatus: row.session_restore_status ?? undefined,
    sessionRestoreMethod: row.session_restore_method ?? undefined,
    sessionRestoreError: row.session_restore_error ?? undefined,
    sessionRestoredAt: row.session_restored_at ?? undefined,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
5.3 查询带 Workspace 的会话

新增：

getConversationWithWorkspace(id: string): ConversationWithWorkspace | null;

listConversationsWithWorkspace(): ConversationWithWorkspace[];

SQL：

SELECT
  c.*,
  w.id AS workspace__id,
  w.name AS workspace__name,
  w.path AS workspace__path,
  w.kind AS workspace__kind,
  w.is_temporary AS workspace__is_temporary,
  w.exists_on_disk AS workspace__exists_on_disk,
  w.last_opened_at AS workspace__last_opened_at,
  w.created_at AS workspace__created_at,
  w.updated_at AS workspace__updated_at
FROM conversations c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.id = ?
6. WorkspaceService 方案

新增：

src/server/services/workspaceService.ts

职责：

1. 创建 local workspace。
2. 创建 temporary workspace。
3. 根据 workspaceId 解析真实路径。
4. 校验路径是否存在。
5. 提供文件树。
6. 提供文件读写/重命名/删除/打开/定位。
7. 保证所有相对路径不能逃逸 workspace 根目录。

核心安全函数：

export function resolveInsideWorkspace(workspacePath: string, relativePath = '.'): string {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, relativePath);

  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes workspace');
  }

  return target;
}

获取工作区路径：

getWorkspacePath(workspaceId: string): string {
  const workspace = this.repo.getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  return workspace.path;
}

创建或解析：

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
    return this.repo.createTemporaryWorkspace({
      baseDir: this.dataDir,
      name: 'Temporary Session',
    });
  }

  throw new Error('workspaceId is required');
}

注意：不在 conversation.create 里接收 path。如果用户选择了新目录，前端先调用 workspace.create，拿到 workspace.id 后再创建 conversation。

7. ConversationService 改造

当前创建会话会直接处理路径和 mkdirSync。 改成只处理 workspaceId。

7.1 CreateConversationInput

删除：

workspace?: string;

改成：

export type CreateConversationInput = {
  backend: AgentBackend;
  name?: string;
  model?: string;
  workspaceId?: string;
  mcpServers?: ConversationMcpServer[];
};

规则：

传 workspaceId：使用已有工作区。
不传 workspaceId：创建临时工作区，并绑定它。
不接受 workspace path。
7.2 create()
create(input: CreateConversationInput): ConversationWithWorkspace {
  const workspace = this.workspaceService.resolveOrCreate({
    workspaceId: input.workspaceId,
    createTemporaryWhenMissing: true,
  });

  const now = Date.now();

  const conversation = this.repo.createConversation({
    id: createId(),
    backend: input.backend,
    name: input.name || `${input.backend} conversation`,
    workspaceId: workspace.id,
    model: input.model?.trim() || undefined,
    status: 'idle',

    acpSessionId: undefined,
    sessionMode: undefined,
    currentModelId: input.model?.trim() || undefined,

    lastTurnId: undefined,
    lastStopReason: undefined,
    lastError: undefined,

    usageSize: undefined,
    usageUsed: undefined,
    usageRatio: undefined,
    usageUpdatedAt: undefined,

    sessionRestoreStatus: undefined,
    sessionRestoreMethod: undefined,
    sessionRestoreError: undefined,
    sessionRestoredAt: undefined,

    createdAt: now,
    updatedAt: now,
  });

  if (input.mcpServers?.length) {
    this.repo.replaceConversationMcpServers(conversation.id, input.mcpServers);
  }

  return {
    ...conversation,
    workspace,
  };
}
7.3 getRuntime()

AcpRuntime 仍然需要真实路径，但只能通过 workspaceId 解析：

const conversationWithWorkspace = this.repo.getConversationWithWorkspace(conversation.id);
if (!conversationWithWorkspace) {
  throw new Error(`Conversation not found: ${conversation.id}`);
}

const runtime = new AcpRuntime({
  conversationId: conversation.id,
  backend: conversation.backend,
  workspacePath: conversationWithWorkspace.workspace.path,
  model: conversation.currentModelId ?? conversation.model,
  startupMode: conversation.sessionMode,
  mcpServers: this.getConversationMcpServers(conversation.id),
  resumeSessionId: conversation.acpSessionId,
});

AcpRuntime 参数也改名，避免再把 workspaceId/path 混淆：

workspacePath: string;
8. 修改会话工作区策略

新增：

setConversationWorkspace(input: {
  conversationId: string;
  workspaceId: string;
}): ConversationWithWorkspace;

规则：

1. workspaceId 必须存在。
2. 如果 runtime 正在 activePrompt，拒绝修改。
3. 如果 runtime 存在但空闲，停止旧 runtime。
4. 更新 conversations.workspace_id。
5. 清空 acp_session_id。
6. 清空 session_restore_*。
7. last_stop_reason 记为 stopped。
8. 下一次发送消息时重新用新 workspacePath 创建 ACP session。

Repository 方法：

updateConversationWorkspace(input: {
  conversationId: string;
  workspaceId: string;
}): Conversation | null;

SQL：

UPDATE conversations
SET workspace_id = ?,
    acp_session_id = NULL,
    session_restore_status = NULL,
    session_restore_method = NULL,
    session_restore_error = NULL,
    session_restored_at = NULL,
    last_stop_reason = 'stopped',
    last_error = 'Workspace changed; ACP session was reset',
    updated_at = ?
WHERE id = ?

Service：

setConversationWorkspace(input: {
  conversationId: string;
  workspaceId: string;
}): ConversationWithWorkspace {
  const workspace = this.workspaceService.get(input.workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);

  const runtime = this.runtimes.get(input.conversationId);
  if (runtime?.isActivePrompt()) {
    throw new Error('Cannot change workspace while prompt is running');
  }

  runtime?.stop('stopped');
  this.runtimes.delete(input.conversationId);

  const updated = this.repo.updateConversationWorkspace({
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
  });

  if (!updated) throw new Error(`Conversation not found: ${input.conversationId}`);

  const result = {
    ...updated,
    workspace,
  };

  this.events.emit('conversation.updated', result);
  return result;
}
9. TeamService 改造

Team 也只保存 workspaceId。

9.1 CreateTeamInput

删除：

workspace?: string;

改成：

export type CreateTeamInput = {
  name: string;
  workspaceId?: string;
  agents: TeamAgentInput[];
};

规则和 conversation 一样：

传 workspaceId：复用已有工作区。
不传 workspaceId：创建临时工作区。
9.2 Team 下 conversation 创建

Team 创建 agent conversation 时，统一传：

workspaceId: team.workspaceId

这样团队里的多个 agent 共享同一个 workspace。

10. AcpRuntime 改造

当前 runtime 输入叫 workspace，并把它 resolve 成 cwd。 改名为 workspacePath，避免误以为是 workspaceId。

constructor(
  private readonly input: {
    conversationId: string;
    backend: AgentBackend;
    workspacePath: string;
    model?: string;
    startupMode?: string;
    mcpServers?: McpServer[];
    resumeSessionId?: string;
  }
) {}

启动时：

const cwd = path.resolve(this.input.workspacePath || process.cwd());
this.validateWorkspaceCwd(cwd);

所有 ACP 请求继续传 cwd：

await connection.loadSession({
  sessionId,
  cwd,
  mcpServers,
});
await connection.resumeSession({
  sessionId,
  cwd,
  mcpServers,
});
await connection.newSession({
  cwd,
  mcpServers,
});

这和两个 bridge 的工作方式一致：Claude 和 Codex 都根据 ACP Client 传入的 cwd 确定工作区。Claude 会把 cwd 传给 Claude SDK options，Codex 会用 cwd 覆盖 config.cwd。

11. Bridge API 改造

修改：

src/shared/types/bridge.ts
src/server/app/bridge/registerBridgeHandlers.ts
11.1 workspace API
'workspace.create': {
  params: { name?: string; path?: string; kind?: WorkspaceKind };
  result: Workspace;
};

'workspace.createTemporary': {
  params: { name?: string };
  result: Workspace;
};

'workspace.list': {
  params: void;
  result: Workspace[];
};

'workspace.get': {
  params: { workspaceId: string };
  result: Workspace | null;
};

'workspace.tree': {
  params: {
    workspaceId: string;
    relativePath?: string;
    search?: string;
  };
  result: WorkspaceEntry[];
};

'workspace.readTextFile': {
  params: { workspaceId: string; relativePath: string };
  result: { content: string };
};

'workspace.writeTextFile': {
  params: { workspaceId: string; relativePath: string; content: string };
  result: { written: true };
};

'workspace.mkdir': {
  params: { workspaceId: string; relativePath: string };
  result: { created: true };
};

'workspace.rename': {
  params: { workspaceId: string; relativePath: string; newName: string };
  result: { renamed: true };
};

'workspace.deleteEntry': {
  params: { workspaceId: string; relativePath: string };
  result: { deleted: true };
};

'workspace.openPath': {
  params: { workspaceId: string; relativePath?: string };
  result: { opened: true };
};

'workspace.revealPath': {
  params: { workspaceId: string; relativePath?: string };
  result: { revealed: true };
};
11.2 conversation API

conversation.create 删除 workspace 参数：

'conversation.create': {
  params: {
    backend: AgentBackend;
    name?: string;
    model?: string;
    workspaceId?: string;
    mcpServers?: ConversationMcpServer[];
  };
  result: ConversationWithWorkspace;
};

新增：

'conversation.setWorkspace': {
  params: {
    conversationId: string;
    workspaceId: string;
  };
  result: ConversationWithWorkspace;
};
11.3 team API

team.create 删除 workspace 参数：

'team.create': {
  params: {
    name: string;
    workspaceId?: string;
    agents: TeamAgentInput[];
  };
  result: TeamWithWorkspace;
};
12. 前端改造方案
12.1 新建 Workspace 选择流程

新建会话弹窗不再让用户直接把路径塞给 conversation。

流程改成：

选择已有工作区
  -> workspace.list
  -> conversation.create({ workspaceId })

选择本地目录
  -> workspace.create({ path })
  -> conversation.create({ workspaceId: workspace.id })

使用临时工作区
  -> conversation.create({ workspaceId: undefined })
  -> 后端自动 createTemporaryWorkspace
12.2 Conversation 页面拿 workspace

会话详情建议用：

ConversationWithWorkspace

而不是自己再通过 conversation.workspaceId 查。

展示：

<span>{conversation.workspace.name}</span>
<span>{conversation.workspace.path}</span>

临时工作区：

{conversation.workspace.isTemporary ? 'Temporary Session' : conversation.workspace.name}

AionUi 也是让后端传 isTemporaryWorkspace，前端只负责展示，不通过路径猜。

12.3 WorkspacePanel

新增：

src/renderer/features/workspace/
  WorkspacePanel.tsx
  WorkspaceTree.tsx
  WorkspaceToolbar.tsx
  hooks/useWorkspaceTree.ts
  hooks/useWorkspaceFileOps.ts
  utils/workspaceMapper.ts

加载文件树：

const entries = await bridge.invoke('workspace.tree', {
  workspaceId,
  relativePath,
  search,
});

AionUi 的工作区树会通过后端按 workspace/path/search 加载，并处理过期请求、空结果保护、懒加载合并等。 haunting-things 第一版至少保留 loadSeqRef 防止旧请求覆盖新结果。

13. 安全约束

所有文件操作必须只接收：

workspaceId + relativePath

不要让前端传任意绝对路径。

必须禁止：

../../
绝对路径覆盖
删除 workspace 根目录
读取超大文件
写入超大文件
搜索无限结果

建议限制：

const MAX_READ_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_WRITE_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_WORKSPACE_SEARCH_RESULTS = 500;
14. 删除旧逻辑清单

彻底删除或替换这些东西：

Conversation.workspace
Team.workspace
CreateConversationInput.workspace
CreateTeamInput.workspace
conversation.create({ workspace: string })
team.create({ workspace: string })
ConversationService.create 里直接 mkdir workspace 的逻辑
TeamService.create 里直接 mkdir workspace 的逻辑
AcpRuntime input.workspace
任何从 conversation.workspace 读取 cwd 的代码
任何旧 workspace TEXT 兼容 mapper
任何旧 workspace TEXT 回填迁移

替换为：

Conversation.workspaceId
Team.workspaceId
workspace.create({ path })
conversation.create({ workspaceId })
team.create({ workspaceId })
WorkspaceService.createTemporaryWorkspace()
AcpRuntime input.workspacePath
ConversationService 通过 workspaceId join workspaces.path 后传 workspacePath
15. 测试方案
15.1 Repository 测试
1. createWorkspace 正常写入。
2. workspaces.path 唯一。
3. createConversation 必须传 workspaceId。
4. createConversation 不再写 workspace 字段。
5. getConversationWithWorkspace 能 join 出 workspace。
6. updateConversationWorkspace 会清空 acp_session_id。
7. team 只保存 workspaceId。
15.2 WorkspaceService 测试
1. createTemporaryWorkspace 会创建真实目录。
2. findOrCreateLocalWorkspace 同路径复用同一 id。
3. workspace.tree 正常返回文件。
4. resolveInsideWorkspace 禁止 ../ 越界。
5. readTextFile 限制大小。
6. deleteEntry 禁止删除 workspace 根目录。
15.3 ConversationService 测试
1. create 不传 workspaceId 时自动创建 temporary workspace。
2. create 传 workspaceId 时复用已有 workspace。
3. getRuntime 使用 workspace.path 作为 workspacePath。
4. setConversationWorkspace 时 activePrompt=true 会拒绝。
5. setConversationWorkspace 会 stop 旧 runtime 并清空 acpSessionId。
15.4 Runtime 测试
1. AcpRuntime 使用 workspacePath 作为 spawn cwd。
2. session/new 传 cwd=workspacePath。
3. session/load 传 cwd=workspacePath。
4. session/resume 传 cwd=workspacePath。
5. workspacePath 不存在时启动失败。
16. 分阶段提交建议
feat: 增加工作区实体模型

包含：

src/shared/types/workspace.ts
src/server/db/schema.ts
src/server/db/workspaceRepository.ts
refactor: 使用工作区 ID 关联会话和团队

包含：

src/shared/types/conversation.ts
src/shared/types/team.ts
src/server/db/conversationRepository.ts
src/server/db/teamRepository.ts
src/server/db/mappers.ts
feat: 增加工作区文件服务

包含：

src/server/services/workspaceService.ts
src/shared/types/bridge.ts
src/server/app/bridge/registerBridgeHandlers.ts
refactor: 通过工作区路径启动 ACP 运行时

包含：

src/server/services/conversationService.ts
src/server/services/teamService.ts
src/server/runtime/acpRuntime.ts
feat: 增加工作区选择与文件面板

包含：

src/renderer/features/workspace/**
src/renderer 相关会话创建 UI
test: 补充工作区关联测试
17. 最终验收标准
1. 数据库里 conversations 没有 workspace TEXT。
2. 数据库里 teams 没有 workspace TEXT。
3. conversations.workspace_id NOT NULL。
4. teams.workspace_id NOT NULL。
5. workspace 路径只存在 workspaces.path。
6. 新建会话不传 workspaceId 会自动创建临时 workspace。
7. 新建会话传 workspaceId 会复用已有 workspace。
8. 新建团队不传 workspaceId 会自动创建临时 workspace。
9. 团队下所有 agent 复用 team.workspaceId。
10. ACP runtime 的 cwd 来自 workspaces.path。
11. 修改会话 workspace 会清空 acp_session_id。
12. 前端可以列出 workspace、选择 workspace、展示文件树。
13. 所有文件操作都不能越出 workspace 根目录。
14. 不存在旧 workspace TEXT 兼容读取逻辑。
15. 不存在旧库自动迁移逻辑。
16. typecheck 和测试通过。

最终结构一句话：

workspace 不再是 conversation/team 上的路径字段，而是独立 workspaces 表中的实体；conversation/team 只保存 workspace_id，ACP runtime 每次启动时通过 workspace_id -> workspaces.path 解析出真实 cwd。