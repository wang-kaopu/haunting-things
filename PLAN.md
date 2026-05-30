# Haunting Souls 精简复刻实施计划

## Summary

基于当前 `PLAN.md` 和 AionUi 实现形态，按“Web MVP 先行，Electron 最后接壳”的顺序展开。当前仓库只有 `PLAN.md`，因此先从零搭建 TypeScript 项目，再按模块移植 AionUi 的核心机制：ACP 会话、Team MCP、WebSocket Bridge、认证和最小工作台 UI。

v1 目标是可用的个人内网多 Agent 控制台：支持 Claude Code / Codex、登录保护、本地/远程监听、Team 会话、Agent 间通过 MCP mailbox 通信。明确不迁移 AionUi 的 Office、Cron、渠道插件、Extension Hub、Gemini/Aionrs、完整 i18n、复杂预设助手体系。

## Key Changes

- 工程结构采用 `npm + Node 22 + TypeScript + Vite + React + Vitest`：
  - `src/server/`：Express、WebSocket、auth、SQLite、ACP/Team 服务。
  - `src/renderer/`：React 工作台、登录页、设置页。
  - `src/electron/`：Electron 壳，仅负责启动或连接本地 Web 服务。
  - `src/shared/`：bridge 协议、API 类型、Team/Agent/ACP 类型。
- 不直接搬 AionUi 的 `@office-ai/platform` bridge；实现一个项目内最小 typed WebSocket bridge：
  - WebSocket 消息统一为 `{ id?, type: 'invoke' | 'result' | 'event', name, data, error? }`。
  - Renderer 暴露 `bridge.invoke(name, data)`、`bridge.emit(name, data)`、`bridge.on(name, handler)`。
  - Electron 也连接同一个 WebSocket，不走 Electron IPC 主通道。
- 数据默认写入 `DATA_DIR ?? ~/.haunting-souls`，SQLite 文件为 `app.sqlite`。
  - 表：`users`、`conversations`、`messages`、`teams`、`mailbox`。
  - v1 不建 `team_tasks`，因为 MCP 只保留消息和成员发现。
- AionUi 可参考/移植的核心模块：
  - ACP：`AcpSession`、`ProcessAcpClient`、权限处理、stream 翻译、进程清理思路。
  - Team：`TeamSession`、`Mailbox`、`TeammateManager`、`TeamMcpServer`、`team-mcp-stdio` 的 TCP + stdio bridge 机制。
  - WebServer：JWT Cookie、WebSocket auth、`127.0.0.1` / `0.0.0.0` 监听、LAN/Tailscale 地址展示。
  - 移植代码保留 Apache-2.0 license header。

## Public Interfaces

- Agent API：
  - `agent.list()` 返回 `[{ backend: 'claude' | 'codex', name, available, cliPath?, version? }]`。
  - `agent.health({ backend })` 执行 CLI 检测和 ACP initialize handshake，超时 15 秒。
- Conversation API：
  - `conversation.create({ backend, workspace?, name? })`
  - `conversation.sendMessage({ conversationId, content, files? })`
  - `conversation.confirmPermission({ conversationId, callId, optionId })`
  - events：`conversation.stream`、`conversation.permission`、`conversation.finish`、`conversation.status`
- Team API：
  - `team.create({ name, workspace?, leaderBackend })`
  - `team.addAgent({ teamId, name, backend })`
  - `team.get({ teamId })`
  - `team.list()`
  - `team.sendMessage({ teamId, content, files? })`
  - `team.sendMessageToAgent({ teamId, slotId, content, files? })`
  - `team.stop({ teamId })`
  - events：`team.agent.status`、`team.agent.message`、`team.agent.added`、`team.turn.finished`
- Team MCP v1：
  - `team_send_message({ to, message, summary? })`
  - `team_members()`
  - 不实现 `team_spawn_agent`；新增队友由 UI/API 控制，避免 v1 引入复杂预设助手和模型目录。
- Auth / Remote：
  - `POST /login` 设置 httpOnly JWT Cookie。
  - `POST /logout`
  - `GET /api/auth/user`
  - WebSocket upgrade 必须从 Cookie 验证 JWT。
  - `HOST=0.0.0.0` 或 `ALLOW_REMOTE=true` 开启远程访问，默认端口 `25808`。
  - 首次启动生成随机 admin 密码并打印到控制台；`reset-password` 重置密码。

## Implementation Plan

- Milestone 1：项目骨架和服务基础
  - 创建 package、tsconfig、Vite、Vitest、Express server、WebSocket bridge、SQLite 初始化、基础日志和优雅退出。
  - 脚本固定为 `dev:web`、`dev:remote`、`dev:desktop`、`build`、`start`、`start:remote`、`reset-password`、`test`。
- Milestone 2：认证和远程模式
  - 实现 bcrypt 密码、JWT Cookie、logout blacklist、WebSocket 鉴权、远程模式 CORS/origin 校验。
  - 设置页展示监听地址、本地 URL、所有非 internal IPv4 URL。
- Milestone 3：ACP 会话
  - Claude 通过 `@agentclientprotocol/claude-agent-acp` 启动，Codex 通过 `@zed-industries/codex-acp` 启动并调用本机 `codex`。
  - 支持 initialize、session/new、prompt、stream、permission、finish/error、进程退出状态、idle cleanup。
- Milestone 4：Team runtime
  - 创建 Team 时生成 Leader conversation；`team.addAgent` 创建 Teammate conversation。
  - 每个 TeamSession 启动一个只监听 `127.0.0.1` 的 TCP MCP server，并将 `team-mcp-stdio.js` 注入每个 ACP session。
  - mailbox 写入后再 wake agent；wake 失败只标记 agent failed，不回滚已接受消息。
- Milestone 5：React 工作台
  - 首屏就是工作台：左侧 Team/Agent 列表，中间 Team Chat，右侧 Agent tabs 或 split view。
  - 登录页、设置页、创建 Team 弹窗、添加 Agent 弹窗、权限确认 UI、流式消息展示。
  - UI 只做中文/英文硬编码文案，不接完整 i18n 系统。
- Milestone 6：Electron 壳
  - 启动时探测 `http://127.0.0.1:25808`；不可用则 spawn server。
  - BrowserWindow 加载同一 WebUI。
  - 关闭主窗口默认关闭子 server；不做托盘常驻。

## Test Plan

- Unit：
  - Agent detection：Claude/Codex CLI 缺失、存在、版本读取失败。
  - Auth：login/logout、JWT 过期、WebSocket reject/accept。
  - Remote config：默认 `127.0.0.1`、`ALLOW_REMOTE=true`、`HOST=0.0.0.0`、LAN/Tailscale URL 枚举。
  - Mailbox：write、readUnreadAndMark 原子行为、按 team/agent 隔离。
  - Team MCP：token 拒绝、`team_members`、`team_send_message` 路由和 wake 调用。
- Integration：
  - mock ACP process 覆盖 initialize、prompt stream、permission、finish、异常退出。
  - 创建 team -> 发送用户消息 -> Leader 收到 mailbox -> Leader 调用 MCP 发送给 Teammate。
  - Agent 退出后状态更新为 failed，并释放子进程。
- E2E：
  - 浏览器登录进入工作台。
  - 创建 Claude/Codex Team，发送消息，看到流式输出。
  - 远程模式监听 `0.0.0.0` 且仍要求登录。
  - Electron 壳加载同一 WebUI 并能发送消息。

## Assumptions

- v1 面向个人或可信内网，不做公网多租户。
- v1 只支持 Claude Code 和 Codex。
- v1 不实现 Agent 自主 `team_spawn_agent`，只支持 UI/API 添加队友。
- Team MCP TCP 永远只监听 `127.0.0.1`，远程设备只能通过 WebUI 控制。
- 生产构建要求先构建 `team-mcp-stdio.js` 到 server 可解析路径，再启动服务。
