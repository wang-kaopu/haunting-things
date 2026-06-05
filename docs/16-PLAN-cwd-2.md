# 1. 交互目标

新的弹窗逻辑：

```txt
打开「选择工作区」
  -> 后端返回启动项目路径作为唯一 root
  -> 前端显示当前路径
  -> 用户在目录树中展开/进入目录
  -> 点击「选择当前目录」
  -> 后端用 rootPath + relativePath 解析真实路径
  -> 创建或复用 Workspace
  -> 返回 workspaceId
  -> conversation.create({ workspaceId })
```

不再有：

```txt
服务端根目录下拉框
搜索框
多个 root 选择
手工输入路径
浏览器本地目录选择器
```

---

# 2. 后端：启动项目路径作为唯一 Root

新增或修改：

```txt
src/server/services/workspaceRootService.ts
```

## 2.1 Root 类型

```ts
export type WorkspaceRoot = {
  id: string;
  name: string;
  path: string;
};
```

## 2.2 使用启动项目路径

```ts
import path from "node:path";

export class WorkspaceRootService {
  private readonly root: WorkspaceRoot;

  constructor(projectRoot = process.cwd()) {
    const normalized = path.resolve(projectRoot);

    this.root = {
      id: "project-root",
      name: path.basename(normalized) || normalized,
      path: normalized,
    };
  }

  getRoot(): WorkspaceRoot {
    return this.root;
  }

  resolve(relativePath = "."): string {
    return resolveInsideRoot(this.root.path, relativePath);
  }
}

export function resolveInsideRoot(
  rootPath: string,
  relativePath = ".",
): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);

  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes project root");
  }

  return target;
}
```

如果希望测试或部署时可覆盖：

```ts
const projectRoot = process.env.HAUNTING_PROJECT_ROOT || process.cwd();
const workspaceRootService = new WorkspaceRootService(projectRoot);
```

但 UI 上仍然只展示一个 root。

---

# 3. 后端 API：删除 search / rootId

原来可能是：

```ts
workspace.roots;
workspace.browse({ rootId, relativePath, search });
workspace.selectDirectory({ rootId, relativePath });
```

改成：

```ts
workspace.root;
workspace.browse({ relativePath });
workspace.selectDirectory({ relativePath });
```

## 3.1 Bridge 类型

```ts
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
  absolutePath: string;
  parentRelativePath?: string;
  entries: WorkspaceDirectoryEntry[];
};
```

```ts
'workspace.root': {
  params: void;
  result: WorkspaceRoot;
};

'workspace.browse': {
  params: {
    relativePath?: string;
  };
  result: WorkspaceDirectoryListing;
};

'workspace.selectDirectory': {
  params: {
    relativePath?: string;
  };
  result: Workspace;
};
```

不再提供：

```ts
search?: string;
rootId?: string;
```

---

# 4. WorkspaceService：只浏览启动项目目录内路径

```ts
export class WorkspaceService {
  constructor(
    private readonly workspaceRepo: WorkspaceRepository,
    private readonly rootService: WorkspaceRootService,
  ) {}

  getRoot(): WorkspaceRoot {
    return this.rootService.getRoot();
  }

  async browse(input: {
    relativePath?: string;
  }): Promise<WorkspaceDirectoryListing> {
    const root = this.rootService.getRoot();
    const relativePath = normalizeRelativePath(input.relativePath);
    const targetPath = this.rootService.resolve(relativePath);

    const stat = await fs.promises.stat(targetPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error("Selected path is not a directory");
    }

    const entries = await this.listDirectory(root.path, targetPath);

    return {
      root,
      relativePath,
      absolutePath: targetPath,
      parentRelativePath: getParentRelativePath(relativePath),
      entries,
    };
  }

  async selectDirectory(input: { relativePath?: string }): Promise<Workspace> {
    const targetPath = this.rootService.resolve(
      normalizeRelativePath(input.relativePath),
    );

    const stat = await fs.promises.stat(targetPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error("Selected path is not a directory");
    }

    return this.createOrReuseWorkspace(targetPath);
  }

  private async listDirectory(
    rootPath: string,
    targetPath: string,
  ): Promise<WorkspaceDirectoryEntry[]> {
    const entries = await fs.promises.readdir(targetPath, {
      withFileTypes: true,
    });

    return entries
      .filter((entry) => !shouldHideEntry(entry.name))
      .map((entry) => {
        const fullPath = path.join(targetPath, entry.name);
        const relativePath = path
          .relative(rootPath, fullPath)
          .replace(/\\/g, "/");

        return {
          name: entry.name,
          relativePath,
          isDir: entry.isDirectory(),
          isFile: entry.isFile(),
        };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  private createOrReuseWorkspace(workspacePath: string): Workspace {
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
      kind: "server",
      isTemporary: false,
      existsOnDisk: true,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}
```

辅助函数：

```ts
function normalizeRelativePath(value?: string): string {
  if (!value || value === "/") return ".";
  return value.replace(/\\/g, "/");
}

function getParentRelativePath(relativePath: string): string | undefined {
  if (!relativePath || relativePath === ".") return undefined;

  const parent = path.posix.dirname(relativePath.replace(/\\/g, "/"));
  return parent === "." ? "." : parent;
}

function shouldHideEntry(name: string): boolean {
  return new Set([
    ".git",
    "node_modules",
    "dist",
    "dist-server",
    "build",
    ".next",
    ".turbo",
    ".cache",
  ]).has(name);
}
```

---

# 5. 前端：去掉 root 下拉和搜索框

当前截图里有：

```txt
服务端根目录 select
搜索 input
```

全部去掉，改成更接近 GPT 的结构：

```txt
标题栏
当前路径卡片
目录列表
底部按钮
```

推荐布局：

```tsx
<Dialog>
  <div className="workspace-picker">
    <header className="workspace-picker__header">
      <div>
        <h2>选择工作区</h2>
        <p>从当前项目目录中选择一个文件夹作为工作区。</p>
      </div>
      <button className="workspace-picker__close">×</button>
    </header>

    <section className="workspace-picker__path-card">
      <div className="workspace-picker__label">当前目录</div>
      <div className="workspace-picker__path">
        /Users/wkp/workspace/haunting-souls
      </div>
    </section>

    <section className="workspace-picker__tree">...</section>

    <footer className="workspace-picker__footer">
      <button>取消</button>
      <button>刷新</button>
      <button className="primary">选择当前目录</button>
    </footer>
  </div>
</Dialog>
```

---

# 6. 前端 Hook：`useWorkspacePicker`

新增：

```txt
src/renderer/features/workspace/hooks/useWorkspacePicker.ts
```

```ts
export function useWorkspacePicker() {
  const [listing, setListing] = useState<WorkspaceDirectoryListing | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (relativePath = ".") => {
    setLoading(true);

    try {
      const result = await bridge.invoke("workspace.browse", {
        relativePath,
      });

      setListing(result);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await browse(listing?.relativePath ?? ".");
  }, [browse, listing?.relativePath]);

  const goParent = useCallback(async () => {
    if (!listing?.parentRelativePath) return;
    await browse(listing.parentRelativePath);
  }, [browse, listing?.parentRelativePath]);

  const selectCurrentDirectory = useCallback(async () => {
    const workspace = await bridge.invoke("workspace.selectDirectory", {
      relativePath: listing?.relativePath ?? ".",
    });

    return workspace;
  }, [listing?.relativePath]);

  useEffect(() => {
    void browse(".");
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
```

---

# 7. 前端组件：目录列表 UI

```tsx
export function WorkspacePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (workspace: Workspace) => void;
}) {
  const {
    listing,
    loading,
    browse,
    refresh,
    goParent,
    selectCurrentDirectory,
  } = useWorkspacePicker();

  async function handleSelect() {
    const workspace = await selectCurrentDirectory();
    onSelect(workspace);
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div className="workspace-picker-backdrop">
      <div className="workspace-picker-panel">
        <header className="workspace-picker-header">
          <div>
            <h2>选择工作区</h2>
            <p>从当前项目目录中选择 Agent 的工作目录。</p>
          </div>

          <button
            className="workspace-picker-close"
            onClick={() => onOpenChange(false)}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="workspace-picker-current">
          <span className="workspace-picker-current-label">当前目录</span>
          <span className="workspace-picker-current-path">
            {listing?.absolutePath ?? "加载中..."}
          </span>
        </div>

        <div className="workspace-picker-tree">
          {listing?.parentRelativePath && (
            <button className="workspace-picker-row" onClick={goParent}>
              <span className="workspace-picker-icon">↩</span>
              <span>返回上一级</span>
            </button>
          )}

          {loading && <div className="workspace-picker-empty">正在加载...</div>}

          {!loading &&
            listing?.entries
              .filter((entry) => entry.isDir)
              .map((entry) => (
                <button
                  key={entry.relativePath}
                  className="workspace-picker-row"
                  onClick={() => browse(entry.relativePath)}
                >
                  <span className="workspace-picker-caret">›</span>
                  <span className="workspace-picker-folder">📁</span>
                  <span className="workspace-picker-name">{entry.name}</span>
                </button>
              ))}

          {!loading &&
            listing?.entries.filter((entry) => entry.isDir).length === 0 && (
              <div className="workspace-picker-empty">
                当前目录下没有可选择的子目录
              </div>
            )}
        </div>

        <footer className="workspace-picker-footer">
          <button
            className="workspace-picker-secondary"
            onClick={() => onOpenChange(false)}
          >
            取消
          </button>

          <button className="workspace-picker-secondary" onClick={refresh}>
            刷新
          </button>

          <button className="workspace-picker-primary" onClick={handleSelect}>
            选择当前目录
          </button>
        </footer>
      </div>
    </div>
  );
}
```

---

# 8. 视觉 UI：接近 GPT 风格

核心风格：

```txt
白色大圆角弹窗
浅灰遮罩
顶部标题 + 描述
右上角圆形关闭按钮
路径用浅灰卡片展示
文件列表用 hover 行，不用厚重边框
底部按钮右对齐
主按钮黑底白字或浅灰 GPT 风格
```

CSS 示例：

```css
.workspace-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.workspace-picker-panel {
  width: min(960px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  background: #fff;
  border-radius: 28px;
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.14),
    0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.workspace-picker-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
}

.workspace-picker-header h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  font-weight: 700;
  color: #0f0f0f;
}

.workspace-picker-header p {
  margin: 8px 0 0;
  color: #6b7280;
  font-size: 15px;
}

.workspace-picker-close {
  border: 0;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #111827;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

.workspace-picker-close:hover {
  background: #e5e7eb;
}

.workspace-picker-current {
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  border-radius: 18px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.workspace-picker-current-label {
  font-size: 13px;
  color: #6b7280;
  font-weight: 600;
}

.workspace-picker-current-path {
  color: #374151;
  font-size: 15px;
  word-break: break-all;
}

.workspace-picker-tree {
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  padding: 8px;
  overflow: auto;
  min-height: 360px;
  max-height: 460px;
}

.workspace-picker-row {
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  color: #111827;
  font-size: 15px;
  text-align: left;
}

.workspace-picker-row:hover {
  background: #f3f4f6;
}

.workspace-picker-caret {
  color: #9ca3af;
  font-size: 18px;
}

.workspace-picker-folder {
  font-size: 16px;
}

.workspace-picker-name {
  font-weight: 500;
}

.workspace-picker-empty {
  color: #6b7280;
  font-size: 14px;
  padding: 24px;
  text-align: center;
}

.workspace-picker-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.workspace-picker-secondary,
.workspace-picker-primary {
  border: 0;
  border-radius: 999px;
  padding: 12px 18px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.workspace-picker-secondary {
  background: #f3f4f6;
  color: #111827;
}

.workspace-picker-secondary:hover {
  background: #e5e7eb;
}

.workspace-picker-primary {
  background: #111827;
  color: #fff;
}

.workspace-picker-primary:hover {
  background: #000;
}
```

比你截图的变化：

```txt
去掉顶部双列输入区
去掉搜索框
去掉根目录下拉
路径展示改成单独卡片
文件列表行间距更自然
关闭按钮更像 GPT 的圆形按钮
底部按钮更轻量
整体边框更淡、圆角更大、留白更充足
```

---

# 9. Conversation 创建逻辑

新建会话时：

```ts
const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(
  null,
);

async function handleCreateConversation() {
  const conversation = await bridge.invoke("conversation.create", {
    backend,
    model,
    workspaceId: selectedWorkspace?.id,
  });

  setActiveConversationId(conversation.id);
}
```

选择工作区：

```tsx
<WorkspacePickerDialog
  open={workspacePickerOpen}
  onOpenChange={setWorkspacePickerOpen}
  onSelect={(workspace) => {
    setSelectedWorkspace(workspace);
  }}
/>
```

如果没有选择工作区，后端创建临时 workspace。

---

# 10. Conversation 列表展示

保留 Codex 风格 summary：

```ts
export type ConversationSummary = {
  id: string;
  name: string;
  preview: string;
  status: ConversationStatus;
  backend: AgentBackend;
  model?: string;
  workspace: Workspace;
  createdAt: number;
  updatedAt: number;
};
```

列表项：

```tsx
function ConversationListItem({
  conversation,
}: {
  conversation: ConversationSummary;
}) {
  return (
    <button className="conversation-item">
      <div className="conversation-title">{conversation.name}</div>

      <div className="conversation-preview">
        {conversation.preview || "暂无消息"}
      </div>

      <div className="conversation-meta">
        <span>{conversation.workspace.name}</span>
        <span>{conversation.model ?? conversation.backend}</span>
        <span>{formatRelativeTime(conversation.updatedAt)}</span>
      </div>
    </button>
  );
}
```

---

# 11. 最终验收标准

```txt
1. 根目录固定为启动项目路径 process.cwd()。
2. 不再显示“服务端根目录”下拉框。
3. 不再显示搜索框。
4. workspace.browse 不再接收 rootId/search。
5. workspace.selectDirectory 不再接收 rootId。
6. 前端只展示当前路径和目录列表。
7. 点击目录进入子目录。
8. 支持返回上一级。
9. 点击选择当前目录创建或复用 workspace。
10. 所有路径都不能逃逸启动项目路径。
11. UI 视觉接近 GPT：大圆角、浅边框、轻按钮、足够留白。
12. conversation.create 使用 workspaceId。
13. AcpRuntime cwd 来自 workspaceId -> workspaces.path。
```

---

# 12. 提交拆分

```txt
feat: 固定工作区根目录为启动项目路径
```

```txt
refactor: 移除工作区搜索和根目录选择
```

```txt
feat: 优化工作区选择弹窗视觉
```

```txt
test: 补充工作区目录选择测试
```
