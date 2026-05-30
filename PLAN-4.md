## 集成测试方案：Codex Leader 与 Claude Teammate 协作闭环

### 1. 测试目标

本集成测试用于验证 Team 多 Agent 协作链路是否真正闭环，而不是只验证单个 service 或 MCP tool 的函数行为。

重点验证以下链路：

```text
创建 Codex Leader Team
  ↓
用户向 Leader 发送任务
  ↓
Leader 通过 team_delegate_task / team_add_agent 添加 Claude
  ↓
Leader 将任务派发给 Claude
  ↓
Claude 收到任务并完成
  ↓
Claude 通过 team_finish_task 或 team_send_message 回传结果
  ↓
Leader mailbox 收到 Claude 结果
  ↓
Leader 被唤醒并继续处理
```

最终目标是证明：

- Team 创建后 Leader 能拿到 Team MCP 配置。
- Codex Leader 可以添加 Claude Teammate。
- Claude Teammate 可以收到任务。
- Claude 的完成结果可以回流到 Leader。
- Leader 不会因为添加 Claude 被重启或中断。
- Team timeline / mailbox 中能看到完整消息链路。

---

### 2. 测试文件建议

新增文件：

```text
tests/teamIntegration.test.ts
```

如果后续需要真实 CLI/ACP 测试，可以再拆出：

```text
tests/teamAcpIntegration.test.ts
```

建议先做“半集成测试”，即不真正启动 Codex/Claude CLI，而是 mock `ConversationService` / `AcpRuntime` 行为，验证 TeamService + TeamMcpServer + Repository + EventBus 的完整业务闭环。

真实 Codex/Claude CLI 测试可以作为单独的 e2e 测试，避免普通 `npm test` 依赖本机账号、模型额度、CLI 安装状态。

---

### 3. 测试分层

#### 3.1 半集成测试：默认纳入 `npm test`

特点：

- 使用真实 SQLite 内存库。
- 使用真实 `Repository`。
- 使用真实 `TeamService`。
- 使用真实 `TeamMcpServer` 或直接调用 service 方法。
- mock `ConversationService.sendMessage()`，不启动真实 Codex/Claude。
- 通过捕获 `sendMessage` 入参模拟 Agent 收到 prompt。
- 通过调用 `team_delegate_task` / `finishTask` 模拟 Agent 行为。

适合验证核心业务链路。

#### 3.2 真实 e2e 测试：默认跳过

特点：

- 真实启动服务端。
- 真实启动 `@zed-industries/codex-acp` 和 `@agentclientprotocol/claude-agent-acp`。
- 真实验证 MCP tools 是否进入 Codex/Claude 工具列表。
- 真实执行“问 Claude 当前模型”这类任务。

由于依赖本机 CLI、登录状态和网络环境，建议默认跳过：

```ts
const runRealAcp = process.env.RUN_REAL_ACP === "1";
(runRealAcp ? describe : describe.skip)("real ACP team flow", () => {
  // ...
});
```

运行方式：

```bash
RUN_REAL_ACP=1 npm test
```

---

### 4. 半集成测试用例设计

### 用例一：创建 Codex Leader Team 后应注入 MCP 配置

#### 目的

验证 Team 创建时，Leader conversation 会被配置 Team MCP server。

#### 步骤

1. 创建内存 SQLite Repository。
2. 创建 mock ConversationService。
3. 创建 TeamService。
4. 调用：

```ts
await teamService.create({
  name: "Integration Team",
  leaderBackend: "codex",
});
```

5. 检查 mock ConversationService 的 `setMcpServers` 被调用。
6. 检查 MCP 配置包含：

```text
command
args
TEAM_MCP_PORT
TEAM_MCP_TOKEN
TEAM_AGENT_SLOT_ID
```

#### 断言

- Team 中只有一个 Leader。
- Leader backend 是 `codex`。
- Leader conversation 收到了 MCP servers 配置。
- `restart` 不应导致 Leader 会话丢失。

---

### 用例二：Leader 添加 Claude 后不应重启 Leader

#### 目的

验证添加 Claude Teammate 时，只初始化新 Agent，不重启已有 Leader。

#### 步骤

1. 创建 Codex Leader Team。
2. 清空 mock 调用记录。
3. 调用：

```ts
await teamService.addAgent({
  teamId: team.id,
  name: "Claude Reviewer",
  backend: "claude",
});
```

4. 检查新 Agent 已加入 Team。
5. 检查新 Agent conversation 有 MCP 配置。
6. 检查 Leader conversation 没有被 stop/restart。

#### 断言

- Team agents 数量从 1 变成 2。
- 新 Agent backend 是 `claude`。
- 新 Agent role 是 `teammate`。
- Leader runtime 不被重启。
- 新 Agent 可以拿到 `TEAM_AGENT_SLOT_ID`。

---

### 用例三：Leader 使用 `team_delegate_task` 创建 Claude 并派发任务

#### 目的

验证一步式委派工具能完成“创建 Claude + 写入 Claude mailbox + 唤醒 Claude”。

#### 步骤

1. 创建 Codex Leader Team。
2. 通过 Team MCP Server 调用：

```ts
team_delegate_task({
  backend: "claude",
  name: "Claude Reviewer",
  task: "请回答你当前使用的模型是什么",
  summary: "询问 Claude 当前模型",
});
```

3. 检查 Team 中新增 Claude。
4. 检查 mailbox 中存在一条发给 Claude 的消息。
5. 检查 mock `ConversationService.sendMessage` 被调用，目标是 Claude conversation。
6. 检查 Claude 收到的 prompt 中包含：

```text
You are Claude Reviewer
Current teammates
Unread team messages
请回答你当前使用的模型是什么
```

#### 断言

- `team_delegate_task` 返回成功信息。
- Claude 被创建。
- Claude 收到任务消息。
- Claude 被异步唤醒。
- Leader 没有被同步阻塞等待 Claude 执行完成。

---

### 用例四：已有 Claude 时 `team_delegate_task` 应复用现有 Agent

#### 目的

避免每次委派都创建一个新的 Claude。

#### 步骤

1. 创建 Codex Leader Team。
2. 先添加一个 Claude Reviewer。
3. 再调用：

```ts
team_delegate_task({
  backend: "claude",
  task: "请审查当前实现",
});
```

4. 检查 Team agents 数量没有继续增加。
5. 检查任务消息发送给已有 Claude。

#### 断言

- Team agents 数量仍为 2。
- 没有重复创建 Claude。
- mailbox 中任务目标是已有 Claude 的 slotId。

---

### 用例五：Claude 调用 `team_finish_task` 后 Leader 应收到结果

#### 目的

验证 Claude 完成任务后，结果能回流 Leader mailbox，并唤醒 Codex Leader。

#### 步骤

1. 创建 Codex Leader Team。
2. 添加 Claude Teammate。
3. 模拟 Claude 完成任务，调用：

```ts
await teamService.finishTask({
  teamId: team.id,
  fromSlotId: claude.slotId,
  summary: "Claude 当前模型是 xxx",
});
```

4. 检查 mailbox 中出现一条发给 Leader 的消息。
5. 检查消息来源是 Claude。
6. 检查 Leader 的 conversation 被 `sendMessage` 唤醒。
7. 检查 Leader 收到的 prompt 中包含 Claude 的完成结果。

#### 断言

- Leader mailbox 中存在 `Task finished: Claude 当前模型是 xxx`。
- 该消息 `fromAgentId` 是 Claude slotId。
- 该消息 `toAgentId` 是 Leader slotId。
- Codex Leader 被唤醒。
- Leader prompt 能看到 Claude 的结果。

---

### 用例六：Claude 直接 `team_send_message` 给 Leader 时 Leader 应收到消息

#### 目的

验证非任务完成场景下，Claude 也可以主动给 Leader 发消息。

#### 步骤

1. 创建 Codex Leader Team。
2. 添加 Claude Teammate。
3. 模拟 Claude 调用 `team_send_message`：

```ts
team_send_message({
  to: "Leader",
  message: "我当前使用的是 Claude 模型。",
});
```

4. 检查 Leader mailbox。
5. 检查 Leader 被唤醒。

#### 断言

- Leader 收到 Claude 消息。
- 消息内容完整。
- Timeline 可展示 `Claude Reviewer → Leader`。
- Leader conversation 被调用一次。

---

### 用例七：非法 backend 应被拒绝

#### 目的

验证运行时 backend 校验有效。

#### 步骤

调用：

```ts
team_delegate_task({
  backend: "claude-code",
  task: "test",
});
```

或：

```ts
team_add_agent({
  name: "Bad Agent",
  backend: "anthropic",
});
```

#### 断言

- 抛出错误。
- 错误信息包含：

```text
backend must be exactly "claude" or "codex"
```

- Team agents 数量不变。
- 没有创建无效 conversation。

---

### 5. Mock 设计

建议实现一个 `FakeConversationService`：

```ts
class FakeConversationService {
  conversations = new Map<string, any>();
  mcpServers = new Map<string, any[]>();
  sentMessages: Array<{ conversationId: string; content: string }> = [];
  restarted: string[] = [];
  stopped: string[] = [];

  create(input: { backend: AgentBackend; workspace?: string; name?: string }) {
    const conversation = {
      id: crypto.randomUUID(),
      backend: input.backend,
      name: input.name || `${input.backend} conversation`,
      workspace: input.workspace || "/tmp/team-integration",
      status: "idle",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  setMcpServers(conversationId: string, servers: any[]) {
    this.mcpServers.set(conversationId, servers);
  }

  restart(conversationId: string) {
    this.restarted.push(conversationId);
  }

  stop(conversationId: string) {
    this.stopped.push(conversationId);
  }

  async sendMessage(input: { conversationId: string; content: string }) {
    this.sentMessages.push(input);
  }
}
```

这样可以验证 TeamService 的行为，而不依赖真实 Codex/Claude。

---

### 6. EventBus 验证

集成测试中建议监听以下事件：

```text
team.agent.added
team.agent.message
team.agent.status
team.turn.finished
```

断言事件顺序大致为：

```text
team.agent.added
team.agent.message  // Leader → Claude
team.agent.status active  // Claude active
team.turn.finished  // Claude turn finished
team.agent.status idle
team.agent.message  // Claude → Leader
team.agent.status active  // Leader active
team.turn.finished  // Leader turn finished
team.agent.status idle
```

注意：如果消息投递是异步的，测试中需要使用 `waitFor` / `eventually` 模式，而不是立刻断言。

示例：

```ts
async function waitFor(predicate: () => boolean, timeout = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor timeout");
}
```

---

### 7. 推荐测试结构

```ts
describe("team integration flow", () => {
  it("injects MCP config when creating a codex leader team", async () => {
    // ...
  });

  it("adds claude teammate without restarting leader", async () => {
    // ...
  });

  it("delegates a task to claude and wakes claude", async () => {
    // ...
  });

  it("reuses existing claude teammate when delegating again", async () => {
    // ...
  });

  it("delivers claude finishTask result back to codex leader", async () => {
    // ...
  });

  it("allows claude to send a direct message to leader", async () => {
    // ...
  });

  it("rejects invalid backend values", async () => {
    // ...
  });
});
```

---

### 8. 真实 ACP e2e 测试方案

真实 e2e 测试不建议默认运行。可以新增：

```text
tests/teamRealAcp.e2e.test.ts
```

默认跳过：

```ts
const describeRealAcp =
  process.env.RUN_REAL_ACP === "1" ? describe : describe.skip;
```

测试前置条件：

```text
1. 本机已安装 codex CLI。
2. 本机已安装 claude CLI。
3. 两者都已登录。
4. 网络可访问模型服务。
5. 已完成 npm run build 或开发模式 stdio 路径可用。
```

测试流程：

```text
1. 启动真实 server。
2. 通过 WebBridge 或 HTTP/WebSocket 创建 Codex Leader Team。
3. 发送用户消息：“问问 Claude 在用什么模型”。
4. 等待 Codex 调用 team_delegate_task。
5. 等待 Claude 回复或调用 team_finish_task。
6. 检查 Team timeline 中存在 Claude → Leader 的消息。
7. 检查 Leader conversation 后续收到 Claude 结果。
```

验收标准：

```text
- Codex 真实工具列表中可以使用 team_delegate_task。
- Claude 能被真实启动。
- Claude 能收到任务。
- Leader 能收到 Claude 回传。
```

---

### 9. 成功标准

本集成测试方案完成后，应满足：

```text
1. npm test 可以稳定通过半集成测试。
2. 不依赖真实 Codex/Claude CLI 的测试能覆盖核心 Team 协作业务。
3. RUN_REAL_ACP=1 npm test 可以手动验证真实 ACP/MCP 注入链路。
4. 任何一处回归，如 MCP 配置未注入、Leader 被错误重启、Claude 回复未回流 Leader，都能被测试捕获。
```

---

### 10. 推荐提交信息

```text
test(team): 补充多 Agent 协作集成测试方案
```
