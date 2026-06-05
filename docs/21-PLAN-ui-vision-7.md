可以继续往 **Codex 轻量审批卡片** 方向收：减少黑色粗边、减少说明文字、降低字号和字重，把视觉重点从“表单选项”改成“这次要执行什么 + 允许/拒绝”。

当前远端 `feat/cwd` 的 `PermissionDialog` 还是内联在 `Workbench.tsx` 里，选项会渲染 `opt.description`，正好可以从这里下手移除每个权限的说明。 权限队列和响应逻辑不用动，仍然只改展示层。

## 核心改法

### 1. 权限选项只保留 label

把现在这种：

```tsx
<strong>{opt.label}</strong>
{opt.description ? (
  <span className="permission-desc">{opt.description}</span>
) : null}
```

改成只渲染：

```tsx
<span className="permission-option-label">{opt.label}</span>
```

`Always Allow / Allow / Reject` 下方的中文说明全部不要了。

---

### 2. 选中态不要粗黑边

现在截图里的选中态黑边太重。更轻的做法：

* 未选中：透明背景，无边框或极浅边框
* hover：浅灰背景
* 选中：浅灰背景 + 左侧 radio 实心
* 不再给整行加粗黑描边

视觉会更像 Codex 里的轻确认面板。

---

## 推荐 `PermissionDialog` 结构

替换 `PermissionDialog` 即可，保留原来的 `onRespond/onDismiss` 逻辑：

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
  const [selected, setSelected] = useState(() => getDefaultPermissionOption(permission.options));
  const input = formatPermissionInput(permission);

  return (
    <div className="permission-overlay">
      <section
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        <header className="permission-header">
          <div className="permission-icon">⌘</div>
          <div className="permission-heading">
            <p className="permission-eyebrow">需要授权</p>
            <h3 id="permission-dialog-title">{permission.title}</h3>
          </div>
        </header>

        {input ? (
          <section className="permission-detail">
            <div className="permission-detail-header">
              <span>Tool arguments</span>
              <button
                type="button"
                className="permission-copy"
                onClick={() => void navigator.clipboard.writeText(input)}
              >
                Copy
              </button>
            </div>
            <pre className="permission-body">{input}</pre>
          </section>
        ) : null}

        <div className="permission-options" role="radiogroup" aria-label="权限选项">
          {permission.options.map((opt) => {
            const checked = selected === opt.id;

            return (
              <label
                key={opt.id}
                className={checked ? 'permission-option selected' : 'permission-option'}
              >
                <input
                  className="permission-option-input"
                  type="radio"
                  name="permission"
                  value={opt.id}
                  checked={checked}
                  onChange={() => setSelected(opt.id)}
                />
                <span className="permission-option-indicator" aria-hidden="true" />
                <span className="permission-option-label">{opt.label}</span>
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

function getDefaultPermissionOption(options: PermissionRequest['options']): string {
  const allowOnce = options.find((option) => {
    const label = option.label.toLowerCase();
    return label.includes('allow') && !label.includes('always');
  });

  return allowOnce?.id ?? options[0]?.id ?? '';
}

function formatPermissionInput(permission: PermissionRequest): string {
  if (permission.rawInput !== undefined) {
    return JSON.stringify(permission.rawInput, null, 2);
  }

  if (!permission.body) return '';

  try {
    return JSON.stringify(JSON.parse(permission.body), null, 2);
  } catch {
    return permission.body;
  }
}
```

这里顺手把默认选项改成优先 `Allow`，不要默认选中 `Always Allow`，这样更符合审批框的安全语义。

---

## 推荐 CSS：更轻、更浅、更少边框

追加到 `styles.css` 末尾覆盖即可。注意项目里全局 `label` 有默认 grid、颜色和字号，`.permission-option` 要显式覆盖，否则容易被全局 label 样式影响。

```css
.permission-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 32px;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.permission-dialog {
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100dvh - 64px);
  display: grid;
  gap: 16px;
  padding: 22px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.96);
  color: #111111;
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.18),
    0 2px 10px rgba(0, 0, 0, 0.05);
}

.permission-header {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.permission-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #111111;
  color: #ffffff;
  font-size: 17px;
  line-height: 1;
}

.permission-heading {
  min-width: 0;
}

.permission-eyebrow {
  margin: 0 0 3px;
  color: #7b8190;
  font-size: 12px;
  font-weight: 500;
}

.permission-dialog h3 {
  margin: 0;
  color: #111111;
  font-size: 20px;
  line-height: 1.28;
  font-weight: 650;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.permission-detail {
  min-height: 0;
  overflow: hidden;
  border: none;
  border-radius: 16px;
  background: #f6f6f7;
}

.permission-detail-header {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  color: #777d8a;
  font-size: 12px;
  font-weight: 600;
}

.permission-copy {
  height: 26px;
  border: none;
  border-radius: 999px;
  padding: 0 10px;
  background: #ffffff;
  color: #202124;
  font-size: 12px;
  font-weight: 600;
}

.permission-copy:hover {
  background: #eeeeef;
}

.permission-body {
  max-height: 210px;
  margin: 0;
  overflow: auto;
  padding: 10px 14px 14px;
  border: none;
  background: transparent;
  color: #4b5563;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.permission-options {
  display: grid;
  gap: 6px;
}

.permission-option {
  min-height: 42px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: #202124;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.permission-option:hover {
  background: #f5f5f5;
}

.permission-option.selected {
  background: #f1f1f1;
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
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  border: 1.5px solid #a7adb8;
  border-radius: 999px;
  background: transparent;
}

.permission-option.selected .permission-option-indicator {
  border-color: #111111;
}

.permission-option.selected .permission-option-indicator::after {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #111111;
}

.permission-option-label {
  min-width: 0;
  color: #202124;
  font-size: 14px;
  font-weight: 520;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.permission-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.permission-button {
  height: 40px;
  min-width: 78px;
  border: none;
  border-radius: 999px;
  padding: 0 20px;
  font-size: 14px;
  font-weight: 600;
}

.permission-button.primary {
  background: #111111;
  color: #ffffff;
}

.permission-button.primary:hover {
  background: #2f2f2f;
}

.permission-button.secondary {
  background: #f3f3f3;
  color: #202124;
}

.permission-button.secondary:hover {
  background: #e9e9e9;
}

.permission-button:focus-visible,
.permission-copy:focus-visible,
.permission-option:focus-within {
  outline: none;
  box-shadow: 0 0 0 3px rgba(17, 17, 17, 0.12);
}

@media (max-width: 640px) {
  .permission-overlay {
    padding: 14px;
    align-items: end;
  }

  .permission-dialog {
    width: 100%;
    padding: 18px;
    border-radius: 22px;
  }

  .permission-dialog h3 {
    font-size: 18px;
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

## 视觉变化总结

改完后会从现在这种“粗标题 + 粗选中框 + 选项说明很多”的感觉，变成：

```txt
需要授权
允许调用 cp ...?

Tool arguments
浅灰参数块

○ Always Allow
● Allow
○ Reject

确认   关闭
```

重点是：**整块面板更小、边框更少、字体更浅、选项更像 Codex 的轻量授权列表**。

提交信息：

```bash
git add src/renderer/app/Workbench.tsx src/renderer/styles.css
git commit -m "style: 轻量化权限审批框样式"
```
