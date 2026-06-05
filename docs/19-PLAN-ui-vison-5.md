## 目标风格

截图里最大的问题是：

1. 标题太长时视觉压迫，且没有明确 header/body/footer 层级。
2. `body` 的 JSON 区域和选项区域像普通表单，不够像 GPT/Codex 的“权限确认卡片”。
3. radio 是原生样式，整体不够高级。
4. 面板尺寸、圆角、阴影、按钮层级可以更接近 ChatGPT/Codex：白色大圆角面板、灰黑遮罩、浅灰代码块、整行可点击选项、黑色主按钮。

---

## 一、修改 `PermissionDialog` 结构

文件：

```txt
src/renderer/app/Workbench.tsx
```

当前 `PermissionDialog` 是直接 `h3 + pre + options + actions` 的扁平结构。

建议替换为下面结构，重点是增加 header、body、footer 语义层，并给选中项加 `selected` class：

```tsx
function PermissionDialog({
  permission,
  onRespond,
  onDismiss,
}: {
  permission: PermissionRequest;
  onRespond: (optionId: string) => void;
  onDismiss: () => void;
}): React.ReactElement {
  const [selected, setSelected] = useState(permission.options[0]?.id ?? "");

  return (
    <div className="permission-overlay">
      <section
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        <header className="permission-header">
          <p className="permission-eyebrow">Permission request</p>
          <h3 id="permission-dialog-title">{permission.title}</h3>
        </header>

        {permission.body ? (
          <pre className="permission-body">{permission.body}</pre>
        ) : null}

        <div
          className="permission-options"
          role="radiogroup"
          aria-label="权限选项"
        >
          {permission.options.map((opt) => {
            const checked = selected === opt.id;

            return (
              <label
                key={opt.id}
                className={
                  checked ? "permission-option selected" : "permission-option"
                }
              >
                <input
                  className="permission-option-input"
                  type="radio"
                  name="permission"
                  value={opt.id}
                  checked={checked}
                  onChange={() => setSelected(opt.id)}
                />
                <span
                  className="permission-option-indicator"
                  aria-hidden="true"
                />
                <span className="permission-option-content">
                  <strong>{opt.label}</strong>
                  {opt.description ? (
                    <span className="permission-desc">{opt.description}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>

        <footer className="permission-actions">
          <button
            type="button"
            className="permission-button primary"
            onClick={() => onRespond(selected)}
            disabled={!selected}
          >
            确认
          </button>
          <button
            type="button"
            className="permission-button secondary"
            onClick={onDismiss}
          >
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
```

---

## 二、替换或追加权限弹窗 CSS

文件：

```txt
src/renderer/styles.css
```

当前 CSS 已经有 `.permission-overlay`、`.permission-dialog`、`.permission-body`、`.permission-option`、`.permission-actions` 这些样式，建议在现有 “Permission Dialog” 区域替换掉权限相关规则，或者直接追加到文件末尾覆盖旧样式。当前旧规则位置在 Modal & Permission Dialog 区域。

推荐 CSS：

```css
.permission-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 32px;
  background: rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.permission-dialog {
  width: min(860px, calc(100vw - 48px));
  max-height: calc(100dvh - 64px);
  min-width: 0;
  overflow: hidden;
  display: grid;
  gap: 16px;
  padding: 28px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 28px;
  background: #ffffff;
  color: #0d0d0d;
  box-shadow:
    0 28px 90px rgba(0, 0, 0, 0.22),
    0 4px 18px rgba(0, 0, 0, 0.08);
}

.permission-header {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.permission-eyebrow {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.permission-dialog h3 {
  min-width: 0;
  margin: 0;
  color: #0d0d0d;
  font-size: clamp(20px, 2.6vw, 32px);
  line-height: 1.25;
  font-weight: 650;
  letter-spacing: -0.03em;
  overflow-wrap: anywhere;
}

.permission-body {
  min-width: 0;
  max-height: 220px;
  margin: 0;
  overflow: auto;
  padding: 16px 18px;
  border: 1px solid #ececec;
  border-radius: 18px;
  background: #f7f7f8;
  color: #353740;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.permission-options {
  min-width: 0;
  display: grid;
  gap: 10px;
}

.permission-option {
  min-width: 0;
  min-height: 64px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 15px 18px;
  border: 1px solid #e7e7e7;
  border-radius: 18px;
  background: #ffffff;
  color: #0d0d0d;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease,
    transform 120ms ease;
}

.permission-option:hover {
  background: #f7f7f8;
  border-color: #d9d9d9;
}

.permission-option.selected {
  border-color: #0d0d0d;
  box-shadow: inset 0 0 0 1px #0d0d0d;
}

.permission-option-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.permission-option-indicator {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border: 2px solid #9ca3af;
  border-radius: 999px;
  background: #ffffff;
}

.permission-option.selected .permission-option-indicator {
  border-color: #0d0d0d;
}

.permission-option.selected .permission-option-indicator::after {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #0d0d0d;
}

.permission-option-content {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.permission-option-content strong {
  min-width: 0;
  color: #0d0d0d;
  font-size: 16px;
  font-weight: 560;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.permission-desc {
  color: #6b7280;
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.permission-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}

.permission-button {
  height: 48px;
  min-width: 96px;
  border: 0;
  border-radius: 999px;
  padding: 0 26px;
  font-size: 16px;
  font-weight: 560;
}

.permission-button.primary {
  background: #0d0d0d;
  color: #ffffff;
}

.permission-button.primary:hover {
  background: #2f2f2f;
}

.permission-button.secondary {
  background: #f4f4f4;
  color: #0d0d0d;
}

.permission-button.secondary:hover {
  background: #e9e9e9;
}

.permission-button:focus-visible,
.permission-option:focus-within {
  outline: none;
  box-shadow:
    0 0 0 2px #ffffff,
    0 0 0 4px rgba(13, 13, 13, 0.18);
}

@media (max-width: 640px) {
  .permission-overlay {
    padding: 16px;
    align-items: end;
  }

  .permission-dialog {
    width: 100%;
    max-height: calc(100dvh - 32px);
    padding: 22px;
    border-radius: 24px;
  }

  .permission-dialog h3 {
    font-size: 22px;
  }

  .permission-body {
    max-height: 180px;
  }

  .permission-actions {
    flex-direction: column;
  }

  .permission-button {
    width: 100%;
  }
}
```

---

## 三、为什么这样改更合适

这套改法不会碰权限队列、事件监听、`conversation.respondPermission` 等业务逻辑，只改展示层；当前 `Workbench` 已经把 `PermissionDialog` 作为 `permissionQueue[0]` 渲染，关闭和确认都走同一个响应函数。

视觉上会更像 GPT/Codex：

- 大圆角白色浮层。
- 背景灰黑半透明 + blur。
- 请求正文使用浅灰代码块。
- 权限选项变成整行可点击卡片。
- 选中态是黑色描边 + 自定义 radio。
- 底部主按钮黑色，次按钮浅灰色。
- 长 MCP 工具名会自动换行，不会把面板撑爆。

建议提交信息：

```bash
git add src/renderer/app/Workbench.tsx src/renderer/styles.css
git commit -m "feat: 优化权限审批面板样式"
```
