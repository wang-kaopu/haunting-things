# haunting-things 设置面板与发送框控件重构编码方案

## 目标

本次只改前端 UI 和组件结构，不改后端协议，不改消息发送逻辑，不改远程访问业务逻辑。

需要完成：

1. 将“远程访问面板”改造成真正的“设置面板”，远程访问只是设置中的一条。
2. 重新排列消息发送框小组件，使其接近 GPT 网页版。
3. 将“发送”按钮改成圆形图标按钮。
4. 下拉框组件自己实现，不再使用浏览器默认 `<select>`。
5. 统一模型、权限、命令等选择器风格。

---

## 一、设置面板结构重构

### 1.1 当前问题

当前设置弹窗结构大概是：

```tsx
{
  settingsOpen ? (
    <div className="modal-backdrop">
      <div className="modal settings-dialog">
        <div className="modal-header">
          <h2>设置</h2>
          <button>关闭</button>
        </div>

        <RemoteAccessPanel />
      </div>
    </div>
  ) : null;
}
```

这会导致“远程访问”看起来就是整个设置面板，而不是设置面板中的一条设置项。

### 1.2 目标结构

改成：

```txt
SettingsDialog
└── SettingsPanel
    ├── SettingsSection
    │   └── RemoteAccessSetting
    └── 以后可以继续增加：
        ├── AppearanceSetting
        ├── LanguageSetting
        ├── AccountSetting
        └── AboutSetting
```

视觉目标接近 GPT 设置页：

```txt
设置
管理应用偏好和连接方式。

通用
远程访问                         [开关]
允许同一网络或 Tailscale 设备访问当前服务。

展开后：
局域网地址    http://...
Tailscale     http://...
说明文字
```

---

## 二、新增 SettingsDialog

新建文件：

```txt
src/renderer/features/settings/components/SettingsDialog.tsx
```

代码：

```tsx
import type React from "react";
import type { ServerInfo } from "../../../../shared/types";
import { SettingsPanel } from "./SettingsPanel";

export type SettingsDialogProps = {
  open: boolean;
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

export function SettingsDialog({
  open,
  serverInfo,
  loading,
  error,
  onClose,
  onSetRemoteAccess,
}: SettingsDialogProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <div className="settings-overlay" role="presentation">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-dialog-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p>管理应用偏好、访问方式和运行环境。</p>
          </div>

          <button
            type="button"
            className="settings-close-button"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <SettingsPanel
          serverInfo={serverInfo}
          loading={loading}
          error={error}
          onSetRemoteAccess={onSetRemoteAccess}
        />
      </section>
    </div>
  );
}
```

---

## 三、新增 SettingsPanel

新建文件：

```txt
src/renderer/features/settings/components/SettingsPanel.tsx
```

代码：

```tsx
import type React from "react";
import type { ServerInfo } from "../../../../shared/types";
import { RemoteAccessSetting } from "./RemoteAccessSetting";

export type SettingsPanelProps = {
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

export function SettingsPanel({
  serverInfo,
  loading,
  error,
  onSetRemoteAccess,
}: SettingsPanelProps): React.ReactElement {
  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3>通用</h3>

        <RemoteAccessSetting
          serverInfo={serverInfo}
          loading={loading}
          error={error}
          onSetRemoteAccess={onSetRemoteAccess}
        />
      </section>
    </div>
  );
}
```

---

## 四、将 RemoteAccessPanel 改为 RemoteAccessSetting

### 4.1 文件处理

可以选择重命名：

```txt
src/renderer/features/settings/components/RemoteAccessPanel.tsx
↓
src/renderer/features/settings/components/RemoteAccessSetting.tsx
```

也可以先新建 `RemoteAccessSetting.tsx`，保留旧文件，确认无引用后再删除旧文件。

### 4.2 新组件结构

```tsx
import type React from "react";
import type { ServerInfo } from "../../../../shared/types";

export type RemoteAccessSettingProps = {
  serverInfo: ServerInfo | null;
  loading?: boolean;
  error?: string;
  onSetRemoteAccess: (allowRemote: boolean) => Promise<void>;
};

export function RemoteAccessSetting({
  serverInfo,
  loading,
  error,
  onSetRemoteAccess,
}: RemoteAccessSettingProps): React.ReactElement {
  const urls = Array.isArray(serverInfo?.urls) ? serverInfo.urls : [];
  const allowRemote = serverInfo?.allowRemote ?? false;
  const switching = loading || serverInfo?.restarting;

  return (
    <div className="settings-item settings-item-remote">
      <div className="settings-item-main">
        <div className="settings-item-copy">
          <strong>远程访问</strong>
          <span>允许同一网络或 Tailscale 设备访问当前服务。</span>
        </div>

        <label className="settings-switch" arialabel-label="远程访问">
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

      {error ? <p className="settings-error">{error}</p> : null}

      {!serverInfo ? (
        <p className="settings-muted">正在读取服务信息...</p>
      ) : null}

      {serverInfo?.restarting ? (
        <p className="settings-muted">正在切换监听地址...</p>
      ) : null}

      {serverInfo && allowRemote && urls.length > 0 ? (
        <div className="settings-item-detail">
          <div className="remote-url-list">
            {urls.map((url) => (
              <RemoteUrlRow key={url} url={url} />
            ))}
          </div>

          <p className="settings-muted">
            在其他设备浏览器中打开以上地址，然后使用当前账号密码登录。
          </p>
          <p className="settings-muted">
            切换远程访问会短暂重启 HTTP/WebSocket 监听，页面会自动重连。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RemoteUrlRow({ url }: { url: string }): React.ReactElement {
  return (
    <div className="remote-url-row">
      <div>
        <span className="remote-url-label">{formatRemoteUrlLabel(url)}</span>
        <code>{url}</code>
      </div>

      <button
        type="button"
        className="settings-copy-button"
        onClick={() => void navigator.clipboard.writeText(url)}
      >
        复制
      </button>
    </div>
  );
}

function formatRemoteUrlLabel(url: string): string {
  try {
    const { hostname } = new URL(url);

    if (isTailscaleIp(hostname)) {
      return "Tailscale";
    }

    return "局域网";
  } catch {
    return "访问地址";
  }
}

function isTailscaleIp(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}
```

---

## 五、Workbench 接入 SettingsDialog

修改文件：

```txt
src/renderer/app/Workbench.tsx
```

### 5.1 删除 RemoteAccessPanel import

删除：

```ts
import { RemoteAccessPanel } from "../features/settings/components/RemoteAccessPanel";
```

新增：

```ts
import { SettingsDialog } from "../features/settings/components/SettingsDialog";
```

### 5.2 替换 settingsOpen 渲染块

删除原来的：

```tsx
{
  settingsOpen ? (
    <div className="modal-backdrop">
      <div className="modal settings-dialog">
        ...
        <RemoteAccessPanel />
      </div>
    </div>
  ) : null;
}
```

替换为：

```tsx
<SettingsDialog
  open={settingsOpen}
  serverInfo={serverInfo}
  loading={serverInfoLoading}
  error={serverInfoError}
  onClose={() => setSettingsOpen(false)}
  onSetRemoteAccess={setRemoteAccess}
/>
```

---

## 六、自制 CustomSelect 组件

### 6.1 新建组件

新建：

```txt
src/renderer/shared/components/CustomSelect.tsx
```

代码：

```tsx
import { useEffect, useId, useRef, useState } from "react";
import type React from "react";

export type CustomSelectOption = {
  value: string;
  label: string;
  description?: string;
  danger?: boolean;
  disabled?: boolean;
};

export type CustomSelectProps = {
  value: string;
  options: CustomSelectOption[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  onChange: (value: string) => void;
};

export function CustomSelect({
  value,
  options,
  placeholder = "选择",
  ariaLabel,
  disabled,
  className = "",
  compact,
  onChange,
}: CustomSelectProps): React.ReactElement {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);
  const label = (selected?.label ?? value) || placeholder;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function selectValue(nextValue: string): void {
    if (disabled) return;
    const option = options.find((item) => item.value === nextValue);
    if (!option || option.disabled) return;

    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={`custom-select ${compact ? "compact" : ""} ${open ? "open" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="custom-select-label">{label}</span>
        <span className="custom-select-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      {open ? (
        <div
          id={`${id}-listbox`}
          className="custom-select-popover"
          role="listbox"
        >
          {options.length === 0 ? (
            <div className="custom-select-empty">暂无选项</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`custom-select-option ${option.value === value ? "selected" : ""} ${option.danger ? "danger" : ""}`.trim()}
                disabled={option.disabled}
                onClick={() => selectValue(option.value)}
              >
                <span className="custom-select-option-label">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="custom-select-option-desc">
                    {option.description}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
```

### 6.2 说明

这个组件只用原生 React 实现：

```txt
button + popover + option button
```

不再使用机器默认 `<select>`。

支持：

```txt
1. 当前值显示
2. 禁用状态
3. 选中态
4. 描述文字
5. 危险选项
6. 点击外部关闭
7. Escape 关闭
8. 统一 GPT 风格样式
```

---

## 七、ModelPicker 改用 CustomSelect

修改文件：

```txt
src/renderer/features/chat/components/ModelPicker.tsx
```

引入：

```ts
import { CustomSelect } from "../../../shared/components/CustomSelect";
```

替换原来的 `<label><select>...</select></label>`：

```tsx
<CustomSelect
  compact
  className="model-select"
  ariaLabel="模型"
  value={selectedValue}
  placeholder="默认模型"
  disabled={!agent || !hasOptions || submitting}
  options={[
    ...(!current || !hasOptions
      ? [{ value: "", label: "默认模型", disabled: true }]
      : []),
    ...(current && !options.some((model) => model.id === current)
      ? [{ value: current, label: current }]
      : []),
    ...options.map((model) => ({
      value: model.id,
      label: model.name || model.id,
    })),
  ]}
  onChange={(nextValue) => {
    void submit(nextValue);
  }}
/>
```

保留错误提示：

```tsx
{
  error ? (
    <p className="error-text compact toolbar-select-error">{error}</p>
  ) : null;
}
```

---

## 八、PermissionModePicker 改用 CustomSelect

修改文件：

```txt
src/renderer/features/chat/components/PermissionModePicker.tsx
```

引入：

```ts
import { CustomSelect } from "../../../shared/components/CustomSelect";
```

替换原来的 `<select>`：

```tsx
<CustomSelect
  compact
  className="permission-mode-select"
  ariaLabel="权限模式"
  value={current}
  placeholder="权限"
  disabled={!agent || options.length === 0 || submitting}
  options={[
    ...options.map((option) => ({
      value: option.id,
      label: option.label,
      description: option.description,
      danger: option.danger,
    })),
    ...(!options.some((option) => option.id === current)
      ? [{ value: current, label: current }]
      : []),
  ]}
  onChange={(nextValue) => {
    void submit(nextValue);
  }}
/>
```

危险模式二次确认逻辑保留在 `submit` 内，不移到 `CustomSelect`。

---

## 九、AgentCommandsMenu 改用 CustomSelect

修改文件：

```txt
src/renderer/features/chat/components/AgentCommandsMenu.tsx
```

引入：

```ts
import { CustomSelect } from "../../../shared/components/CustomSelect";
```

替换原来的 `<select>`：

```tsx
<CustomSelect
  compact
  className="command-select"
  ariaLabel="命令"
  value=""
  placeholder="命令"
  disabled={disabled || count === 0}
  options={commandList.map((command) => ({
    value: command.name,
    label: `/${command.name}`,
  }))}
  onChange={(nextValue) => {
    selectCommand(nextValue);
  }}
/>
```

---

## 十、重新排列 ComposerTools

### 10.1 目标顺序

接近 GPT 网页版：

```txt
输入框
底部工具栏：
左侧：附件图标  模型选择  权限模式  命令
右侧：发送按钮
```

### 10.2 修改 ComposerTools 顺序

修改文件：

```txt
src/renderer/features/chat/components/ComposerTools.tsx
```

将顺序改为：

```tsx
export function ComposerTools({
  activeAgent,
  commands,
  models,
  mode,
  imagePicker,
  disabled,
  onSelectCommand,
  onSetModel,
  onSetMode,
}: ComposerToolsProps): React.ReactElement {
  return (
    <div className="composer-tools">
      {imagePicker}
      <ModelPicker
        agent={activeAgent}
        models={models}
        onSetModel={onSetModel}
      />
      <PermissionModePicker
        agent={activeAgent}
        mode={mode}
        onSetMode={onSetMode}
      />
      <AgentCommandsMenu
        commands={commands}
        disabled={disabled}
        onSelectCommand={onSelectCommand}
      />
    </div>
  );
}
```

---

## 十一、ImageAttachmentPicker 改成图标按钮

修改文件：

```txt
src/renderer/features/chat/components/ImageAttachmentPicker.tsx
```

替换按钮内容：

```tsx
<button
  type="button"
  className="composer-icon-button image-picker-button"
  disabled={disabled || uploading}
  onClick={() => inputRef.current?.click()}
  aria-label={uploading ? "图片上传中" : "添加图片"}
  title={uploading ? "图片上传中" : "添加图片"}
>
  {uploading ? "…" : "+"}
</button>
```

说明：

```txt
使用 + 号代替“添加图片”
后续可以换成 paperclip / image svg
先不用引入图标库
```

---

## 十二、SendBox 结构调整

修改文件：

```txt
src/renderer/features/chat/components/SendBox.tsx
```

### 12.1 增加 composer-inner

将：

```tsx
<div className="composer">...</div>
```

改成：

```tsx
<div className="composer">
  <div className="composer-inner">
    <ImageAttachmentPreview
      attachments={attachments}
      onRemove={(id) => void removeAttachment(id)}
    />

    <textarea
      ref={textareaRef}
      value={content}
      disabled={disabled || sending}
      placeholder={disabled ? "请选择团队" : "给团队发送消息"}
      onChange={(event) => setContent(event.target.value)}
      onPaste={(event) => void handlePaste(event)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void submit();
        }
      }}
    />

    <div className="composer-footer">
      <ComposerTools
        activeAgent={activeAgent}
        commands={commands}
        models={models}
        mode={mode}
        onSetModel={onSetModel}
        onSetMode={onSetMode}
        disabled={disabled || sending}
        onSelectCommand={insertCommand}
        imagePicker={
          <ImageAttachmentPicker
            disabled={disabled || sending}
            uploading={uploading}
            onAddImages={uploadImages}
          />
        }
      />

      <button
        type="button"
        className="composer-send"
        disabled={
          disabled ||
          sending ||
          uploading ||
          (!content.trim() && attachments.length === 0)
        }
        onClick={() => void submit()}
        aria-label={sending ? "发送中" : "发送消息"}
        title={sending ? "发送中" : "发送消息"}
      >
        {sending ? "…" : "↑"}
      </button>
    </div>

    {error ? <p className="send-error">{error}</p> : null}
  </div>
</div>
```

### 12.2 说明

`composer` 负责底部区域和渐变背景。

`composer-inner` 负责真正的 GPT 风格输入框外壳。

发送按钮从文字按钮改成黑色圆形图标按钮。

---

## 十三、设置面板 CSS

修改文件：

```txt
src/renderer/styles.css
```

### 13.1 Settings Dialog

```css
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(8px);
}

.settings-dialog {
  width: min(680px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 48px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 20px;
  background: #ffffff;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.18),
    0 2px 8px rgba(0, 0, 0, 0.06);
}

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

.settings-close-button {
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

.settings-close-button:hover {
  background: #e9e9e9;
}
```

### 13.2 Settings Panel

```css
.settings-panel {
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 24px;
}

.settings-section {
  display: grid;
  gap: 8px;
}

.settings-section h3 {
  margin: 0 0 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
}

.settings-item {
  display: grid;
  gap: 12px;
  border-top: 1px solid #f0f0f0;
  padding: 14px 0;
}

.settings-item:first-of-type {
  border-top: none;
}

.settings-item-main {
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}

.settings-item-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.settings-item-copy strong {
  color: #0d0d0d;
  font-size: 14px;
  font-weight: 500;
}

.settings-item-copy span {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.4;
}

.settings-item-detail {
  display: grid;
  gap: 8px;
}
```

### 13.3 Switch

```css
.settings-switch {
  display: inline-flex;
  align-items: center;
}

.settings-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.settings-switch span {
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: #d1d5db;
  position: relative;
  cursor: pointer;
  transition: background 120ms ease;
}

.settings-switch span::before {
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

.settings-switch input:checked + span {
  background: #0d0d0d;
}

.settings-switch input:checked + span::before {
  transform: translateX(16px);
}

.settings-switch input:disabled + span {
  cursor: not-allowed;
  opacity: 0.48;
}
```

### 13.4 远程 URL 行

```css
.remote-url-list {
  display: grid;
  gap: 8px;
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
  color: #6b7280;
  font-size: 12px;
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

.settings-muted {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.settings-error {
  margin: 0;
  border-radius: 12px;
  background: #fff1f0;
  color: #b42318;
  padding: 10px 12px;
  font-size: 13px;
}
```

---

## 十四、CustomSelect CSS

```css
.custom-select {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.custom-select-trigger {
  height: 32px;
  max-width: 220px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d9d9d9;
  border-radius: 999px;
  background: #f7f7f8;
  color: #0d0d0d;
  padding: 0 10px 0 12px;
  font-size: 13px;
  line-height: 1;
}

.custom-select-trigger:hover {
  background: #ececec;
  border-color: #cfcfcf;
}

.custom-select-trigger:focus-visible {
  outline: none;
  border-color: #0d0d0d;
  box-shadow: 0 0 0 2px rgba(13, 13, 13, 0.08);
}

.custom-select-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.custom-select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-select-chevron {
  flex: 0 0 auto;
  color: #6b7280;
  font-size: 12px;
}

.custom-select-popover {
  position: absolute;
  left: 0;
  bottom: 40px;
  z-index: 30;
  width: max-content;
  min-width: 180px;
  max-width: 320px;
  max-height: 280px;
  overflow: auto;
  display: grid;
  gap: 2px;
  border: 1px solid #ececec;
  border-radius: 14px;
  background: #ffffff;
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.14),
    0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 6px;
}

.custom-select-option {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 2px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #0d0d0d;
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
}

.custom-select-option:hover {
  background: #f4f4f4;
}

.custom-select-option.selected {
  background: #ececec;
}

.custom-select-option.danger .custom-select-option-label {
  color: #b42318;
}

.custom-select-option:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.custom-select-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-select-option-desc {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.35;
}

.custom-select-empty {
  padding: 8px 10px;
  color: #6b7280;
  font-size: 13px;
}

.model-select .custom-select-trigger {
  max-width: 240px;
}

.permission-mode-select .custom-select-trigger {
  max-width: 190px;
}

.command-select .custom-select-trigger {
  max-width: 160px;
}
```

---

## 十五、Composer CSS

```css
.composer {
  border-top: none;
  background: linear-gradient(to top, #ffffff 76%, rgba(255, 255, 255, 0));
  padding: 16px 24px 24px;
}

.composer-inner {
  max-width: 760px;
  margin: 0 auto;
  border: 1px solid #d9d9d9;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  padding: 12px;
  display: grid;
  gap: 8px;
}

.composer textarea {
  min-height: 48px;
  max-height: 200px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  padding: 0;
  font-size: 15px;
  line-height: 1.6;
}

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.composer-tools {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.composer-icon-button,
.composer-send {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 999px;
  font-size: 16px;
  line-height: 1;
}

.composer-icon-button {
  background: #f7f7f8;
  color: #0d0d0d;
}

.composer-icon-button:hover {
  background: #ececec;
}

.composer-send {
  flex: 0 0 auto;
  background: #0d0d0d;
  color: #ffffff;
  font-weight: 600;
}

.composer-send:hover {
  background: #2f2f2f;
}

.composer-send:disabled {
  background: #d0d0d0;
  color: #ffffff;
  cursor: not-allowed;
}

.image-picker.dragging .image-picker-button {
  background: #ececec;
  box-shadow: 0 0 0 2px rgba(13, 13, 13, 0.08);
}
```

---

## 十六、清理旧 Select 样式

确认 `ModelPicker / PermissionModePicker / AgentCommandsMenu` 都改成 `CustomSelect` 后，可以删除或停止使用：

```css
.toolbar-select-label
.toolbar-select
.model-select
.permission-mode-select
.command-select
```

注意：

```txt
model-select / permission-mode-select / command-select 类名可以保留给 CustomSelect 外层使用。
删除的是原生 select 专用样式。
```

---

## 十七、验收标准

完成后检查：

```txt
1. 设置弹窗标题仍为“设置”，不是“远程访问”。
2. 远程访问只是设置面板中的一条设置项。
3. 远程访问开关仍可正常切换。
4. URL 复制按钮仍可用。
5. 发送框工具顺序为：附件 / 模型 / 权限 / 命令 / 发送。
6. 发送按钮是黑色圆形按钮，显示 ↑ 或发送中 …。
7. 图片入口是图标按钮，不再显示“添加图片”长文字。
8. 模型、权限、命令不再使用原生 select。
9. 自制下拉框点击外部和 Escape 可以关闭。
10. 危险权限模式仍会二次确认。
11. npm run build 通过。
```

---

## 十八、推荐提交顺序

```bash
git add .
git commit -m "refactor(settings): 将远程访问改为设置项"
```

```bash
git add .
git commit -m "feat(ui): 新增统一自定义下拉框"
```

```bash
git add .
git commit -m "style(chat): 重排发送框工具栏"
```

如果一次提交：

```bash
git add .
git commit -m "feat(ui): 重构设置面板和发送框控件"
```
