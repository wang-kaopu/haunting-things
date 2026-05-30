# Haunting Souls 剩余工作计划

## Summary

当前项目已经从 AionUi 快照裁成最小可构建骨架。已完成“代码裁剪、基础 Web 服务、SQLite/auth、typed WebSocket bridge、最小 Team mailbox/MCP、React 工作台、构建和 smoke test”。后续重点不是继续删代码，而是把 ACP 与 Team runtime 从“骨架可跑”推进到“真实 Claude/Codex 可用”。
需要进一步做的地方都参考~/workspace/AionUi这个项目的思路，尽量不要自己重复造轮子或做项目的高级决策

## Progress

- [x] 建立精简目录结构：`src/server`、`src/shared`、`src/renderer`、`src/electron`。
- [x] 删除旧 AionUi 运行路径：Office、Cron、Channel、Extension、Gemini、Aionrs、Remote、OpenClaw、Nanobot、完整 i18n、旧 Electron 主流程。
- [x] 重写 `package.json`、TypeScript、Vite、Vitest、server build 脚本。
- [x] 实现 Express 服务、JWT Cookie 登录、SQLite schema、静态资源 serving、远程 URL 展示。
- [x] 实现 typed WebSocket bridge 和最小公共 API。
- [x] 实现 Agent detection：Claude/Codex CLI path/version 检测。
- [x] 实现最小 Conversation/Team/Database service。
- [x] 实现 Team mailbox、Team MCP TCP server、stdio MCP 工具 `team_members` 和 `team_send_message`。
- [x] 实现最小 React 工作台：登录、Team 列表、消息区、Agent/Server 信息、创建 Team、添加 Agent、发送消息。
- [x] 实现 Electron 薄壳入口。
- [x] 验证通过：`npm run typecheck`、`npm run build`、`npm test`、生产 server smoke test 返回 HTML。
- [x] 完成真实 Claude/Codex ACP 协议适配（用 `@agentclientprotocol/sdk` `ClientSideConnection` 重写 `AcpRuntime`）。
- [x] 完成权限确认 UI 和权限响应链路（`PermissionDialog` 组件 + `conversation.permission` 订阅）。
- [ ] 完成 Team 多 Agent 端到端协作验证。
- [ ] 完成远程模式、安全策略、Electron 真实启动验证。
- [ ] 扩充测试覆盖并处理 npm audit 风险。

## Key Remaining Work

- ACP runtime hardening ✅
  - ~~当前 `AcpRuntime` 只写出 JSON-RPC/NDJSON 请求，没有等待 request response；`initialize` 和 `session/new` 实际返回值没有被解析。~~
  - ~~下一步应实现 pending request map、response correlation、超时、startup failure、stderr 摘要、进程退出清理。~~
  - ~~按 Claude/Codex bridge 实际协议校正 `initialize`、`session/new`、`session/prompt`、permission response 的 method 和 payload shape。~~
  - 已用 `@agentclientprotocol/sdk` `ClientSideConnection` 重写，实现了 pending request map、startup failure watcher、SDK sessionUpdate/requestPermission handler、mcpServers env 格式修正。
- Conversation and permission flow ✅
  - ~~将 assistant stream、tool/permission、finish/error 映射为稳定 `ChatMessage` 和 `PermissionRequest`。~~
  - ~~Renderer 增加权限确认组件，订阅 `conversation.permission`，调用 `conversation.confirmPermission`。~~
  - 增加 prompt in-flight 状态，避免同一 conversation 并发发送导致消息串流错乱。（待验证）
- Team runtime
  - 验证 Team MCP 注入到 ACP session 是否被 Claude/Codex 识别。
  - 修复当前 session 重启后内存态 MCP config 的恢复问题；服务重启后 Team 应能重新启动 MCP server 并重新注入。
  - 让 Team UI 能切换查看每个 Agent conversation，而不是只看 leader 消息。
- Web and security
  - 加登录限流、基础 security headers、remote origin 校验。
  - 完成 `ALLOW_REMOTE=true` 下 LAN/Tailscale URL 展示与 WebSocket cookie auth 验证。
  - 改善初始密码/重置密码体验，避免生产日志遗漏时无法登录。
- UI completion
  - 用明确控件替代 `window.prompt/window.confirm` 创建 Team 和选择 backend。
  - 增加设置页：Agent health、server URLs、修改密码。
  - 增加错误状态、loading 状态、消息自动滚动、Agent 状态展示。
- Electron
  - 实测 `npm run dev:desktop` 和构建后的 `electron dist-server/electron/main.js`。
  - 确认 Electron 关闭时 server 子进程退出，已有 server 时不重复启动。

## Test Plan

- [x] Unit：mailbox `readUnreadAndMark` 只读一次。
- [ ] Unit：Agent detection 覆盖 CLI 缺失、版本读取失败、Claude/Codex 可用。
- [ ] Unit：Auth 覆盖 login/logout/change-password/JWT 过期/WebSocket reject。
- [ ] Unit：Team MCP 覆盖 token 拒绝、`team_members`、`team_send_message` 路由和 wake。
- [ ] Integration：mock ACP process 覆盖 initialize、session/new、prompt stream、permission、finish、异常退出。
- [ ] Integration：创建 Team -> 添加 Teammate -> Leader 通过 MCP 发消息 -> Teammate 被唤醒。
- [ ] E2E：登录、创建 Team、发送消息、看到流式输出。
- [ ] E2E：`ALLOW_REMOTE=true` 监听 `0.0.0.0` 并展示非 internal IPv4 URL。
- [ ] E2E：Electron 壳加载同一 WebUI。

## Assumptions

- v1 仍只支持 Claude Code 和 Codex。
- v1 继续不做 `team_spawn_agent`、任务板、预设助手、完整 i18n、文件预览、Office 自动处理。
- 下一阶段优先级：先把真实 ACP 端到端跑通（✅ 已完成），再验证 Team MCP 注入和多 Agent 协作，然后完善 UI 和 Electron。
