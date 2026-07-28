# UI 重构计划

## 当前阶段

第七阶段已完成工作区切换和工作区选择器周边迁移。后续 UI 迁移应优先复用 Tailwind token 和 shadcn/ui 组件，不再为通用控件新增大段全局 CSS。
全局样式入口由 `npm run check` 约束，避免已迁移组件的旧 class 和大段组件样式回流到 `src/renderer/styles.css`。

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
- 通知：使用 Chat 面板内的局部通知层，不使用全局页面 toast

只有业务展示形态非常特殊、且 Radix/shadcn 组合会明显增加复杂度时，才允许保留自定义组件。

## 视觉规范

- 默认界面保持工作台风格：高信息密度、低装饰、弱边框、清晰 hover/selected 状态。
- 卡片圆角默认不超过 `--radius-lg`，除非该组件已有明确视觉原因。
- 交互按钮优先使用图标或图标加文字，图标优先来自 `lucide-react`。
- 不新增大面积渐变、装饰色块或单一色系主题。
- 桌面端优先保证侧栏、聊天区、输入框的稳定尺寸；移动端优先使用 `Sheet` 承载侧栏。
- 右侧用户消息正文超过 12 行时在前端折叠显示，展开后展示完整正文；左侧 Agent/teammate 消息保持完整展示。该行为只影响聊天流阅读，不截断发送内容、历史内容或附件。

## 旧 CSS 废弃策略

迁移时按组件删除旧样式，不长期保留两套系统：

1. 迁移组件到 shadcn/ui 或 Tailwind utility。
2. 删除对应旧 class 的 CSS。
3. 若旧 class 仍被引用，先调整引用再删除样式。
4. 每个迁移 PR 至少运行 `npm run check` 和 `npm run build`。

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
- `.modal-*`
- `.team-drawer*`
- `.drawer-*`
- `.member-card*`
- `.agent-badge*`
- `.panel-dialog-*`
- `.sidebar-section-*`
- `.sidebar-empty`
- `.workspace-switcher*`
- `.workspace-picker-*`
- `.conversation-summary-*`
- `.workspace-panel*`
- `.workspace-tree*`

## 阶段记录

第三阶段已完成：

- `src/renderer/shared/components/CustomSelect.tsx`
- `src/renderer/shared/components/PanelDialogShell.tsx`
- `src/renderer/app/Workbench.tsx` 内联的 `PermissionDialog`

这些组件已迁移到 Radix/shadcn 路径，覆盖焦点管理、键盘交互、Portal、可访问性和状态样式。

通知系统后续不再使用全局 `NotificationCenter` / `sonner`。Workbench 内的应用通知统一进入 Chat 内容区局部通知层，避免遮挡页面右上角控件。

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

右侧用户气泡正文折叠使用 `CollapsibleMessageContent` 统一处理，阈值为 12 行。左侧 Agent/teammate Markdown 正文不折叠；附件、错误提示和历史包装 Prompt 的已有折叠逻辑不纳入正文折叠容器。

第六阶段已完成：

- `src/renderer/features/teams/TeamDrawer.tsx`
- `src/renderer/features/teams/components/TeamMemberList.tsx`
- `src/renderer/features/teams/components/TeamMemberCard.tsx`
- `src/renderer/features/teams/dialogs/AddAgentDialog.tsx`
- `src/renderer/features/teams/dialogs/CreateTeamDialog.tsx`
- `src/renderer/features/settings/components/SettingsDialog.tsx`
- `src/renderer/features/settings/components/SettingsPanel.tsx`
- `src/renderer/features/settings/components/RemoteAccessSetting.tsx`
- `src/renderer/features/settings/components/RemoteAccessPanel.tsx`

这些组件已迁移到 Tailwind utility、共享 `Button`、Radix `Dialog`、Radix `Select` 和 `ScrollArea`。团队抽屉、成员卡片、添加 Agent、创建团队和设置远程访问不再依赖旧 `.team-drawer*`、`.drawer-*`、`.member-card*`、`.agent-badge*`、`.modal-*`、`.remote-*` 和 `.create-team-*` 全局样式。

第七阶段已完成：

- `src/renderer/features/workspace/WorkspaceSwitcher.tsx`
- `src/renderer/features/workspace/ConversationSummaryList.tsx`
- `src/renderer/features/workspace/WorkspacePickerDialog.tsx`
- `src/renderer/shared/components/PanelDialogShell.tsx`

这些组件已迁移到 Tailwind utility、共享 `Button`、Radix `Dialog`、Radix `Select` 和 `ScrollArea`。工作区切换、会话摘要列表和工作区选择器不再依赖旧 `.sidebar-section-*`、`.sidebar-empty`、`.workspace-switcher*`、`.conversation-summary-*`、`.workspace-picker-*`、`.panel-dialog-*` 全局样式；`PanelDialogShell` 兼容层已删除。

第八阶段已完成：

- `src/renderer/features/workspace/WorkspacePanel.tsx`
- `src/renderer/features/workspace/WorkspaceTree.tsx`

这些组件已迁移到 Tailwind utility 和共享 `Button`。工作区文件面板和文件树不再依赖旧 `.workspace-panel*`、`.workspace-tree*` 全局样式；`npm run check` 会阻止这些已废弃选择器重新进入全局 CSS。

## 后续阶段建议

当前没有明确计划中的 UI 迁移阶段。后续如果新增或改造 UI，继续按本文档的主题 token、shadcn/ui 和 Tailwind utility 约束执行。
