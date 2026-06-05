结合 `feat/cwd` 当前代码，建议把**设置面板**和**新建工作区面板**统一成截图这种 ChatGPT 设置页风格：左侧窄导航，右侧内容区，左上角关闭按钮，右侧顶部标题，内容按一行一行的 setting row 展示。

当前代码里，`Workbench` 已经同时挂载了 `WorkspacePickerDialog` 和 `SettingsDialog`，所以不需要改 Sidebar，也不需要动 Workbench 主布局。只需要重构这两个弹窗的内部结构和共用样式即可。

---

# 1. 改造范围

只改这些文件：

```txt
src/renderer/features/settings/components/SettingsDialog.tsx
src/renderer/features/settings/components/SettingsPanel.tsx
src/renderer/features/settings/components/RemoteAccessSetting.tsx
src/renderer/features/workspace/WorkspacePickerDialog.tsx
src/renderer/styles.css
```

可选新增一个共享组件：

```txt
src/renderer/shared/components/PreferenceDialogShell.tsx
```

不改：

```txt
Sidebar.tsx
TeamList.tsx
Workbench.tsx 主布局
CreateTeamDialog.tsx
conversation/team 创建逻辑
后端 workspace API
```

---

# 2. 当前状态判断

`SettingsDialog` 当前是一个传统居中弹窗：`settings-overlay -> settings-dialog -> header -> SettingsPanel`。

`SettingsPanel` 目前只有一个“通用”分组，并且只挂了 `RemoteAccessSetting`。

`RemoteAccessSetting` 已经是“设置项 + 右侧 switch + 下方说明”的结构，很适合改成截图里的 row 风格。

`WorkspacePickerDialog` 目前已经复用了 `settings-overlay/settings-dialog/settings-dialog-header/settings-panel` 这套样式，所以它和设置面板统一风格的成本很低。

---

# 3. 抽一个统一外壳：`PreferenceDialogShell`

新增：

```txt
src/renderer/shared/components/PreferenceDialogShell.tsx
```

```tsx
import type React from "react";

export type PreferenceDialogNavItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
};

export type PreferenceDialogShellProps = {
  open: boolean;
  title: string;
  navItems: PreferenceDialogNavItem[];
  activeNavId: string;
  onActiveNavChange?: (id: string) => void;
  onClose: () => void;
  children: React.ReactNode;
};

export function PreferenceDialogShell({
  open,
  title,
  navItems,
  activeNavId,
  onActiveNavChange,
  onClose,
  children,
}: PreferenceDialogShellProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <div className="preference-overlay" role="presentation">
      <section className="preference-dialog" role="dialog" aria-modal="true">
        <aside className="preference-nav">
          <button
            type="button"
            className="preference-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>

          <nav className="preference-nav-list">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === activeNavId
                    ? "preference-nav-item active"
                    : "preference-nav-item"
                }
                onClick={() => onActiveNavChange?.(item.id)}
              >
                <span className="preference-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="preference-main">
          <header className="preference-main-header">
            <h2>{title}</h2>
          </header>

          <div className="preference-main-content">{children}</div>
        </main>
      </section>
    </div>
  );
}
```

这个结构对应截图：

```txt
preference-overlay
  preference-dialog
    preference-nav      左侧导航 + 关闭按钮
    preference-main     右侧标题 + 设置行内容
```

---

# 4. SettingsDialog 改造

当前 `SettingsDialog` 负责标题、说明、关闭按钮和挂载 `SettingsPanel`。 改成使用统一 shell。

```tsx
import type React from "react";
import type { ServerInfo } from "@shared/types";
import { PreferenceDialogShell } from "@renderer/shared/components/PreferenceDialogShell";
import { SettingsPanel } from "@renderer/features/settings/components/SettingsPanel";

export function SettingsDialog({
  open,
  serverInfo,
  loading,
  error,
  onClose,
  onSetRemoteAccess,
}: SettingsDialogProps): React.ReactElement | null {
  return (
    <PreferenceDialogShell
      open={open}
      title="常规"
      activeNavId="general"
      onClose={onClose}
      navItems={[
        { id: "general", label: "常规", icon: "⚙️" },
        { id: "network", label: "访问", icon: "🌐" },
        { id: "data", label: "数据管理", icon: "▣" },
      ]}
    >
      <SettingsPanel
        serverInfo={serverInfo}
        loading={loading}
        error={error}
        onSetRemoteAccess={onSetRemoteAccess}
      />
    </PreferenceDialogShell>
  );
}
```

目前只有一个真实设置项，所以 `network/data` 可以先禁用或不渲染。更保守的版本只放一个 nav item：

```tsx
navItems={[{ id: 'general', label: '常规', icon: '⚙️' }]}
```

---

# 5. SettingsPanel 改造成 row 布局

当前 `SettingsPanel` 是：

```tsx
<div className="settings-panel">
  <section className="settings-section">
    <h3>通用</h3>
    <RemoteAccessSetting />
  </section>
</div>
```

改成截图式 rows：

```tsx
export function SettingsPanel({
  serverInfo,
  loading,
  error,
  onSetRemoteAccess,
}: SettingsPanelProps): React.ReactElement {
  return (
    <div className="preference-section">
      <RemoteAccessSetting
        serverInfo={serverInfo}
        loading={loading}
        error={error}
        onSetRemoteAccess={onSetRemoteAccess}
      />
    </div>
  );
}
```

---

# 6. RemoteAccessSetting 改成截图中的一行设置

当前 `RemoteAccessSetting` 已经有 `settings-item-main`、`settings-item-copy`、`settings-switch`，只需要类名切到统一 row。

```tsx
return (
  <div className="preference-row preference-row--stackable">
    <div className="preference-row-main">
      <div>
        <strong>远程访问</strong>
        <p>允许同一网络或 Tailscale 设备访问当前服务。</p>
      </div>

      <label className="preference-switch" aria-label="远程访问">
        <input
          type="checkbox"
          checked={allowRemote}
          disabled={!serverInfo || switching}
          onChange={(event) =>
            void onSetRemoteAccess(event.currentTarget.checked)
          }
        />
        <span aria-hidden="true" />
      </label>
    </div>

    {error ? <p className="preference-error">{error}</p> : null}

    {!serverInfo ? (
      <p className="preference-muted">正在读取服务信息...</p>
    ) : null}

    {serverInfo?.restarting ? (
      <p className="preference-muted">正在切换监听地址...</p>
    ) : null}

    {serverInfo && allowRemote && urls.length > 0 ? (
      <div className="preference-row-detail">
        <div className="remote-url-list">
          {urls.map((url) => (
            <RemoteUrlRow key={url} url={url} />
          ))}
        </div>

        <p className="preference-muted">
          在其他设备浏览器中打开以上地址，然后使用当前账号密码登录。
        </p>
      </div>
    ) : null}
  </div>
);
```

---

# 7. WorkspacePickerDialog 也改成同一个 shell

当前 `WorkspacePickerDialog` 已经调用 `useWorkspacePicker()`，有 listing/loading/error/browse/refresh/goParent/selectCurrentDirectory，业务逻辑可以完全保留。 `useWorkspacePicker` 也已经只使用 `workspace.browse({ relativePath })` 和 `workspace.selectDirectory({ relativePath })`，不用改后端。

只改结构：

```tsx
import type React from "react";
import type { Workspace } from "@shared/types";
import { PreferenceDialogShell } from "@renderer/shared/components/PreferenceDialogShell";
import { useWorkspacePicker } from "@renderer/features/workspace/hooks/useWorkspacePicker";

export function WorkspacePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: WorkspacePickerDialogProps): React.ReactElement | null {
  const {
    listing,
    loading,
    error,
    browse,
    refresh,
    goParent,
    selectCurrentDirectory,
  } = useWorkspacePicker();

  async function handleSelect(): Promise<void> {
    const workspace = await selectCurrentDirectory();
    onSelect(workspace);
    onOpenChange(false);
  }

  const directories = listing?.entries.filter((entry) => entry.isDir) ?? [];

  return (
    <PreferenceDialogShell
      open={open}
      title="新建工作区"
      activeNavId="workspace"
      onClose={() => onOpenChange(false)}
      navItems={[{ id: "workspace", label: "工作区", icon: "▣" }]}
    >
      <div className="preference-section">
        <div className="preference-row preference-row--stackable">
          <div className="preference-row-main">
            <div>
              <strong>当前目录</strong>
              <p>{listing?.absolutePath ?? "加载中..."}</p>
            </div>

            <button
              type="button"
              className="preference-pill-button"
              onClick={() => void refresh()}
              disabled={loading}
            >
              刷新
            </button>
          </div>
        </div>

        {error ? <p className="preference-error">{error}</p> : null}

        <div className="workspace-directory-list">
          {listing?.parentRelativePath ? (
            <button
              type="button"
              className="workspace-directory-row"
              onClick={() => void goParent()}
            >
              <span className="workspace-directory-icon">↩</span>
              <span>返回上一级</span>
            </button>
          ) : null}

          {loading ? (
            <div className="workspace-directory-empty">正在加载...</div>
          ) : null}

          {!loading &&
            directories.map((entry) => (
              <button
                key={entry.relativePath}
                type="button"
                className="workspace-directory-row"
                onClick={() => void browse(entry.relativePath)}
              >
                <span className="workspace-directory-caret">›</span>
                <span
                  className="workspace-directory-folder"
                  aria-hidden="true"
                />
                <span className="workspace-directory-name">{entry.name}</span>
              </button>
            ))}

          {!loading && directories.length === 0 ? (
            <div className="workspace-directory-empty">
              当前目录下没有可选择的子目录
            </div>
          ) : null}
        </div>

        <div className="preference-actions">
          <button
            type="button"
            className="preference-secondary-button"
            onClick={() => onOpenChange(false)}
          >
            取消
          </button>

          <button
            type="button"
            className="preference-primary-button"
            onClick={() => void handleSelect()}
            disabled={loading}
          >
            新建当前目录工作区
          </button>
        </div>
      </div>
    </PreferenceDialogShell>
  );
}
```

这样两个面板视觉完全统一：

```txt
设置面板：左侧 常规，右侧 常规 rows
工作区面板：左侧 工作区，右侧 新建工作区 rows + directory list
```

---

# 8. CSS：新增统一 Preference 样式

当前 `styles.css` 已经有一套 `settings-overlay/settings-dialog/settings-panel/settings-item/settings-switch`，还有 workspace picker 样式。

建议不要在旧样式上继续叠，而是新增一套统一前缀：

```css
/* ================================================================
   Preference Dialog — ChatGPT 设置页风格
   ================================================================ */

.preference-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: #ffffff;
  color: #0d0d0d;
}

.preference-dialog {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  background: #ffffff;
}

.preference-nav {
  position: relative;
  padding: 104px 24px 24px 0;
  border-right: 0;
  background: #ffffff;
}

.preference-close {
  position: absolute;
  top: 28px;
  left: 26px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: transparent;
  color: #111111;
  font-size: 34px;
  line-height: 1;
  cursor: pointer;
}

.preference-close:hover {
  background: #f4f4f4;
}

.preference-nav-list {
  display: grid;
  gap: 6px;
}

.preference-nav-item {
  width: 100%;
  height: 56px;
  border: 0;
  border-radius: 0 14px 14px 0;
  background: transparent;
  color: #111111;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  text-align: left;
  font-size: 20px;
  font-weight: 500;
  cursor: pointer;
}

.preference-nav-item:hover {
  background: #f7f7f8;
}

.preference-nav-item.active {
  background: #f1f1f1;
}

.preference-nav-icon {
  width: 28px;
  display: inline-grid;
  place-items: center;
  font-size: 22px;
}

.preference-main {
  min-width: 0;
  height: 100%;
  overflow: auto;
  padding: 20px 64px 64px 42px;
}

.preference-main-header {
  max-width: 920px;
  height: 84px;
  display: flex;
  align-items: flex-start;
  border-bottom: 1px solid #e9e9e9;
}

.preference-main-header h2 {
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.preference-main-content {
  max-width: 920px;
}

.preference-section {
  display: grid;
}

.preference-row {
  border-bottom: 1px solid #eeeeee;
  padding: 28px 0;
}

.preference-row-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: center;
}

.preference-row strong {
  display: block;
  color: #111111;
  font-size: 21px;
  line-height: 1.35;
  font-weight: 500;
}

.preference-row p {
  margin-top: 6px;
  color: #8a8a8a;
  font-size: 17px;
  line-height: 1.45;
}

.preference-muted {
  margin: 8px 0 0;
  color: #8a8a8a;
  font-size: 15px;
  line-height: 1.45;
}

.preference-error {
  margin: 14px 0 0;
  border-radius: 14px;
  background: #fff1f0;
  color: #b42318;
  padding: 12px 14px;
  font-size: 15px;
}

.preference-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 24px;
}

.preference-primary-button,
.preference-secondary-button,
.preference-pill-button {
  height: 44px;
  border: 0;
  border-radius: 999px;
  padding: 0 18px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.preference-primary-button {
  background: #111111;
  color: #ffffff;
}

.preference-primary-button:hover {
  background: #000000;
}

.preference-secondary-button,
.preference-pill-button {
  background: #f1f1f1;
  color: #111111;
}

.preference-secondary-button:hover,
.preference-pill-button:hover {
  background: #e7e7e7;
}
```

---

# 9. Switch 统一成截图风格

替代旧 `.settings-switch`，新增 `.preference-switch`：

```css
.preference-switch {
  display: inline-flex;
  align-items: center;
}

.preference-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.preference-switch span {
  width: 64px;
  height: 36px;
  border-radius: 999px;
  background: #e5e5e5;
  position: relative;
  cursor: pointer;
  transition: background 120ms ease;
}

.preference-switch span::before {
  content: "";
  position: absolute;
  top: 4px;
  left: 4px;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: transform 120ms ease;
}

.preference-switch input:checked + span {
  background: #0d8cff;
}

.preference-switch input:checked + span::before {
  transform: translateX(28px);
}

.preference-switch input:disabled + span {
  cursor: not-allowed;
  opacity: 0.5;
}
```

截图里的开关是蓝色大 toggle，所以这里不用黑色。

---

# 10. Workspace 目录列表也改成 setting 风格

```css
.workspace-directory-list {
  margin-top: 18px;
  min-height: 320px;
  max-height: min(460px, calc(100vh - 340px));
  overflow: auto;
  padding: 8px 0;
  border-bottom: 1px solid #eeeeee;
}

.workspace-directory-row {
  width: 100%;
  min-height: 52px;
  border: 0;
  border-radius: 12px;
  display: grid;
  grid-template-columns: 24px 24px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: transparent;
  color: #111111;
  text-align: left;
  cursor: pointer;
}

.workspace-directory-row:hover {
  background: #f4f4f4;
}

.workspace-directory-caret,
.workspace-directory-icon {
  color: #111111;
  font-size: 16px;
  text-align: center;
}

.workspace-directory-folder {
  width: 18px;
  height: 14px;
  position: relative;
  flex: 0 0 18px;
  border: 2px solid #111111;
  border-radius: 4px;
}

.workspace-directory-folder::before {
  content: "";
  position: absolute;
  left: 2px;
  top: -6px;
  width: 8px;
  height: 6px;
  border: 2px solid #111111;
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
}

.workspace-directory-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #111111;
  font-size: 18px;
  font-weight: 500;
}

.workspace-directory-empty {
  padding: 40px 12px;
  color: #8a8a8a;
  text-align: center;
  font-size: 16px;
}
```

---

# 11. 旧样式处理

保留旧 `.settings-*` 和 `.workspace-picker-*` 不会马上出问题，但为了避免样式冲突，建议后续删除或停止使用这些旧 class：

```txt
settings-overlay
settings-dialog
settings-dialog-header
settings-panel
settings-section
settings-item
settings-switch
workspace-picker-dialog
workspace-picker-body
workspace-picker-browser
workspace-picker-tree
workspace-picker-row
workspace-picker-footer
workspace-picker-primary
workspace-picker-secondary
```

本次改造后，新 UI 应只使用：

```txt
preference-*
workspace-directory-*
remote-url-*
```

---

# 12. 响应式

截图是桌面宽屏，移动端可以把左侧导航变成顶部横向：

```css
@media (max-width: 760px) {
  .preference-dialog {
    grid-template-columns: 1fr;
  }

  .preference-nav {
    padding: 72px 16px 8px;
  }

  .preference-nav-list {
    display: flex;
    overflow-x: auto;
    gap: 8px;
  }

  .preference-nav-item {
    width: auto;
    min-width: max-content;
    height: 44px;
    border-radius: 999px;
    grid-template-columns: auto auto;
    font-size: 15px;
    padding: 0 14px;
  }

  .preference-main {
    padding: 16px 20px 32px;
  }

  .preference-main-header {
    height: 56px;
  }

  .preference-main-header h2 {
    font-size: 24px;
  }

  .preference-row strong {
    font-size: 18px;
  }

  .preference-row p {
    font-size: 15px;
  }
}
```

---

# 13. 提交拆分

```txt
refactor: 抽取偏好设置弹窗外壳
```

```txt
style: 统一设置和工作区面板视觉
```

```txt
style: 调整设置项为 ChatGPT 行式布局
```

如果只做一次提交：

```txt
style: 统一设置与工作区面板视觉
```

---

# 14. 验收标准

```txt
1. 设置面板和新建工作区面板都使用同一套 preference-* 外壳。
2. 视觉结构接近截图：左侧导航、左上角关闭、右侧标题、行式内容。
3. 设置面板标题显示“常规”。
4. 工作区面板标题显示“新建工作区”。
5. 远程访问开关是大号蓝色 toggle。
6. 工作区目录列表在右侧内容区，以 row 形式展示。
7. 不改 Sidebar。
8. 不改 Workbench 主布局。
9. 不改后端 workspace API。
10. 不改 conversation/team 创建逻辑。
```

一句话总结：把 `SettingsDialog` 和 `WorkspacePickerDialog` 都迁到同一个 `PreferenceDialogShell`，用 `preference-*` 样式实现截图里的 ChatGPT 设置页视觉；设置内容和工作区目录浏览只作为右侧内容区的不同页面。
