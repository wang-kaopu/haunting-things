# UI 重构计划

## 当前阶段

第五阶段已完成聊天体验迁移。后续 UI 迁移应优先复用 Tailwind token 和 shadcn/ui 组件，不再为通用控件新增大段全局 CSS。

## 主题入口

- `src/renderer/styles.css`：只保留 Tailwind 引入、全局 reset、现存旧组件样式。
- `src/renderer/shared/styles/theme.css`：统一维护 shadcn token、Tailwind `@theme` 映射和迁移期旧变量别名。
- `components.json`：定义 shadcn 组件、工具函数和 hook 的路径别名。

新增视觉 token 时，应先判断是否能复用现有 token：

- 页面背景：`--background`
- 正文文字：`--foreground`
- 卡片或弹窗表面：`--card` / `--popover`
- 主操作：`--primary`
- 次级操作：`--secondary`
- 弱化内容：`--muted-background` / `--muted-foreground`
- 危险操作：`--destructive`
- 边框和输入框：`--border` / `--input`
- 焦点环：`--ring`

只有产品语义明确且跨组件复用时，才新增 token。单个组件的临时颜色不应进入主题文件。

## 组件选型

通用交互控件优先使用 shadcn/ui 或 Radix，而不是继续自实现：

- 按钮：`@renderer/shared/components/ui/button`
- 弹窗：使用 shadcn `Dialog`
- 下拉选择：使用 shadcn `Select`
- 菜单：使用 shadcn `DropdownMenu`
- 弹出层：后续使用 shadcn `Popover`
- 移动端侧栏：后续使用 shadcn `Sheet`
- 状态标签：后续使用 shadcn `Badge`
- 表单控件：后续使用 shadcn `Input`、`Textarea`、`Label`、`Switch`
- 通知：使用 `sonner`

只有业务展示形态非常特殊、且 Radix/shadcn 组合会明显增加复杂度时，才允许保留自定义组件。

## 视觉规范

- 默认界面保持工作台风格：高信息密度、低装饰、弱边框、清晰 hover/selected 状态。
- 卡片圆角默认不超过 `--radius-lg`，除非该组件已有明确视觉原因。
- 交互按钮优先使用图标或图标加文字，图标优先来自 `lucide-react`。
- 不新增大面积渐变、装饰色块或单一色系主题。
- 桌面端优先保证侧栏、聊天区、输入框的稳定尺寸；移动端优先使用 `Sheet` 承载侧栏。

## 旧 CSS 废弃策略

迁移时按组件删除旧样式，不长期保留两套系统：

1. 迁移组件到 shadcn/ui 或 Tailwind utility。
2. 删除对应旧 class 的 CSS。
3. 若旧 class 仍被引用，先调整引用再删除样式。
4. 每个迁移 PR 至少运行 `npm run build:renderer` 和 `npm run typecheck`。

已废弃的旧样式组：

- `.custom-select-*`
- `.toast-*`
- `.permission-*`
- `.sidebar-agent-*`
- `.sidebar-team-*`
- `.sidebar__*`
- `.app-shell`
- `.mobile-sidebar-backdrop`
- `.menu-popover`
- `.tool-popover`
- `.chat-layout`
- `.chat-header*`
- `.messages*`
- `.message-*`
- `.composer*`
- `.chat-empty*`
- `.image-picker*`
- `.image-attachment-*`
- `.usage-chip`
- `.phase-badge`

仍待后续阶段废弃的旧样式组：

- `.panel-dialog-*` 内容布局样式
- `.modal-*`
- `.sidebar-section-*` 和 `.sidebar-empty` 的工作区旧组件用法
- `.team-drawer*` 和 `.drawer-*`
- `.member-card*`
- `.agent-badge*`

## 阶段记录

第三阶段已完成：

- `src/renderer/shared/components/CustomSelect.tsx`
- `src/renderer/shared/components/PanelDialogShell.tsx`
- `src/renderer/features/notifications/components/NotificationCenter.tsx`
- `src/renderer/app/Workbench.tsx` 内联的 `PermissionDialog`

这些组件已迁移到 Radix/shadcn/sonner 路径，覆盖焦点管理、键盘交互、Portal、可访问性和状态样式。

第四阶段已完成：

- `src/renderer/app/Workbench.tsx`
- `src/renderer/features/teams/Sidebar.tsx`
- `src/renderer/features/teams/components/TeamList.tsx`
- `src/renderer/features/teams/components/SidebarAgentList.tsx`
- `src/renderer/features/teams/components/TeamListItem.tsx`

这些组件已迁移到 Tailwind utility、Radix `DropdownMenu`、Radix `ScrollArea` 和 lucide 图标，移动端侧栏也改为组件状态控制。

第五阶段已完成：

- `src/renderer/features/chat/ChatLayout.tsx`
- `src/renderer/features/chat/components/ChatHeader.tsx`
- `src/renderer/features/chat/components/SendBox.tsx`
- `src/renderer/features/chat/components/MessageBubble.tsx`
- `src/renderer/features/chat/components/MessageList.tsx`
- `src/renderer/features/chat/components/ComposerTools.tsx`
- `src/renderer/features/chat/components/ImageAttachmentPicker.tsx`
- `src/renderer/features/chat/components/ModelPicker.tsx`
- `src/renderer/features/chat/components/PermissionModePicker.tsx`
- `src/renderer/features/chat/components/AgentCommandsMenu.tsx`
- `src/renderer/features/chat/components/UsageChip.tsx`

这些组件已迁移到 Tailwind utility、共享 `Button`、Radix Select 链路和 lucide 图标。聊天主区、Header、消息流、用户/助手消息、附件预览、输入框和工具栏不再依赖旧 `.chat-*`、`.messages-*`、`.message-*`、`.composer-*` 全局样式。

## 后续阶段建议

第六阶段建议进入工作区和团队详情周边：

- `src/renderer/features/teams/TeamDrawer.tsx`
- `src/renderer/features/teams/components/TeamMemberList.tsx`
- `src/renderer/features/teams/components/TeamMemberCard.tsx`
- `src/renderer/features/teams/dialogs/AddAgentDialog.tsx`
- `src/renderer/features/teams/dialogs/CreateTeamDialog.tsx`
- `src/renderer/features/settings/components/SettingsPanel.tsx`
- `src/renderer/features/settings/components/RemoteAccessPanel.tsx`
