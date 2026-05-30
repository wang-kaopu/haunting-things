# AionUi 精简复刻项目方案

## Summary

构建一个 **Web 优先 + 可选 Electron 桌面壳** 的精简项目，只复刻三类能力：

- Claude Code 与 Codex 通过 ACP 会话接入，并通过最小 Team MCP 工具实现多 Agent 沟通。
- 同一套 React WebUI 同时服务浏览器访问和 Electron 客户端访问。
- 服务端支持 `127.0.0.1` 本地模式与 `0.0.0.0` 远程模式，供 LAN / Tailscale 设备访问控制。

明确不迁移：Office、Cron、渠道插件、Extension Hub、Gemini/Aionrs/Remote Agents、完整 i18n、复杂预设助手体系。

## Key Changes

- 新项目采用 TypeScript monorepo 风格：
  - `src/server/`：Node 服务、Express、WebSocket、认证、ACP/Team orchestration。
  - `src/renderer/`：React + Vite WebUI。
  - `src/electron/`：可选 Electron 客户端，只启动/连接本地服务并加载 WebUI。
  - `src/shared/`：bridge 事件名、类型、Agent/Team 数据结构。
- 复用现有核心思路，但裁剪实现：
  - 从 `src/process/acp` 提取 ACP session/runtime/client 相关逻辑。
  - 从 `src/process/agent/acp` 提取 Claude/Codex 启动逻辑，仅保留 `claude` 与 `codex` 两个 backend。
  - 从 `src/process/team` 提取最小 Team：`TeamSession`、`Mailbox`、`TeammateManager`、`TeamMcpServer`、`team-mcp-stdio`。
  - 从 `src/process/webserver` 提取 Express + WebSocket + auth + static serving。
- Bridge 统一为 WebSocket 传输：
  - Electron 客户端不再走 Electron IPC 作为主通道，直接连接本机 WebSocket。
  - Web 浏览器和 Electron 壳共用同一套 `bridge.emit/on/invoke` 客户端。
- CLI scripts：
  - `dev:web`：启动 Vite + Node 服务，本地访问。
  - `dev:remote`：监听 `0.0.0.0`，输出 LAN/Tailscale 地址。
  - `dev:desktop`：启动 Node 服务并打开 Electron 壳。
  - `start`：生产 WebUI 本地模式。
  - `start:remote`：生产 WebUI 远程模式。
  - `reset-password`：重置管理员密码。

## Public Interfaces

- Agent API：
  - `agent.list()` 返回 `{ backend: 'claude' | 'codex', name, available, cliPath? }[]`
  - `agent.health({ backend })` 做 CLI/ACP handshake 检测。
- Team API：
  - `team.create({ name, workspace, leaderBackend })`
  - `team.get({ teamId })`
  - `team.sendMessage({ teamId, content, files? })`
  - `team.sendMessageToAgent({ teamId, slotId, content, files? })`
  - `team.stop({ teamId })`
  - events: `team.agent.status`, `team.agent.message`, `team.turn.finished`
- ACP API：
  - `conversation.sendMessage({ conversationId, content, silent?, files? })`
  - events: `conversation.stream`, `conversation.permission`, `conversation.finish`
  - `conversation.confirmPermission({ conversationId, callId, optionId })`
- Auth / Remote API：
  - `POST /login` 设置 httpOnly JWT Cookie。
  - `POST /logout`
  - `GET /api/auth/user`
  - WebSocket 握手必须校验 Cookie token。
  - `HOST=0.0.0.0` 或 `ALLOW_REMOTE=true` 开启 LAN/Tailscale 访问。
  - `PORT` 控制端口，默认 `25808`。

## Implementation Plan

- Bootstrap 新项目：
  - Vite React renderer、Node 22+ TypeScript server、Electron 可选壳。
  - 依赖保留最小集合：`express`、`ws`、`jsonwebtoken`、`bcryptjs`、`better-sqlite3`、`@agentclientprotocol/sdk`、`@modelcontextprotocol/sdk`、`react`、`vite`、`electron`。
- ACP 层：
  - 硬编码 Claude/Codex backend 配置。
  - Claude 使用 `@agentclientprotocol/claude-agent-acp` 或现有 Claude ACP 启动方式。
  - Codex 使用 `@zed-industries/codex-acp`，并调用本机 `codex`。
  - 保留权限确认、stream 翻译、finish/error、进程清理和 idle timeout。
- Team 层：
  - 创建 team 时只创建一个 Leader，会话类型为 Claude 或 Codex。
  - Team MCP 暴露最小工具：`team_send_message`、`team_members`。
  - 可选保留 `team_spawn_agent`，但 v1 默认不在 UI 暴露动态创建；先支持固定新增一个 Teammate。
  - mailbox 使用 SQLite 持久化，未读消息读取后标记已读。
  - agent wake 时把 mailbox 消息格式化后发给对应 ACP session。
- WebUI：
  - 首页即工作台：左侧 Team 列表，中间 Team Chat，右侧/标签显示 Agent 会话。
  - 设置页包含：Claude/Codex 检测结果、WebUI 本地/远程状态、端口、登录密码修改。
  - 远程模式显示所有非 internal IPv4 地址，包括 LAN 和 Tailscale。
- Electron 壳：
  - 启动时检查服务是否运行；未运行则 spawn 本地 server。
  - BrowserWindow 加载 `http://127.0.0.1:<port>`。
  - 关闭窗口不影响服务的策略默认关闭服务；后续可加托盘常驻。
- 安全：
  - 首次启动生成随机 admin 密码并打印到控制台。
  - JWT 使用 httpOnly Cookie，WebSocket 从 Cookie 验证。
  - 远程模式仍要求登录。
  - 不支持 query token，避免日志泄露。
  - 默认只允许同源；远程模式自动允许本机非 internal IP origin。

## Test Plan

- Unit tests：
  - Claude/Codex backend detection。
  - WebUI host/port resolution：默认本地、`ALLOW_REMOTE=true`、`HOST=0.0.0.0`。
  - JWT login、logout、WebSocket auth reject/accept。
  - Mailbox write/readUnread atomic behavior。
  - Team MCP `team_send_message` 路由到正确 agent。
- Integration tests：
  - mock ACP process 完成 session initialize、prompt、stream、finish。
  - 创建 team、发送用户消息、Leader 收到 mailbox、Teammate 收到 `team_send_message`。
  - Agent 进程退出时状态变为 failed 并释放 wake lock。
- E2E tests：
  - 浏览器登录后进入 WebUI。
  - 本地模式仅 `127.0.0.1` 可监听。
  - 远程模式监听 `0.0.0.0` 并展示 LAN/Tailscale URL。
  - Electron 壳加载同一 WebUI，并能发送消息。

## Assumptions

- 精简版优先服务个人或小团队内网使用，不做公网多租户。
- v1 只支持 Claude Code 和 Codex；其他 ACP backend 不迁移。
- 默认安全策略为密码登录 + JWT Cookie + WebSocket token 校验。
- 桌面客户端只是 WebUI 壳，不维护独立 Electron IPC 功能。
- Team MCP TCP 服务只监听 `127.0.0.1`，LAN/Tailscale 设备只能通过 WebUI 控制，不直接访问 MCP/ACP 子进程。
