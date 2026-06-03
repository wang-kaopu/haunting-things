结论：这两个包都不是发一条“stop/interrupt”文本消息，而是按 **ACP 协议发 JSON-RPC notification：`session/cancel`**。ACP 文档明确给出的取消消息就是 `session/cancel`，并要求 Agent 最终让原来的 `session/prompt` 返回 `stopReason: "cancelled"`；如果还有权限弹窗，Client 也要用 `cancelled` outcome 回掉 pending 的 `session/request_permission`。([agentclientprotocol.com][1])

最小消息如下：

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "<当前 ACP sessionId>"
  }
}
```

注意这里**不要带 `id`**，因为这是 JSON-RPC notification，不需要响应；原先还没结束的 `session/prompt` 请求会在中断完成后返回 `cancelled`。

### @agentclientprotocol/claude-agent-acp

`claude-agent-acp` 的 `cancel()` 实现会：

1. 找到对应 session。
2. 设置 `session.cancelled = true`。
3. 把排队中的 pending prompt 全部 resolve 为 cancelled。
4. 调用 `session.query.interrupt()` 真正中断 Claude SDK 查询。

它在 `prompt()` 里也会检测取消状态：如果排队 prompt 被取消，直接返回 `{ stopReason: "cancelled" }`；查询结束时如果发现 `session.cancelled`，也返回 cancelled。 另外在收到 result 后，如果 session 已取消，会把 stopReason 设为 `cancelled`。

### @zed-industries/codex-acp

`codex-acp` 的外层 Agent `cancel()` 会根据 `sessionId` 找到 Thread，然后调用 `thread.cancel()`。

`Thread::cancel()` 会向内部 actor 发送 `ThreadMessage::Cancel`。 actor 收到后调用 `handle_cancel()`，先 detach pending interactions，再向 Codex core 提交 `Op::Interrupt`。

后续如果 Codex core 发出 `TurnAborted` 或 `ShutdownComplete` 事件，适配器会把原来的 prompt 响应结束为 `StopReason::Cancelled`。

### 如果你自己写 ACP Client，大概这样发

```ts
function cancelAcpTurn(
  transport: { send: (data: string) => void },
  sessionId: string,
) {
  transport.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: {
        sessionId,
      },
    }),
  );
}
```

如果你用的是封装好的 JSON-RPC client，形状通常就是：
s

```ts
client.sendNotification("session/cancel", {
  sessionId,
});
```

关键点：`sessionId` 必须是之前 `session/new`、`session/load` 或类似会话创建流程拿到的当前会话 ID；取消的是该 session 正在进行的 prompt turn，而不是发送一条新的用户消息。

### Haunting-things 实现约定

本项目把“停止生成”实现为取消当前 ACP prompt turn：

1. 前端运行中按钮调用 `conversation.cancel`。
2. `ConversationService.cancelCurrentTurn()` 转发到当前 conversation 的 runtime。
3. `AcpRuntime.cancelCurrentTurn()` 调用 `ClientSideConnection.cancel({ sessionId })`，由 SDK 发送 `session/cancel` notification。
4. 取消时会把所有 pending `session/request_permission` 响应为 `{ outcome: { outcome: "cancelled" } }`。
5. 原 `session/prompt` 返回 `stopReason: "cancelled"` 后，本轮以 `idle` 收尾，并在 `agent.done` 上带 `stopReason: "cancelled"` 供 UI 展示。

`ConversationService.stop()` / `AcpRuntime.stop()` 仍保留为关闭 ACP 子进程和释放 runtime 的语义，不用于普通“停止生成”。

[1]: https://agentclientprotocol.com/protocol/prompt-turn "Prompt Turn - Agent Client Protocol"
