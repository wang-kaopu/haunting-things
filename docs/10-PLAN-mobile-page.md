最新分支版应该只做这四件事：

1. 移动端 Sidebar 不再 display:none，改成 fixed 抽屉
2. Workbench 增加 mobileSidebarOpen 状态
3. ChatHeader 增加移动端菜单按钮
4. MessageList 自动滚动从 smooth 改成 auto + requestAnimationFrame，并可加 ResizeObserver
   推荐修改方案
5. Workbench 增加移动端侧栏状态

Workbench.tsx 增加：

const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

把：

<main className="app-shell">

改成：

<main className={mobileSidebarOpen ? 'app-shell mobile-sidebar-open' : 'app-shell'}>

在 Sidebar 前加遮罩：

{mobileSidebarOpen ? (
<button
type="button"
className="mobile-sidebar-backdrop"
aria-label="关闭侧边栏"
onClick={() => setMobileSidebarOpen(false)}
/>
) : null}

Sidebar 的选择事件建议包一层，选择后自动关闭：

onSelectTeam={(teamId) => {
active.selectTeam(teamId);
setMobileSidebarOpen(false);
}}
onSelectAgent={(slotId) => {
active.selectAgent(slotId);
setMobileSidebarOpen(false);
}}

给 ChatLayout 增加：

onOpenSidebar={() => setMobileSidebarOpen(true)} 2. ChatLayout / ChatHeader 接入菜单按钮

ChatLayoutProps 加：

onOpenSidebar?: () => void;

传给 ChatHeader：

<ChatHeader
  team={team}
  activeAgent={activeAgent}
  activePhase={activePhase}
  usage={usage}
  onOpenSidebar={onOpenSidebar}
/>

ChatHeaderProps 加：

onOpenSidebar?: () => void;

Header 左侧加：

{onOpenSidebar ? (
<button
type="button"
className="mobile-sidebar-trigger"
aria-label="打开侧边栏"
onClick={onOpenSidebar}

>

    ☰

  </button>
) : null}

ChatLayout 当前还没有这个入口，所以手机端用户没有办法打开被隐藏的 Sidebar。

3. CSS 改掉当前移动端响应式

保留桌面两栏不动，替换当前 @media (max-width: 900px) 和 @media (max-width: 600px) 里的布局部分。

建议改成：

@media (max-width: 900px) {
html,
body,
#root {
width: 100%;
height: 100%;
overflow: hidden;
}

.app-shell {
width: 100vw;
height: 100dvh;
min-height: 0;
overflow: hidden;
display: grid;
grid-template-columns: 1fr;
background: #ffffff;
}

.sidebar {
position: fixed;
inset: 0 auto 0 0;
z-index: 80;
display: flex;
width: min(320px, 86vw);
height: 100dvh;
transform: translateX(-100%);
transition: transform 160ms ease;
box-shadow: 16px 0 48px rgba(0, 0, 0, 0.14);
}

.app-shell.mobile-sidebar-open .sidebar {
transform: translateX(0);
}

.mobile-sidebar-backdrop {
position: fixed;
inset: 0;
z-index: 70;
border: none;
border-radius: 0;
padding: 0;
background: rgba(0, 0, 0, 0.24);
}

.mobile-sidebar-trigger {
display: inline-grid;
place-items: center;
width: 34px;
height: 34px;
border: none;
border-radius: 999px;
background: #f4f4f4;
color: #0d0d0d;
padding: 0;
flex: 0 0 auto;
}

.chat-layout {
min-width: 0;
min-height: 0;
height: 100dvh;
overflow: hidden;
display: flex;
flex-direction: column;
}

.messages-wrap {
min-height: 0;
overflow: hidden;
}

.messages {
min-height: 0;
height: 100%;
overflow-y: auto;
-webkit-overflow-scrolling: touch;
overscroll-behavior: contain;
padding: 16px 12px 140px;
}

.messages\_\_inner,
.composer-inner {
max-width: 100%;
}
}

@media (min-width: 901px) {
.mobile-sidebar-trigger,
.mobile-sidebar-backdrop {
display: none;
}
}

@media (max-width: 600px) {
.chat-header {
padding: 0 12px;
}

.message\_\_user-bubble {
max-width: 86%;
}

.composer {
padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
}

.composer-tools {
flex-direction: row;
align-items: center;
}

.chat-empty\_\_suggestions {
grid-template-columns: 1fr;
}
}

重点是删除现在这几条：

.sidebar {
display: none;
}

html,
body,
#root {
overflow: auto;
}

.app-shell {
height: auto;
overflow: visible;
}

.chat-layout {
height: auto;
}

这些和聊天应用的固定视口模型冲突。

4. MessageList 自动滚动修正

当前 jumpToBottom 永远使用 behavior: 'smooth'。流式输出时连续 smooth scroll 在手机浏览器里容易被打断。

改成：

function jumpToBottom(element: HTMLDivElement, behavior: ScrollBehavior = 'auto'): void {
element.scrollTo({
top: element.scrollHeight,
behavior,
});
}

自动跟随时改成：

if (pinnedToBottom || nearBottom) {
requestAnimationFrame(() => {
jumpToBottom(element, 'auto');
});
setPinnedToBottom(true);
setNewMessageCount(0);
return;
}

点击“回到底部”才 smooth：

onClick={() => {
const element = listRef.current;
if (!element) return;
jumpToBottom(element, 'smooth');
setPinnedToBottom(true);
setNewMessageCount(0);
}}

建议再加 ResizeObserver，因为图片、Markdown、字体重排都会改变内容高度：

useEffect(() => {
const element = listRef.current;
if (!element || !pinnedToBottom) return;

const observer = new ResizeObserver(() => {
requestAnimationFrame(() => {
jumpToBottom(element, 'auto');
});
});

observer.observe(element);

return () => {
observer.disconnect();
};
}, [pinnedToBottom]);

更理想的是观察 .messages\_\_inner，但最小改法先观察 .messages 也能改善。

最终判断

方案适合，但要用“最新分支精简版”。

不需要再处理：

两栏布局
成员列表
Teams 样式
设置面板
自制下拉框
composer-inner

现在只需要集中修：

移动端 Sidebar 入口
移动端不要 body 滚动
消息容器保持内部滚动
MessageList 自动滚底逻辑
Composer 移动端不要纵向堆叠

推荐提交：

git add .
git commit -m "fix(mobile): 修复侧边栏入口和消息自动滚动"
