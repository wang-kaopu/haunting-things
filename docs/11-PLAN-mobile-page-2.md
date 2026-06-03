# 移动端抽屉按钮风格统一编码方案

## 目标

将移动端打开 Sidebar 的抽屉按钮从原始按钮样式改为 新 风格图标按钮。

要求：

1. 不再直接显示丑的 `☰` 文本按钮。
2. 使用 SVG 图标代替文字。
3. 按钮样式和当前 Composer、设置面板、关闭按钮风格统一。
4. 桌面端隐藏，移动端显示。
5. 避免被全局 `button` 样式污染。
6. 不改 Sidebar 抽屉逻辑，只改按钮结构和样式。

---

## 一、修改 ChatHeader 按钮结构

文件：

```txt
src/renderer/features/chat/components/ChatHeader.tsx
```

当前可能是：

```tsx
<button
  type="button"
  className="mobile-sidebar-trigger"
  aria-label="打开侧边栏"
  onClick={onOpenSidebar}
>
  ☰
</button>
```

改成：

```tsx
{
  onOpenSidebar ? (
    <button
      type="button"
      className="mobile-sidebar-trigger"
      aria-label="打开侧边栏"
      title="打开侧边栏"
      onClick={onOpenSidebar}
    >
      <MenuIcon />
    </button>
  ) : null;
}
```

在同文件底部增加本地图标组件：

```tsx
function MenuIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

如果不想把图标放在 `ChatHeader.tsx`，也可以新建：

```txt
src/renderer/shared/components/icons/MenuIcon.tsx
```

然后：

```tsx
import { MenuIcon } from "../../../shared/components/icons/MenuIcon";
```

---

## 二、调整 ChatHeader 布局

抽屉按钮应该和标题在同一行，移动端显示为：

```txt
[菜单按钮]  Team Name
           Agent Name / 状态
```

建议 `ChatHeader` 结构类似：

```tsx
<header className="chat-header">
  <div className="chat-header-main">
    {onOpenSidebar ? (
      <button
        type="button"
        className="mobile-sidebar-trigger"
        aria-label="打开侧边栏"
        title="打开侧边栏"
        onClick={onOpenSidebar}
      >
        <MenuIcon />
      </button>
    ) : null}

    <div className="chat-title">...</div>
  </div>
</header>
```

这样按钮不会和标题挤在一起，也方便移动端对齐。

---

## 三、CSS：统一按钮样式

文件：

```txt
src/renderer/styles.css
```

新增或覆盖：

```css
.chat-header-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
```

移动端按钮样式：

```css
.mobile-sidebar-trigger {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: none;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #f4f4f4;
  color: #0d0d0d;
  box-shadow: none;
  transition:
    background 120ms ease,
    transform 120ms ease,
    box-shadow 120ms ease;
}

.mobile-sidebar-trigger svg {
  width: 18px;
  height: 18px;
  display: block;
}

.mobile-sidebar-trigger:hover {
  background: #e9e9e9;
  border-color: transparent;
}

.mobile-sidebar-trigger:active {
  transform: scale(0.96);
}

.mobile-sidebar-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(13, 13, 13, 0.12);
}
```

移动端显示、桌面端隐藏：

```css
@media (max-width: 900px) {
  .mobile-sidebar-trigger {
    display: inline-grid;
  }
}

@media (min-width: 901px) {
  .mobile-sidebar-trigger {
    display: none;
  }
}
```

---

## 四、避免全局 button 样式污染

如果全局有类似：

```css
button {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px;
}
```

需要确保 `.mobile-sidebar-trigger` 显式覆盖：

```css
.mobile-sidebar-trigger {
  border: none;
  background: #f4f4f4;
  border-radius: 999px;
}
```

如果 hover 被全局影响，再加：

```css
.mobile-sidebar-trigger:hover {
  border-color: transparent;
}
```

---

## 七、验收标准

完成后检查：

```txt
1. 手机端 ChatHeader 左侧显示圆形菜单按钮。
2. 按钮不再是原始浏览器 button 样式。
3. 按钮使用 SVG 图标，不直接显示 ☰ 字符。
4. hover / active / focus-visible 样式和 新 风格一致。
5. 桌面端不显示该按钮。
6. 点击按钮能打开 Sidebar 抽屉。
7. 点击遮罩仍能关闭 Sidebar。
8. npm run build 通过。
```

---

## 八、推荐提交信息

```bash
git add .
git commit -m "style(mobile): 统一侧边栏抽屉按钮样式"
```
