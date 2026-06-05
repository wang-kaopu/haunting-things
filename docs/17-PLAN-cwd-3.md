明白，范围收窄为：

> **只优化“新建/选择工作区面板”的视觉 UI；不改 Sidebar、不改 Team/Member 列表、不改 CreateTeamDialog、不改整体 Workbench 布局。**

# 最新编码方案：仅改工作区面板

## 1. 允许改动的文件

只改这些：

```txt
src/renderer/features/workspace/components/WorkspacePickerDialog.tsx
src/renderer/features/workspace/hooks/useWorkspacePicker.ts
src/renderer/styles.css
```

如果 `WorkspacePickerDialog.tsx` 已经存在，就只替换它内部结构和对应样式。

## 2. 禁止改动

不要改：

```txt
Sidebar.tsx
TeamList.tsx
SidebarAgentList.tsx
Workbench.tsx 的布局结构
CreateTeamDialog.tsx
CreateTeamInput
conversation/team 创建逻辑
app-shell / sidebar 全局布局
```

如果 `Workbench.tsx` 已经挂载了 `WorkspacePickerDialog`，不要再动它。

---

# 3. 面板目标 UI

基于你截图，改成 GPT 风格：

```txt
大圆角白色弹窗
顶部：标题 + 说明 + 圆形关闭按钮
中间：当前目录卡片
主体：简洁目录列表
底部：取消 / 刷新 / 选择当前目录
```

去掉：

```txt
服务端根目录下拉框
搜索框
大块输入区域
过重边框
```

---

# 4. `WorkspacePickerDialog.tsx` 结构

```tsx
export function WorkspacePickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (workspace: Workspace) => void;
}): React.ReactElement | null {
  const {
    listing,
    loading,
    browse,
    refresh,
    goParent,
    selectCurrentDirectory,
  } = useWorkspacePicker();

  if (!open) return null;

  async function handleSelectCurrentDirectory() {
    const workspace = await selectCurrentDirectory();
    onSelect(workspace);
  }

  const directories = listing?.entries.filter((entry) => entry.isDir) ?? [];

  return (
    <div
      className="workspace-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="workspace-picker-panel"
        role="dialog"
        aria-modal="true"
      >
        <header className="workspace-picker-header">
          <div>
            <h2>选择工作区</h2>
            <p>从当前项目目录中选择 Agent 的工作目录。</p>
          </div>

          <button
            type="button"
            className="workspace-picker-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <section className="workspace-picker-current">
          <span>当前目录</span>
          <strong>{listing?.absolutePath ?? "加载中..."}</strong>
        </section>

        <section className="workspace-picker-tree">
          {listing?.parentRelativePath ? (
            <button
              type="button"
              className="workspace-picker-row"
              onClick={goParent}
            >
              <span className="workspace-picker-row-icon">↩</span>
              <span className="workspace-picker-row-name">返回上一级</span>
            </button>
          ) : null}

          {loading ? (
            <div className="workspace-picker-empty">正在加载...</div>
          ) : null}

          {!loading &&
            directories.map((entry) => (
              <button
                key={entry.relativePath}
                type="button"
                className="workspace-picker-row"
                onClick={() => browse(entry.relativePath)}
              >
                <span className="workspace-picker-chevron">›</span>
                <span className="workspace-picker-row-icon">📁</span>
                <span className="workspace-picker-row-name">{entry.name}</span>
              </button>
            ))}

          {!loading && directories.length === 0 ? (
            <div className="workspace-picker-empty">
              当前目录下没有可进入的子目录
            </div>
          ) : null}
        </section>

        <footer className="workspace-picker-footer">
          <button
            type="button"
            className="workspace-picker-button secondary"
            onClick={onClose}
          >
            取消
          </button>

          <button
            type="button"
            className="workspace-picker-button secondary"
            onClick={refresh}
          >
            刷新
          </button>

          <button
            type="button"
            className="workspace-picker-button primary"
            onClick={handleSelectCurrentDirectory}
          >
            选择当前目录
          </button>
        </footer>
      </section>
    </div>
  );
}
```

---

# 5. `useWorkspacePicker.ts`

保持业务逻辑简单，不加搜索、不加 rootId。

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

  const refresh = useCallback(() => {
    return browse(listing?.relativePath ?? ".");
  }, [browse, listing?.relativePath]);

  const goParent = useCallback(() => {
    if (!listing?.parentRelativePath) return;
    return browse(listing.parentRelativePath);
  }, [browse, listing?.parentRelativePath]);

  const selectCurrentDirectory = useCallback(async () => {
    return bridge.invoke("workspace.selectDirectory", {
      relativePath: listing?.relativePath ?? ".",
    });
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

# 6. 只新增专属 CSS，不改其他全局组件

放到 `styles.css` 末尾，所有类名前缀都用 `workspace-picker-`，避免影响其他弹窗。

```css
.workspace-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.18);
}

.workspace-picker-panel {
  width: min(920px, 100%);
  max-height: min(760px, calc(100vh - 56px));
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px;
  border-radius: 28px;
  background: #ffffff;
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.14),
    0 2px 8px rgba(0, 0, 0, 0.06);
}

.workspace-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.workspace-picker-header h2 {
  margin: 0;
  color: #0d0d0d;
  font-size: 28px;
  line-height: 1.2;
  font-weight: 700;
}

.workspace-picker-header p {
  margin: 8px 0 0;
  color: #6b7280;
  font-size: 15px;
}

.workspace-picker-close {
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  display: grid;
  place-items: center;
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
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  background: #f9fafb;
}

.workspace-picker-current span {
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
}

.workspace-picker-current strong {
  min-width: 0;
  color: #374151;
  font-size: 15px;
  font-weight: 500;
  word-break: break-all;
}

.workspace-picker-tree {
  min-height: 360px;
  max-height: 460px;
  overflow: auto;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  background: #ffffff;
}

.workspace-picker-row {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 14px;
  display: grid;
  grid-template-columns: 18px 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  background: transparent;
  color: #111827;
  text-align: left;
  cursor: pointer;
}

.workspace-picker-row:hover {
  background: #f3f4f6;
}

.workspace-picker-chevron {
  color: #9ca3af;
  font-size: 18px;
}

.workspace-picker-row-icon {
  display: inline-grid;
  place-items: center;
  font-size: 16px;
}

.workspace-picker-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-picker-empty {
  padding: 28px;
  color: #6b7280;
  text-align: center;
  font-size: 14px;
}

.workspace-picker-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.workspace-picker-button {
  min-width: 92px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  padding: 0 18px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.workspace-picker-button.secondary {
  background: #f3f4f6;
  color: #111827;
}

.workspace-picker-button.secondary:hover {
  background: #e5e7eb;
}

.workspace-picker-button.primary {
  background: #111827;
  color: #ffffff;
}

.workspace-picker-button.primary:hover {
  background: #000000;
}
```

---

# 7. 本次不做的内容

```txt
不改 sidebar
不改 app-shell
不改 teams/members 排列
不改 CreateTeamDialog
不改 conversation/team 创建逻辑
不改移动端侧栏
不新增 activeWorkspace 状态
不改现有工作区入口位置
```

只要现有入口能打开工作区弹窗，就只优化弹窗本身。

---

# 8. 提交信息

```txt
style: 优化工作区选择面板视觉
```

如果同时整理了 hook：

```txt
refactor: 简化工作区选择面板逻辑
```
