# 记忆压缩与输入预算预检

## 当前策略

- 固定按 200k context window 做预算基准。
- 预计上下文达到 150k tokens 时触发记忆压缩。
- 压缩后仍达到 180k tokens 硬安全线时拒绝发送。
- 当前请求本身不会被自动截断，超限时要求用户拆分输入。
- 压缩结果写入 SQLite `conversation_memories`，原始 `messages` 不删除、不改写。

## 上下文构造变化

旧策略只在 ACP session 恢复失败时注入最近 20 条稳定文本消息。

新策略统一使用：

1. `conversation_memories.summary`
2. `covered_until_sequence` 之后的最近 20 条稳定文本消息
3. 当前请求原文

当前请求永不裁剪。summary 和 recent tail 是派生上下文，可在预算不足时继续压缩或重建。

## 二阶段压缩

压缩分两步执行：

1. 同步规则压缩：发送前或手动压缩时先用本地规则生成 `conversation_memories.summary`，保证能立即重建新 ACP session，避免继续撑爆旧上下文。
2. 后台模型摘要：规则摘要成功后启动独立 ACP session 生成更高质量的中文记忆。这个 session 不复用主对话、不写入聊天消息，也不依赖 bridge 的 compact/slash command。

后台模型摘要成功后会覆盖同一条 `conversation_memories.summary`。如果后台摘要失败，系统继续使用规则摘要，并把 memory 状态标记为 warning。若后台摘要完成前已经发生新的压缩，旧摘要会被丢弃，避免覆盖更新的记忆范围。

## ACP session 重建

本项目不依赖 Claude/Codex bridge 的 compact/slash command。应用层完成压缩后会清除旧 `acp_session_id` 并释放当前 runtime，让下一轮发送新建 ACP session，再注入 summary + recent tail。

## Team mailbox 语义

Team 唤醒 Agent 时先 peek unread mailbox，不立即标记已读。预算预检通过、即将发送 runtime prompt 前才按 message id 标记已读。

如果预算预检失败，mailbox 保持 unread，后续可重试。

如果 runtime 发送已经开始后失败，不自动恢复 unread，避免同一任务被重复执行。
