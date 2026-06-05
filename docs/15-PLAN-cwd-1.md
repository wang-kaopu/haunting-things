> 已废弃：工作区目录选择的最新实现以 `docs/16-PLAN-cwd-2.md` 为准。当前 WebUI 固定使用启动项目路径作为唯一 root，不再提供 `workspace.roots`、`rootId` 或搜索框。

下面是**旧版编码方案**：不做 Electron，改成纯 WebUI 工作区选择；并继续参考 Codex 的“工作区 + 会话摘要列表”组织方式。

关键前提先说清楚：**WebUI 不能像 Electron 那样拿到用户机器上的真实绝对目录路径并直接当后端 `cwd` 用。** 浏览器的 `showDirectoryPicker()` 返回的是 `FileSystemDirectoryHandle`，不是服务端可用的绝对路径，而且该 API 还要求安全上下文、用户交互，并且不是所有主流浏览器都支持。([MDN Web Docs][1]) 传统 `<input webkitdirectory>` 也只能拿到文件列表和相对路径 `webkitRelativePath`，不是机器绝对路径。([MDN Web Docs][2])

所以这版方案改成：

> **WebUI 不打开系统资源管理器；WebUI 展示“服务端文件系统目录树”，用户在网页里选择服务端目录，后端校验并注册为 workspace。**

这才适合 `haunting-things` 的 ACP 场景，因为 ACP bridge 的 `cwd` 必须是**后端所在机器上的真实路径**。

---

# 1. 最终交互流程

```txt
WebUI 点击「选择工作区」
  -> 请求 workspace.roots
  -> 展示服务端允许访问的根目录
  -> 用户在 WebUI 目录树里逐级展开
  -> 用户选中某个目录
  -> WebUI 调 workspace.selectDirectory({ rootId, relativePath })
  -> 后端解析成真实绝对路径
  -> 后端校验路径在 allowlist root 内
  -> 后端 createOrReuse Workspace
  -> 返回 Workspace
  -> conversation.create({ workspaceId })
  -> AcpRuntime 使用 workspaces.path 作为 cwd
```

前端不再出现：

```ts
workspace.create({ path: '/Users/xxx/project' })
```

也不出现手工输入路径框。

---

# 2. 为什么不用浏览器原生目录 picker 作为 ACP cwd

浏览器目录选择 API 适合“网页读取用户选择的本地文件”，但不适合“让后端进程进入这个目录执行命令”。

原因：

```txt
1. showDirectoryPicker 返回 FileSystemDirectoryHandle，不是绝对路径。
2. webkitdirectory 返回 File 列表和相对路径，不返回服务端可用路径。
3. WebUI 可能运行在远程服务器上，用户浏览器所在机器和 ACP 后端所在机器不是同一台。
4. ACP bridge 的 cwd 必须是后端本机路径。
```

File System API 的访问模型本身也是基于用户授权后的文件/目录 handle，而不是把本机任意路径暴露给网页；MDN 也说明文件/目录数据访问必须由用户明确允许。([MDN Web Docs][3])

因此 WebUI 版推荐两个模式：

```txt
主模式：服务端目录选择器
  用于 ACP cwd，推荐实现。

可选模式：浏览器本地目录上传/同步
  用于把浏览器本地文件上传到 managed workspace，不作为 cwd 直接使用。
```

---

# 3. 数据库模型保持不变

继续使用上一版设计：

```txt
workspaces.path 是唯一真实路径来源
conversations 只保存 workspace_id
teams 只保存 workspace_id
不兼容旧 workspace TEXT
不做旧数据迁移
```

## `workspaces`

```sql
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
```

`kind` 建议：

```ts
export type WorkspaceKind = 'server' | 'temporary' | 'managed';
```

这版不再用 `local`，因为对 WebUI 来说“local”容易歧义：到底是浏览器本机，还是后端机器？建议统一叫 `server`。

---

# 4. 服务端工作区根目录 allowlist

新增配置：

```ts
export type WorkspaceRootConfig = {
  id: string;
  name: string;
  path: string;
  readonly?: boolean;
};
```

来源：

```txt
1. HAUNTING_WORKSPACE_ROOTS 环境变量
2. config/workspaces.json
3. 默认 dataDir/workspaces
4. 开发模式可额外加入 process.cwd()
```

环境变量示例：

```bash
HAUNTING_WORKSPACE_ROOTS="/Users/wkp/Code:/Users/wkp/Projects:/tmp/haunting-workspaces"
```

解析：

```ts
function loadWorkspaceRoots(dataDir: string): WorkspaceRootConfig[] {
  const raw = process.env.HAUNTING_WORKSPACE_ROOTS;

  const roots = raw
    ? raw.split(path.delimiter).filter(Boolean)
    : [path.join(dataDir, 'workspaces')];

  return roots.map((rootPath, index) => {
    const normalized = path.resolve(rootPath);

    return {
      id: `root-${index}`,
      name: path.basename(normalized) || normalized,
      path: normalized,
    };
  });
}
```

---

# 5. 路径安全模型

所有 WebUI 目录选择都只能走：

```txt
rootId + relativePath
```

不能让前端传绝对路径。

核心函数：

```ts
function resolveInsideRoot(rootPath: string, relativePath = '.'): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);

  const relative = path.relative(root, target);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes workspace root');
  }

  return target;
}
```

前端请求：

```ts
workspace.selectDirectory({
  rootId: 'root-0',
  relativePath: 'my-project',
});
```

后端解析：

```ts
const root = workspaceRootService.getRoot(rootId);
const absolutePath = resolveInsideRoot(root.path, relativePath);
```

---

# 6. Bridge / HTTP API 设计

如果 `haunting-things` 现在 WebUI 通过 bridge 抽象通信，可以继续沿用 bridge 名称；如果走 REST，也可按同样语义映射。

## 6.1 Workspace APIs

```ts
'workspace.roots': {
  params: void;
  result: WorkspaceRoot[];
};

'workspace.browse': {
  params: {
    rootId: string;
    relativePath?: string;
    search?: string;
  };
  result: WorkspaceDirectoryListing;
};

'workspace.selectDirectory': {
  params: {
    rootId: string;
    relativePath?: string;
  };
  result: Workspace;
};

'workspace.createTemporary': {
  params: {
    name?: string;
  };
  result: Workspace;
};

'workspace.list': {
  params: void;
  result: Workspace[];
};

'workspace.get': {
  params: {
    workspaceId: string;
  };
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
```

## 6.2 Types

```ts
export type WorkspaceRoot = {
  id: string;
  name: string;
  path: string;
  readonly?: boolean;
};

export type WorkspaceDirectoryEntry = {
  name: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  size?: number;
  modifiedAt?: number;
};

export type WorkspaceDirectoryListing = {
  root: WorkspaceRoot;
  relativePath: string;
  parentRelativePath?: string;
  entries: WorkspaceDirectoryEntry[];
};
```

这里可以给前端返回 `root.path` 用于展示；如果你担心远程部署泄露服务端路径，也可以只返回 `displayPath`：

```ts
export type WorkspaceRoot = {
  id: string;
  name: string;
  displayPath: string;
  readonly?: boolean;
};
```

---

# 7. WorkspaceRootService

新增：

```txt
src/server/services/workspaceRootService.ts
```

```ts
export class WorkspaceRootService {
  constructor(private readonly roots: WorkspaceRootConfig[]) {}

  listRoots(): WorkspaceRoot[] {
    return this.roots.map((root) => ({
      id: root.id,
      name: root.name,
      path: root.path,
      readonly: root.readonly,
    }));
  }

  getRoot(rootId: string): WorkspaceRootConfig {
    const root = this.roots.find((item) => item.id === rootId);
    if (!root) {
      throw new Error(`Workspace root not found: ${rootId}`);
    }

    return root;
  }

  resolve(rootId: string, relativePath = '.'): string {
    const root = this.getRoot(rootId);
    return resolveInsideRoot(root.path, relativePath);
  }
}
```

---

# 8. WorkspaceService

新增/调整：

```ts
export class WorkspaceService {
  constructor(
    private readonly workspaceRepo: WorkspaceRepository,
    private readonly rootService: WorkspaceRootService,
    private readonly dataDir: string,
  ) {}

  listRoots(): WorkspaceRoot[] {
    return this.rootService.listRoots();
  }

  async browse(input: {
    rootId: string;
    relativePath?: string;
    search?: string;
  }): Promise<WorkspaceDirectoryListing> {
    const root = this.rootService.getRoot(input.rootId);
    const targetPath = this.rootService.resolve(input.rootId, input.relativePath ?? '.');

    const stat = await fs.promises.stat(targetPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error('Selected path is not a directory');
    }

    const entries = input.search?.trim()
      ? await this.searchDirectory(root.path, targetPath, input.search.trim())
      : await this.listDirectory(root.path, targetPath);

    const parent = input.relativePath && input.relativePath !== '.'
      ? path.dirname(input.relativePath)
      : undefined;

    return {
      root: {
        id: root.id,
        name: root.name,
        path: root.path,
        readonly: root.readonly,
      },
      relativePath: input.relativePath ?? '.',
      parentRelativePath: parent,
      entries,
    };
  }

  async selectDirectory(input: {
    rootId: string;
    relativePath?: string;
  }): Promise<Workspace> {
    const absolutePath = this.rootService.resolve(input.rootId, input.relativePath ?? '.');

    const stat = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error('Selected path is not a directory');
    }

    return this.createOrReuseServerWorkspace(absolutePath);
  }

  private createOrReuseServerWorkspace(workspacePath: string): Workspace {
    const normalized = path.resolve(workspacePath);

    const existing = this.workspaceRepo.getWorkspaceByPath(normalized);
    if (existing) {
      return this.workspaceRepo.touchWorkspace(existing.id) ?? existing;
    }

    const now = Date.now();

    return this.workspaceRepo.createWorkspace({
      id: createId(),
      name: path.basename(normalized) || normalized,
      path: normalized,
      kind: 'server',
      isTemporary: false,
      existsOnDisk: true,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}
```

目录过滤：

```ts
const DEFAULT_IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);
```

---

# 9. Conversation 列表：继续参考 Codex Summary

Codex 的会话列表思路是：列表页返回 summary，不加载完整历史；支持按 `cwd` 过滤、分页、排序、搜索。`haunting-things` 对应为按 `workspaceId` 过滤。

```ts
'conversation.list': {
  params: {
    workspaceId?: string;
    cursor?: string;
    limit?: number;
    sortKey?: 'createdAt' | 'updatedAt';
    sortDirection?: 'asc' | 'desc';
    status?: ConversationStatus[];
    searchTerm?: string;
  };
  result: {
    data: ConversationSummary[];
    nextCursor?: string;
    backwardsCursor?: string;
  };
};
```

`ConversationSummary`：

```ts
export type ConversationSummary = {
  id: string;
  name: string;
  preview: string;
  status: ConversationStatus;

  backend: AgentBackend;
  model?: string;

  workspace: Workspace;

  lastStopReason?: StopReason;
  lastError?: string;

  createdAt: number;
  updatedAt: number;
};
```

查询默认：

```ts
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
```

---

# 10. Conversation 创建逻辑

## 10.1 API

```ts
'conversation.create': {
  params: {
    backend: AgentBackend;
    name?: string;
    model?: string;
    workspaceId?: string;
    mcpServers?: ConversationMcpServer[];
  };
  result: ConversationSummary;
};
```

## 10.2 规则

```txt
有 workspaceId：
  使用已有 Workspace。

没有 workspaceId：
  创建 temporary Workspace。

不允许传 path。
```

## 10.3 Service

```ts
create(input: CreateConversationInput): ConversationSummary {
  const workspace = input.workspaceId
    ? this.workspaceService.getRequired(input.workspaceId)
    : this.workspaceService.createTemporaryWorkspace();

  const now = Date.now();

  const conversation = this.repo.createConversation({
    id: createId(),
    backend: input.backend,
    name: input.name?.trim() || `${input.backend} conversation`,
    workspaceId: workspace.id,
    model: input.model?.trim() || undefined,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  });

  return this.toConversationSummary(conversation, workspace);
}
```

---

# 11. AcpRuntime 启动逻辑

`AcpRuntime` 只接收后端已经解析好的 `workspacePath`：

```ts
new AcpRuntime({
  conversationId: conversation.id,
  backend: conversation.backend,
  workspacePath: workspace.path,
  model: conversation.currentModelId ?? conversation.model,
  startupMode: conversation.sessionMode,
  mcpServers,
  resumeSessionId: conversation.acpSessionId,
});
```

启动时：

```ts
const cwd = path.resolve(this.input.workspacePath);
this.validateWorkspaceCwd(cwd);

await connection.newSession({
  cwd,
  mcpServers,
});
```

恢复时也一样：

```ts
await connection.loadSession({
  sessionId,
  cwd,
  mcpServers,
});
```

---

# 12. 前端 WebUI 设计

## 12.1 左侧结构

```txt
WorkspaceSwitcher
ConversationList
ConversationView
```

## 12.2 WorkspaceSwitcher

功能：

```txt
全部工作区
最近工作区
选择服务端目录
创建临时工作区
```

点击“选择服务端目录”打开自定义 WebUI Modal，而不是系统文件管理器。

```tsx
function WorkspaceSwitcher() {
  return (
    <>
      <button onClick={() => setDirectoryPickerOpen(true)}>
        选择工作区
      </button>

      <WorkspaceDirectoryPickerModal
        open={directoryPickerOpen}
        onOpenChange={setDirectoryPickerOpen}
        onSelect={(workspace) => {
          setActiveWorkspaceId(workspace.id);
          reloadConversations(workspace.id);
        }}
      />
    </>
  );
}
```

## 12.3 WorkspaceDirectoryPickerModal

状态：

```ts
const [roots, setRoots] = useState<WorkspaceRoot[]>([]);
const [activeRootId, setActiveRootId] = useState<string | null>(null);
const [relativePath, setRelativePath] = useState('.');
const [listing, setListing] = useState<WorkspaceDirectoryListing | null>(null);
const [search, setSearch] = useState('');
```

加载 roots：

```ts
useEffect(() => {
  bridge.invoke('workspace.roots', undefined).then((roots) => {
    setRoots(roots);
    setActiveRootId(roots[0]?.id ?? null);
  });
}, []);
```

浏览目录：

```ts
async function browse(nextRelativePath = relativePath) {
  if (!activeRootId) return;

  const result = await bridge.invoke('workspace.browse', {
    rootId: activeRootId,
    relativePath: nextRelativePath,
    search,
  });

  setListing(result);
  setRelativePath(result.relativePath);
}
```

选择当前目录：

```ts
async function selectCurrentDirectory() {
  if (!activeRootId) return;

  const workspace = await bridge.invoke('workspace.selectDirectory', {
    rootId: activeRootId,
    relativePath,
  });

  onSelect(workspace);
  onOpenChange(false);
}
```

目录项：

```tsx
{listing?.entries
  .filter((entry) => entry.isDir)
  .map((entry) => (
    <button
      key={entry.relativePath}
      onClick={() => browse(entry.relativePath)}
    >
      📁 {entry.name}
    </button>
  ))}
```

---

# 13. ConversationList 展示逻辑

```tsx
function ConversationListItem({ conversation }: { conversation: ConversationSummary }) {
  return (
    <button className="conversation-item">
      <div className="title">{conversation.name}</div>

      <div className="preview">
        {conversation.preview || '暂无消息'}
      </div>

      <div className="meta">
        <span>{conversation.workspace.name}</span>
        <span>{conversation.model ?? conversation.backend}</span>
        <span>{formatRelativeTime(conversation.updatedAt)}</span>
      </div>
    </button>
  );
}
```

按工作区过滤：

```ts
const result = await bridge.invoke('conversation.list', {
  workspaceId: activeWorkspaceId ?? undefined,
  sortKey: 'updatedAt',
  sortDirection: 'desc',
  limit: 25,
});
```

新建会话默认使用当前 workspace：

```ts
await bridge.invoke('conversation.create', {
  backend,
  model,
  workspaceId: activeWorkspaceId ?? undefined,
});
```

---

# 14. 可选：浏览器本地目录上传模式

这不是主工作区 cwd 模式，只作为补充功能。

如果用户想从浏览器本机选择一个目录，并上传到后端 managed workspace，可以用：

```html
<input type="file" webkitdirectory multiple />
```

浏览器会返回文件列表，每个文件有 `webkitRelativePath`，可用于在后端重建目录结构。([MDN Web Docs][2])

流程：

```txt
用户选择浏览器本地目录
  -> WebUI 读取 FileList
  -> 上传文件和 webkitRelativePath
  -> 后端创建 managed workspace
  -> 后端把文件写入 dataDir/managed-workspaces/{id}
  -> conversation.create({ workspaceId })
```

这个模式不叫“选择服务端目录”，建议 UI 文案叫：

```txt
上传本地文件夹为工作区
```

避免用户误解。

---

# 15. 删除 Electron 相关设计

这版明确不做：

```txt
Electron dialog.showOpenDialog
NativePlatformBridge
ElectronNativePlatformBridge
workspace.pickDirectory
系统文件资源管理器
```

删除或不实现这些 API：

```ts
'workspace.pickDirectory'
```

替换为：

```ts
'workspace.roots'
'workspace.browse'
'workspace.selectDirectory'
```

---

# 16. 安全约束

```txt
1. 所有目录选择必须在 allowlist roots 内。
2. 前端永远不能提交绝对 path 来注册 workspace。
3. browse/selectDirectory 只接收 rootId + relativePath。
4. relativePath 必须经过 resolveInsideRoot 校验。
5. 默认隐藏 .git/node_modules/dist/build。
6. search 限制最大结果数，例如 500。
7. tree/read/write 继续只接受 workspaceId + relativePath。
8. 删除目录禁止删除 workspace 根目录。
9. remote 部署时不要把敏感绝对路径直接暴露给前端，可返回 displayPath。
```

---

# 17. 提交拆分

```txt
feat: 增加服务端工作区根目录配置
```

```txt
feat: 增加 WebUI 工作区目录浏览接口
```

```txt
refactor: 移除前端工作区路径输入
```

```txt
feat: 增加工作区选择弹窗
```

```txt
feat: 增加会话摘要列表与工作区过滤
```

```txt
test: 补充 WebUI 工作区选择测试
```

---

# 18. 最终验收标准

```txt
1. 不存在 Electron 目录选择代码。
2. 不存在工作区路径手工输入框。
3. 前端不能提交绝对路径创建 workspace。
4. 后端提供 workspace.roots。
5. 前端可以在 WebUI 中浏览服务端目录。
6. 选择目录后创建或复用 Workspace。
7. conversations 只保存 workspace_id。
8. workspaces.path 是唯一真实 cwd 来源。
9. conversation.list 返回 ConversationSummary。
10. ConversationSummary 包含 workspace、preview、updatedAt、backend/model、status。
11. 会话列表支持 workspaceId 过滤。
12. 新建会话默认使用当前 workspaceId。
13. 没有当前 workspace 时创建 temporary workspace。
14. AcpRuntime 的 cwd 来自 workspaceId -> workspaces.path。
15. 所有路径都不能逃逸 allowlist root。
```

一句话总结：

> WebUI 版不要试图从浏览器拿机器绝对路径，而是参考 Codex 的 cwd/thread 思路：后端声明可访问的 workspace roots，前端提供服务端目录浏览器，用户选中目录后由后端注册 Workspace，Conversation 只通过 workspaceId 关联，列表页返回按 workspace 聚合的 ConversationSummary。
