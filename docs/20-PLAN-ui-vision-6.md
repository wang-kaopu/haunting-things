## 1. 不要把 MCP 工具名当大标题

现在最大的问题是：

```txt
mcp__Haunting-things-team-...__team_send_message
```

直接放在大标题里，视觉重心太重。更接近 Codex 的做法是：

```txt
需要授权
Agent 想调用 MCP 工具

team_send_message
mcp__Haunting-things-team-...__team_send_message
```

也就是：

- 主标题变短：`需要授权` / `Allow tool call?`
- 真正的工具名放到小号 monospace pill 里
- 长 MCP namespace 放在次级位置，不抢视觉焦点

当前 `PermissionRequest` 已经有 `title/body/options/toolCall/rawInput`，不用改协议就能做展示层增强。

可以加一个展示解析函数：

```tsx
function getPermissionMeta(permission: PermissionRequest): {
  toolName: string;
  namespace: string;
  displayTitle: string;
} {
  const title = permission.title.trim();
  const parts = title.split("__").filter(Boolean);
  const toolName = parts.at(-1) ?? title;

  return {
    toolName,
    namespace: title,
    displayTitle: `允许调用 ${toolName}？`,
  };
}
```

标题区域建议变成：

```tsx
const meta = getPermissionMeta(permission);

<header className="permission-header">
  <div className="permission-icon">⌘</div>
  <div className="permission-heading">
    <p className="permission-eyebrow">Permission request</p>
    <h3 id="permission-dialog-title">{meta.displayTitle}</h3>
    <div className="permission-tool">
      <span className="permission-tool-name">{meta.toolName}</span>
      <span className="permission-tool-namespace">{meta.namespace}</span>
    </div>
  </div>
</header>;
```

---

## 2. 不要直接展示转义后的 JSON 字符串

截图里 `message` 字段内部是一大段 `\n\n##`，这对用户不友好。Codex 风格更强调：

```txt
Tool arguments
{
  "to": "Leader",
  "message": "..."
}
```

并且把长内容格式化，而不是展示转义符。

建议优先显示 `permission.rawInput`，没有再 fallback 到 `body`。当前归一化函数已经保留了 `rawInput` 和 `toolCall`。

```tsx
function formatPermissionInput(permission: PermissionRequest): string {
  if (permission.rawInput !== undefined) {
    return JSON.stringify(permission.rawInput, null, 2);
  }

  if (!permission.body) return "";

  try {
    return JSON.stringify(JSON.parse(permission.body), null, 2);
  } catch {
    return permission.body;
  }
}
```

然后把代码块标题加上：

```tsx
<section className="permission-detail">
  <div className="permission-detail-header">
    <span>Tool arguments</span>
    <button type="button" className="permission-detail-copy">
      Copy
    </button>
  </div>
  <pre className="permission-body">{formatPermissionInput(permission)}</pre>
</section>
```

视觉上会比现在这个“灰色大块 JSON”更像 Codex 的工具详情卡片。

---

## 3. 默认不要选中 `Always Allow`

你现在截图里默认选中了 `Always Allow`，这点不太安全，也不够 Codex。Codex 类审批一般默认偏保守：允许一次比永久允许更合理。

当前代码默认取第一个选项：

```tsx
const [selected, setSelected] = useState(permission.options[0]?.id ?? "");
```

远端 `feat/cwd` 里也是这样。

建议改成优先选 `Allow`，避开 `Always Allow`：

```tsx
function getDefaultPermissionOption(
  options: PermissionRequest["options"],
): string {
  const allowOnce = options.find((option) => {
    const label = option.label.toLowerCase();
    return label.includes("allow") && !label.includes("always");
  });

  return allowOnce?.id ?? options[0]?.id ?? "";
}
```

使用：

```tsx
const [selected, setSelected] = useState(() =>
  getDefaultPermissionOption(permission.options),
);
```

这一个改动非常关键：**视觉可以像 Codex，但行为也要像安全审批。**

---

## 4. 把选项从“大表单 radio”改成“审批动作列表”

现在的选项卡片太高、太像设置项。更 Codex 的感觉是：

- `Allow` 是推荐动作
- `Always Allow` 是更强权限，要有弱提示
- `Reject` 是取消动作，视觉不应该和授权动作完全一样

建议给不同 option 加语义 class：

```tsx
function getPermissionOptionTone(label: string): "allow" | "always" | "reject" {
  const normalized = label.toLowerCase();

  if (normalized.includes("reject") || normalized.includes("deny"))
    return "reject";
  if (normalized.includes("always")) return "always";
  return "allow";
}
```

渲染：

```tsx
{
  permission.options.map((opt) => {
    const checked = selected === opt.id;
    const tone = getPermissionOptionTone(opt.label);

    return (
      <label
        key={opt.id}
        className={`permission-option permission-option--${tone} ${
          checked ? "selected" : ""
        }`}
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

        <span className="permission-option-content">
          <strong>{opt.label}</strong>
          <span className="permission-desc">
            {opt.description ?? getPermissionOptionHint(tone)}
          </span>
        </span>
      </label>
    );
  });
}
```

辅助文案：

```tsx
function getPermissionOptionHint(tone: "allow" | "always" | "reject"): string {
  if (tone === "allow") return "仅本次工具调用生效";
  if (tone === "always") return "以后同类请求将自动允许，请谨慎选择";
  return "拒绝本次工具调用";
}
```

---

## 5. 面板尺寸再收敛，底部固定

截图里弹窗已经很大，接近 ChatGPT，但 Codex 更偏“开发者确认卡”，应该更紧凑：

- 宽度从 `860px` 收到 `720px ~ 760px`
- body 超过高度时只让中间滚动
- footer 固定在底部
- 选项区高度减少

推荐 CSS 方向：

```css
.permission-dialog {
  width: min(760px, calc(100vw - 48px));
  max-height: min(760px, calc(100dvh - 64px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  gap: 14px;
  padding: 24px;
  border-radius: 24px;
}

.permission-header {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.permission-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #0d0d0d;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
}

.permission-heading {
  min-width: 0;
}

.permission-dialog h3 {
  margin: 0;
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.permission-tool {
  margin-top: 8px;
  display: grid;
  gap: 4px;
}

.permission-tool-name {
  width: fit-content;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 8px;
  background: #f4f4f5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.permission-tool-namespace {
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.permission-detail {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid #ececec;
  border-radius: 16px;
  overflow: hidden;
  background: #f7f7f8;
}

.permission-detail-header {
  height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #ececec;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.permission-body {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  padding: 14px 16px;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: 12.5px;
  line-height: 1.55;
}

.permission-option {
  min-height: 52px;
  padding: 12px 14px;
  border-radius: 14px;
}

.permission-option--always.selected {
  border-color: #a16207;
  box-shadow: inset 0 0 0 1px #a16207;
}

.permission-option--reject.selected {
  border-color: #991b1b;
  box-shadow: inset 0 0 0 1px #991b1b;
}

.permission-actions {
  padding-top: 4px;
}
```

---

## 推荐最终效果

从现在的：

```txt
大标题 = 一长串 MCP 工具名
正文 = 转义 JSON
选项 = 普通 radio 表单
默认 = Always Allow
```

变成：

```txt
需要授权
Agent 想调用 MCP 工具

tool: team_send_message
namespace: mcp__Haunting-things-team-...__team_send_message

Tool arguments
格式化后的 JSON / message 内容

Allow        仅本次工具调用生效
Always Allow 以后同类请求自动允许
Reject       拒绝本次工具调用
```

这会更像 Codex 的关键点：**短标题、明确工具、清晰参数、保守默认、授权范围可见**。

提交信息可以用：

```bash
git commit -m "feat: 优化权限审批框展示结构"
```
