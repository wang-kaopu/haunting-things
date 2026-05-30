# PLAN-3：Agent 协作交互逻辑改造计划

## 1. 背景

当前项目已经具备 Team、Mailbox、MCP/RPC、ACP Runtime 等基础能力：

- Team 创建时会创建 Leader Conversation。
- 每个 Team 会启动一个 MCP TCP Server。
- Agent 可以通过 stdio MCP 工具调用 Team RPC。
- 已有工具包括 `team_members`、`team_send_message`、`team_add_agent`、`team_remove_agent`、`team_finish_task`。
- Team 消息通过 mailbox 写库后唤醒目标 Agent。

但从新版代码检查结果看，当前协作交互仍然存在明显不足：

1. Codex 不容易主动发现“可以通过 RPC 启动 Claude 并加入 Team”。
2. `team_add_agent` 工具描述太弱，不能明确表达“启动另一个 AI Agent”的语义。
3. Agent 收到的 prompt 只包含 mailbox 消息，缺少 Team 身份、工具能力和协作策略说明。
4. 添加 Agent 后仍然会刷新整个 Team session，可能打断当前正在调用工具的 Codex。
5. `TeamMcpServer` 仍然持有 Team 快照，新增成员后需要重启 session 才能让旧 MCP Server 感知最新成员。
6. `backend` 参数仍然是普通字符串，没有严格限制为 `claude | codex`。
7. `team_send_message` 当前可能阻塞等待目标 Agent 完整执行一轮，不利于异步多 Agent 协作。
8. 测试覆盖了 MCP TCP 层基础行为，但尚未覆盖关键协作场景。

本计划目标是把现有“能手动协作”的 Team 系统，改造成“Agent 能主动发现、稳定委派、异步协作”的多 Agent 交互系统。

---

## 1.1 当前进度

- 问题一：已完成
- 问题二：已完成
- 问题四：已完成
- 问题五：已完成
- 问题六：已完成
- 问题七：已完成

---

## 2. 改造目标

### 2.1 短期目标

让 Codex 在 Team 中收到任务时，可以清楚知道：

- 自己当前处于一个 Team 中。
- 可以调用 `team_members` 查看成员。
- 可以调用 `team_add_agent` 启动并添加 Claude / Codex 队友。
- 可以调用 `team_send_message` 给队友分派任务。
- 如果任务适合审查、并行实现、补充分析或交叉验证，应主动启动 Claude 队友。

### 2.2 中期目标

增加更稳定的一步式委派能力：

```text
team_delegate_task
```

使 Agent 不需要自己组合：

```text
team_add_agent + team_send_message
```

而是可以一步完成：

```text
确保目标 backend 的队友存在，不存在则创建，然后把任务派发给它。
```

### 2.3 长期目标

优化 Team Runtime 架构：

- `TeamMcpServer` 不再持有创建时的 Team 快照。
- MCP 工具调用时动态读取最新 Team。
- 添加 Agent 后不重启所有已有 Agent。
- Team 消息投递改为异步唤醒，避免发送方被目标 Agent 执行阻塞。

---

## 3. 问题清单与改造方案

## 3.1 问题一：Codex 不容易发现可以启动 Claude

### 现状

当前 `formatMailbox` 只把未读消息格式化成：

```text
Message from <name>:
<content>
```

Agent 收到的上下文中没有明确说明：

- 当前是 Team 模式。
- 当前 Agent 的身份是什么。
- 当前 Team 有哪些成员。
- 有哪些 Team RPC 工具可用。
- 什么时候应该添加 Claude 队友。
- 添加 Claude 后应该继续发送任务消息。

### 改造方案

修改 `src/server/teamService.ts` 中的 `formatMailbox`，增加 Team 协作提示头。

建议格式：

```text
You are <agent.name>, a <agent.role> agent in team "<team.name>".

Current team members:
- Leader (leader, codex, idle)
- Claude Reviewer (teammate, claude, idle)

Available team RPC tools:
- team_members: list current teammates.
- team_add_agent: start another AI agent and add it to this team. Use backend exactly "claude" or "codex".
- team_send_message: send a message or task to a teammate.
- team_finish_task: report task completion back to the leader.

Collaboration rules:
- If a task benefits from review, cross-checking, parallel work, or another model's strengths, use team_add_agent.
- To start Claude Code, call team_add_agent with backend="claude".
- After adding a teammate, call team_send_message to assign the actual task.
- Use team_finish_task when your assigned work is complete.

Unread team messages:
...
```

### 注意点

- 提示头要短，但必须明确。
- 不要让提示头覆盖用户任务本身。
- 可以根据当前 Agent 角色调整提示：Leader 更强调委派，Teammate 更强调执行和回报。

### 验收标准

- 给 Codex Leader 发送复杂任务时，它能在回复或工具调用中主动考虑 `team_add_agent`。
- prompt 中能看到 `team_add_agent`、`team_send_message` 的明确用途。
- 不影响普通单 Agent 对话。

---

## 3.2 问题二：`team_add_agent` 工具描述太弱

### 现状

当前 MCP 工具描述类似：

```ts
server.tool(
  'team_add_agent',
  'Add a teammate to the current team.',
  {
    name: z.string().describe('Name for the new teammate'),
    backend: z.string().describe('Backend for the new teammate, such as claude or codex'),
  },
  ...
)
```

这个描述无法让 Codex 明确知道：

- 这是启动另一个 AI Agent。
- `backend="claude"` 会启动 Claude Code。
- 适合在审查、并行、交叉验证时调用。

### 改造方案

修改 `src/server/teamMcpStdio.ts`。

建议改成：

```ts
server.tool(
  'team_add_agent',
  'Start another AI agent and add it to the current team. Use backend="claude" to start Claude Code, backend="codex" to start Codex. Use this when the task benefits from review, parallel work, cross-checking, or another agent.',
  {
    name: z.string().describe('Human-readable teammate name, e.g. "Claude Reviewer" or "Codex Implementer"'),
    backend: z.enum(['claude', 'codex']).describe('Exact backend to start: "claude" or "codex"'),
  },
  async (args) => textResult(await callTeamTool('team_add_agent', args))
)
```

### 验收标准

- MCP 工具 schema 中 `backend` 只能是 `claude` 或 `codex`。
- Codex 查看工具时能明确知道如何启动 Claude。
- 传入非法 backend 时应在 MCP 参数层或服务端校验层被拒绝。

---

## 3.3 问题三：服务端 backend 缺少运行时校验

### 现状

共享类型中 `AgentBackend` 是：

```ts
export type AgentBackend = 'claude' | 'codex';
```

但 MCP Server 回调中存在强转：

```ts
backend: input.backend as AgentBackend
```

如果 Agent 传入 `Claude`、`claude-code`、`anthropic`，类型系统无法在运行时拦截。

### 改造方案

在 `src/server/teamMcpServer.ts` 或单独工具文件中新增校验函数：

```ts
function parseAgentBackend(value: unknown): AgentBackend {
  if (value === 'claude' || value === 'codex') return value;
  throw new Error('backend must be exactly "claude" or "codex"');
}
```

在 `addAgent` 中使用：

```ts
const backend = parseAgentBackend(args.backend);
```

避免继续使用裸 `String(...).trim()` + `as AgentBackend`。

### 验收标准

- 非法 backend 会得到明确错误：`backend must be exactly "claude" or "codex"`。
- TypeScript 不再需要在 Team MCP 回调处强转 backend。
- 相关测试覆盖非法 backend。

---

## 3.4 问题四：缺少一步式任务委派工具

### 现状

Agent 要让 Claude 加入并执行任务，需要自己完成两步：

```text
1. team_add_agent({ name: "Claude Reviewer", backend: "claude" })
2. team_send_message({ to: "Claude Reviewer", message: "..." })
```

这依赖模型自己规划工具链，不稳定。

### 改造方案

新增工具：

```text
team_delegate_task
```

建议参数：

```ts
{
  backend: z.enum(['claude', 'codex']).describe('Backend to delegate to'),
  name: z.string().optional().describe('Optional teammate name. If omitted, use a default name based on backend.'),
  task: z.string().describe('Task message to send to the teammate'),
  summary: z.string().optional().describe('Short UI summary')
}
```

建议行为：

1. 读取当前 Team 成员。
2. 查找是否已有匹配 backend 的 teammate。
3. 如果没有，则创建一个新 teammate。
4. 将 `task` 发送给目标 teammate。
5. 返回目标 Agent 名称和 slotId。

返回示例：

```text
Delegated task to Claude Reviewer (slot-xxxx). The teammate has been started if it did not already exist.
```

### 实现位置

- `src/server/teamMcpStdio.ts`：注册 MCP 工具。
- `src/server/teamMcpServer.ts`：增加 `team_delegate_task` 分支和实现。
- `src/server/teamService.ts`：必要时新增服务层方法，或复用 `addAgent` + `deliver`。

### 验收标准

- Codex 可以一次工具调用启动 Claude 并派发任务。
- 如果已有 Claude 队友，则复用已有队友。
- 不重复创建多个同名 Claude 队友。
- 测试覆盖“无队友时创建并派发”和“已有队友时直接派发”。

---

## 3.5 问题五：添加 Agent 后会重启所有 Agent

### 现状

`TeamService.addAgent` 更新 Team 后会调用：

```ts
this.scheduleSessionRefresh(updated.id);
```

`restartSession` 会：

1. 停止旧 MCP Server。
2. 创建新 MCP Server。
3. 给所有成员重新设置 MCP 配置。
4. 重启所有成员 Conversation Runtime。

这会带来风险：

- Codex 正在调用 `team_add_agent` 时，可能把自己重启掉。
- Codex 还没来得及继续 `team_send_message` 给新 Claude 分派任务。
- 正在执行中的其他 Agent 也可能被打断。

### 短期改造方案

添加 Agent 后只初始化新 Agent 的 MCP 配置，不重启所有旧 Agent。

可以新增方法：

```ts
private attachAgentToCurrentSession(teamId: string, agent: TeamAgent): void
```

逻辑：

1. 获取当前 session。
2. 用当前 MCP Server 给新 Agent 生成 stdio config。
3. 调用 `conversations.setMcpServers(agent.conversationId, [...])`。
4. 不调用旧 Agent 的 `restart`。

### 长期改造方案

配合 3.6，把 `TeamMcpServer` 改成动态读取最新 Team。这样旧 Agent 的 MCP Server 不需要重启，也能看到新成员。

### 验收标准

- Codex 调用 `team_add_agent` 后不会因为 session refresh 被打断。
- 已有 Agent 的 conversation runtime 不会被无条件 stop。
- 新 Agent 可以收到 MCP 配置并正常使用 Team 工具。

---

## 3.6 问题六：`TeamMcpServer` 持有 Team 快照

### 现状

`TeamMcpServer` 构造时保存 `team`：

```ts
constructor(
  private readonly team: Team,
  private readonly callbacks: TeamCallbacks
) {}
```

之后 `team_members`、`sendMessage`、`resolveTarget` 都基于这个旧快照。

因此新增成员后，旧 MCP Server 不能自然感知最新 Team，只能通过重启 session 刷新快照。

### 改造方案

将构造函数改成：

```ts
constructor(
  private readonly teamId: string,
  private readonly getTeam: () => Team,
  private readonly callbacks: TeamCallbacks
) {}
```

或者：

```ts
constructor(
  private readonly getTeam: () => Team,
  private readonly callbacks: TeamCallbacks
) {}
```

所有读取 Team 的位置都改为：

```ts
const team = this.getTeam();
```

涉及位置：

- `getStdioConfig`
- `team_members`
- `sendMessage`
- `addAgent`
- `removeAgent`
- `finishTask`
- `resolveTarget`

### 验收标准

- 添加新 Agent 后，旧 MCP Server 调用 `team_members` 能看到新成员。
- 添加 Agent 不再依赖重启 MCP Server 来刷新成员列表。
- `team_send_message` 可以发送给刚创建的新成员。

---

## 3.7 问题七：`team_send_message` 阻塞等待目标 Agent 完整执行

### 现状

`team_send_message` 最终会调用 `deliver`。

`deliver` 会写 mailbox 后立即：

```ts
await this.wakeAgent(message.teamId, message.toAgentId);
```

`wakeAgent` 又会等待：

```ts
await this.conversations.sendMessage(...)
```

这意味着发送方 Agent 的工具调用可能要等目标 Agent 完整执行完一轮才返回。

### 问题

这会使多 Agent 协作变成串行阻塞：

```text
Codex 发送任务给 Claude
  ↓
Claude 执行完整一轮
  ↓
Codex 的 tool call 才返回
  ↓
Codex 才能继续思考
```

### 改造方案

将消息投递和唤醒拆分：

```ts
private async deliver(message: MailboxMessage): Promise<void> {
  const team = this.requireTeam(message.teamId);
  this.repo.writeMailbox(message);
  this.events.emit('team.agent.message', { teamId: message.teamId, entry: this.buildMailboxEntry(team, message) });
  this.scheduleWakeAgent(message.teamId, message.toAgentId);
}
```

新增：

```ts
private scheduleWakeAgent(teamId: string, slotId: string): void {
  setTimeout(() => {
    void this.wakeAgent(teamId, slotId).catch((error) => {
      this.events.emit('team.agent.status', {
        teamId,
        slotId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 0);
}
```

### 注意点

异步唤醒后需要处理并发问题：

- 同一个 Agent 短时间收到多条消息时，避免重复并发唤醒。
- 可以增加 `wakingAgents` Set，按 `teamId:slotId` 去重。
- 如果执行过程中又收到消息，当前轮结束后再检查 unread。

### 验收标准

- `team_send_message` 工具调用能快速返回 `Message queued`。
- 目标 Agent 仍然会被唤醒并处理消息。
- 同一 Agent 不会被并发启动多轮 prompt。

---

## 4. 推荐实施顺序

## 阶段一：低风险快速修复

优先解决“Codex 看不见协作能力”的问题。

### 任务 1：强化 MCP 工具描述

修改文件：

```text
src/server/teamMcpStdio.ts
```

内容：

- 强化 `team_add_agent` 描述。
- `backend` 改成 `z.enum(['claude', 'codex'])`。
- 强化 `team_send_message` 描述，说明它用于分派任务和交接上下文。

### 任务 2：服务端 backend 运行时校验

修改文件：

```text
src/server/teamMcpServer.ts
```

内容：

- 新增 `parseAgentBackend`。
- 替换 `as AgentBackend`。
- 对非法 backend 返回明确错误。

### 任务 3：强化 Agent mailbox prompt

修改文件：

```text
src/server/teamService.ts
```

内容：

- 修改 `formatMailbox`。
- 加入 Team 身份、成员列表、工具说明、协作规则。

### 阶段一验收

- Codex 知道可以调用 `team_add_agent` 启动 Claude。
- Codex 知道添加后要用 `team_send_message` 分派任务。
- 非法 backend 被明确拒绝。

---

## 阶段二：增加一步委派能力

### 任务 4：新增 `team_delegate_task`

修改文件：

```text
src/server/teamMcpStdio.ts
src/server/teamMcpServer.ts
src/server/teamService.ts
```

内容：

- MCP stdio 注册 `team_delegate_task`。
- TCP Server 支持 `team_delegate_task` 分支。
- 服务端实现“查找或创建队友 + 发送任务”。

### 阶段二验收

- Codex 可以一次调用完成启动 Claude 并派发任务。
- 已有 Claude 队友时不会重复创建。
- UI timeline 能看到委派消息。

---

## 阶段三：优化 Runtime 架构

### 任务 5：TeamMcpServer 动态读取 Team

修改文件：

```text
src/server/teamMcpServer.ts
src/server/teamService.ts
```

内容：

- `TeamMcpServer` 构造函数改为接收 `getTeam`。
- 所有工具调用时读取最新 Team。
- 移除因刷新 Team 快照导致的 MCP Server 重启依赖。

### 任务 6：添加 Agent 后不重启所有 Agent

修改文件：

```text
src/server/teamService.ts
```

内容：

- 新增只为新 Agent 注入 MCP 配置的逻辑。
- 避免无条件 `scheduleSessionRefresh`。
- 确保新 Agent 首次被唤醒时能拿到 MCP 配置。

### 阶段三验收

- Codex 调用 `team_add_agent` 后不会被中断。
- 旧 MCP Server 的 `team_members` 可以看到新 Agent。
- 新 Agent 可以正常收发 Team 消息。

---

## 阶段四：异步化消息投递

### 任务 7：`team_send_message` 快速返回

修改文件：

```text
src/server/teamService.ts
src/server/teamMcpServer.ts
```

内容：

- `deliver` 写库后异步唤醒目标 Agent。
- 工具调用返回 `Message queued`。
- 增加同一 Agent 唤醒去重，避免并发 prompt。

### 阶段四验收

- 发送方 Agent 不会被目标 Agent 执行时间阻塞。
- 多条消息能被目标 Agent 顺序处理。
- timeline 状态能正确显示 pending / processed。

---

## 5. 测试计划

## 5.1 单元测试

### `teamMcpServer` 测试

新增或补充：

1. `team_add_agent` 接收 `backend="claude"` 时成功。
2. `team_add_agent` 接收非法 backend 时失败。
3. `team_delegate_task` 在没有 Claude 时创建 Claude 并发送任务。
4. `team_delegate_task` 在已有 Claude 时复用 Claude。
5. 添加 Agent 后 `team_members` 能返回最新成员。
6. `team_send_message` 能发送给刚创建的新 Agent。

### `teamService` 测试

新增或补充：

1. `formatMailbox` 包含 Team 身份说明。
2. `formatMailbox` 包含工具说明。
3. `formatMailbox` 包含 `backend="claude"` 的明确提示。
4. 添加 Agent 不会重启已有 Agent Runtime。
5. 异步 `deliver` 不阻塞发送方。
6. 同一 Agent 多次收到消息不会并发执行多轮 prompt。

## 5.2 集成测试

模拟流程：

```text
1. 创建 Codex Leader Team。
2. 用户发送复杂任务给 Codex。
3. Codex 调用 team_delegate_task 或 team_add_agent。
4. 系统创建 Claude Teammate。
5. Codex 给 Claude 发送任务。
6. Claude 执行后调用 team_finish_task。
7. Leader 收到完成消息。
```

验收点：

- Codex 不被添加 Agent 操作打断。
- Claude 能正常加入 Team。
- Claude 能收到任务并回复。
- Leader 能收到 Claude 完成通知。

---

## 6. 风险与注意事项

## 6.1 Prompt 过长风险

强化 `formatMailbox` 后，每次唤醒 Agent 都会带上 Team 协作提示。

控制方式：

- 提示头保持短小。
- 成员列表只展示必要字段。
- 后续可以把工具说明压缩为固定短文本。

## 6.2 异步唤醒并发风险

`team_send_message` 改成异步后，可能出现同一 Agent 被多次唤醒。

控制方式：

- 增加 `wakingAgents` Set。
- 以 `teamId:slotId` 作为 key。
- 当前轮结束后检查是否还有 unread 消息。

## 6.3 重构范围扩大风险

`TeamMcpServer` 动态读取 Team 会影响多个工具。

控制方式：

- 阶段一先做提示和 schema，不动架构。
- 阶段二再新增 `team_delegate_task`。
- 阶段三单独做动态 Team 重构。
- 每阶段都补测试。

---

## 7. 最终完成标准

当以下条件全部满足时，可以认为 PLAN-3 完成：

- Codex 在 Team 中能明确知道可以启动 Claude 队友。
- `team_add_agent` 的 MCP 工具描述能准确表达“启动另一个 Agent”。
- `backend` 参数被严格限制为 `claude | codex`。
- `team_delegate_task` 支持一步式委派。
- 添加 Agent 不会重启或打断已有 Agent。
- `TeamMcpServer` 能动态读取最新 Team。
- `team_send_message` 不再阻塞等待目标 Agent 完整执行。
- 单元测试和集成测试覆盖核心协作链路。

---

## 8. 推荐 Commit 拆分

建议按以下粒度提交：

```text
feat(team): 强化协作提示与 MCP 工具描述
fix(team): 校验 Agent backend 参数
feat(team): 新增任务委派工具
refactor(team): 动态读取 Team 成员状态
fix(team): 添加 Agent 时避免重启已有会话
feat(team): 异步化 Team 消息投递
test(team): 补充多 Agent 协作链路测试
```
