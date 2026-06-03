# UI 编码方案：隐藏 Teams 操作按钮 + 新 风格设置面板

## 目标

本次只做前端 UI 调整：

1. 隐藏 Teams 列表里的“更多”和“删除”入口。
2. 不删除删除团队逻辑，只从 UI 上隐藏。
3. 调整“设置”面板内容样式，使其更接近 Chat新 设置面板。
4. 不改后端接口、不改 Electron 主进程、不改远程访问业务逻辑。

---

## 一、隐藏 Teams 列表的“更多”和“删除”按钮

### 方案选择

采用 **CSS 隐藏 + 保留组件逻辑**。

原因：

1. 满足“只隐藏”的要求。
2. 不改 `onDeleteTeam` 数据流。
3. 后续如果要恢复删除入口，只需要恢复 CSS。
4. 避免误删 `TeamListItem` 里的删除状态和事件逻辑。

---

## 二、修改 Teams 条目样式

### 2.1 保留 TeamListItem 结构

文件：

```txt
src/renderer/features/teams/components/TeamListItem.tsx
```

暂时不删除这部分：

```tsx
<div className="team-menu-wrap">
  <button
    type="button"
    className="icon-button"
    aria-label={`更多操作：${team.name}`}
    ...
  >
    ⋯
  </button>

  {menuOpen ? (
    <div className="menu-popover">
      <button
        type="button"
        className="danger"
        disabled={deleting}
        ...
      >
        {deleting ? '删除中...' : '删除团队'}
      </button>
    </div>
  ) : null}
</div>
```

只通过 CSS 隐藏 `.team-menu-wrap`。

### 2.2 修改 TeamList 空状态

文件：

```txt
src/renderer/features/teams/components/TeamList.tsx
```

将：

```tsx
return <p className="muted">暂无团队。</p>;
```

改成：

```tsx
return <p className="sidebar-empty">暂无团队</p>;
```

将：

```tsx
<div className="list">
```

改成：

```tsx
<div className="sidebar-team-list">
```

---

## 三、Teams 条目改成和 Members 一样的一行样式

文件：

```txt
src/renderer/styles.css
```

### 3.1 新增 Teams 列表样式

```css
.sidebar-team-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}
```

### 3.2 覆盖 team-row

```css
.team-row {
  width: 100%;
  height: 32px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 0;
  border-radius: 8px;
  background: transparent;
  position: relative;
}

.team-row:hover {
  background: #ececec;
}

.team-row.active {
  background: #e7e7e7;
}
```

### 3.3 覆盖 team-main

```css
.team-main {
  width: 100%;
  min-width: 0;
  height: 32px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.team-main:hover,
.team-main.selected,
.team-row.active .team-main {
  background: transparent;
  border-color: transparent;
}

.team-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
}
```

### 3.4 隐藏更多和删除入口

```css
.team-menu-wrap {
  display: none;
}
```

如果希望后续可以通过一个类快速恢复，建议改成：

```css
.sidebar-hide-team-actions .team-menu-wrap {
  display: none;
}
```

然后给 Sidebar 外层加：

```tsx
<aside className="sidebar sidebar-hide-team-actions">
```

不过当前需求是直接隐藏，所以最小改法是直接 `.team-menu-wrap { display: none; }`。

---

## 四、设置弹窗改成 新 风格

当前设置面板结构是：

```tsx
<div className="modal-backdrop">
  <div className="modal settings-dialog">
    <div className="modal-header">
      <h2>设置</h2>
      <button type="button" onClick={() => setSettingsOpen(false)}>
        关闭
      </button>
    </div>

    <RemoteAccessPanel ... />
  </div>
</div>
```

建议只做轻量结构调整。

---

## 五、设置弹窗 Header 调整

文件：

```txt
src/renderer/app/Workbench.tsx
```

将：

```tsx
<div className="modal-header">
  <h2>设置</h2>
  <button type="button" onClick={() => setSettingsOpen(false)}>
    关闭
  </button>
</div>
```

改成：

```tsx
<div className="modal-header settings-dialog-header">
  <div>
    <h2>设置</h2>
    <p>管理本地服务和远程访问。</p>
  </div>

  <button
    type="button"
    className="modal-close-button"
    aria-label="关闭设置"
    onClick={() => setSettingsOpen(false)}
  >
    ×
  </button>
</div>
```

目标：

1. 标题更像 新 设置面板。
2. “关闭”文字按钮改成右上角圆形 `×`。
3. 补充一句说明，降低后台感。

---

## 六、RemoteAccessPanel 结构微调

文件：

```txt
src/renderer/features/settings/components/RemoteAccessPanel.tsx
```

### 6.1 设置卡片标题补说明

将：

```tsx
<div className="settings-card-header">
  <div>
    <h3>远程访问</h3>
  </div>
</div>
```

改成：

```tsx
<div className="settings-card-header">
  <div>
    <h3>远程访问</h3>
    <p>允许同一网络或 Tailscale 设备访问当前服务。</p>
  </div>
</div>
```

### 6.2 toggle 文案调整

将：

```tsx
<span>允许局域网/Tailscale连接</span>
```

改成：

```tsx
<span>
  <strong>允许远程访问</strong>
  <small>开启后，其他设备可通过下方地址访问。</small>
</span>
```

对应 CSS 会把它排成 新 设置项的标题 + 描述。

### 6.3 URL Row 按钮加 className

将：

```tsx
<button type="button" onClick={() => void navigator.clipboard.writeText(url)}>
  复制
</button>
```

改成：

```tsx
<button
  type="button"
  className="settings-copy-button"
  onClick={() => void navigator.clipboard.writeText(url)}
>
  复制
</button>
```

---

## 七、设置面板 CSS

文件：

```txt
src/renderer/styles.css
```

### 7.1 Modal 遮罩和容器

覆盖当前 `.modal-backdrop`、`.modal`、`.settings-dialog`：

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(8px);
}

.modal {
  width: min(520px, calc(100vw - 32px));
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 20px;
  background: #ffffff;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.18),
    0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 0;
  display: grid;
  overflow: hidden;
}

.settings-dialog {
  width: min(620px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 48px));
  overflow: hidden;
}
```

### 7.2 设置面板 Header

```css
.settings-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 16px;
  border-bottom: 1px solid #ececec;
}

.settings-dialog-header h2 {
  margin: 0;
  color: #0d0d0d;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.settings-dialog-header p {
  margin-top: 4px;
  color: #6b7280;
  font-size: 13px;
}

.modal-close-button {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #f4f4f4;
  color: #0d0d0d;
  font-size: 20px;
  line-height: 1;
}

.modal-close-button:hover {
  background: #e9e9e9;
}
```

### 7.3 设置内容区域

```css
.settings-dialog .settings-card {
  border: none;
  border-radius: 0;
  background: #ffffff;
  padding: 8px 24px 24px;
  box-shadow: none;
}

.settings-card-header {
  display: grid;
  gap: 4px;
  margin-bottom: 16px;
}

.settings-card-header h3 {
  margin: 0;
  color: #0d0d0d;
  font-size: 15px;
  font-weight: 600;
}

.settings-card-header p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}
```

### 7.4 远程访问开关行改成 新 设置项

```css
.remote-toggle-row {
  min-height: 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  margin: 0;
  padding: 14px 0;
  border-top: 1px solid #f0f0f0;
  color: #0d0d0d;
  font-size: 14px;
}

.remote-toggle-row span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.remote-toggle-row strong {
  color: #0d0d0d;
  font-size: 14px;
  font-weight: 500;
}

.remote-toggle-row small {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.4;
}

.remote-toggle-row input {
  width: 38px;
  height: 22px;
  margin: 0;
  appearance: none;
  border: none;
  border-radius: 999px;
  background: #d1d5db;
  position: relative;
  cursor: pointer;
  transition: background 120ms ease;
}

.remote-toggle-row input::before {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
  transition: transform 120ms ease;
}

.remote-toggle-row input:checked {
  background: #0d0d0d;
}

.remote-toggle-row input:checked::before {
  transform: translateX(16px);
}

.remote-toggle-row input:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
```

注意：这里把 checkbox 视觉改成 switch，但不改 input 类型，所以逻辑不变。

### 7.5 URL 列表改成设置面板信息卡

```css
.remote-url-list {
  display: grid;
  gap: 8px;
  margin: 14px 0;
}

.remote-url-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border: 1px solid #ececec;
  border-radius: 14px;
  padding: 12px;
  background: #f7f7f8;
}

.remote-url-row code {
  display: block;
  margin-top: 4px;
  color: #353740;
  word-break: break-all;
  font-size: 12px;
}

.remote-url-label {
  font-size: 12px;
  color: #6b7280;
}

.settings-copy-button {
  height: 32px;
  min-width: 56px;
  border: none;
  border-radius: 999px;
  background: #ffffff;
  color: #0d0d0d;
  padding: 0 12px;
  font-size: 13px;
}

.settings-copy-button:hover {
  background: #ececec;
}
```

### 7.6 设置面板里的提示文字

```css
.settings-dialog .muted {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.settings-dialog .error-text {
  border-radius: 12px;
  background: #fff1f0;
  color: #b42318;
  padding: 10px 12px;
  font-size: 13px;
}
```

---

## 八、避免全局 button 样式污染设置面板

当前全局 `button` 有边框、白底、6px 圆角。设置面板内需要覆盖：

```css
.settings-dialog button {
  font: inherit;
  cursor: pointer;
}

.settings-dialog button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}
```

如果其他按钮被全局 hover 变蓝，可以额外加：

```css
.settings-dialog button:hover {
  border-color: transparent;
}
```

---

## 九、验收标准

完成后检查：

```txt
1. Teams 列表右侧不再显示 ⋯ 更多按钮。
2. 用户无法从 UI 点击到“删除团队”。
3. TeamListItem 中删除逻辑仍保留，后续可恢复。
4. Teams 条目仍可点击切换。
5. Teams 条目文字过长会省略。
6. 设置面板右上角是圆形 × 按钮。
7. 设置面板整体圆角、阴影、遮罩接近 新。
8. 远程访问开关像 新 设置里的 switch。
9. URL 列表像设置项信息卡。
10. 复制按钮仍可用。
11. npm run build 通过。
```

---

## 十、推荐提交信息

```bash
git add .
git commit -m "style(ui): 隐藏团队操作入口并优化设置面板"
```

如果拆成两个提交：

```bash
git add .
git commit -m "style(team): 隐藏团队列表操作按钮"
```

```bash
git add .
git commit -m "style(settings): 优化设置面板为新风格"
```
