结论：**这两个 bridge 都支持 ACP 的图片输入，但都不等于支持“任意文件附件”作为二进制文件直传。**更准确地说：

| bridge                                  |       版本 | 图片输入                                                                                              | 文件附件                                                               |
| --------------------------------------- | -------: | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@agentclientprotocol/claude-agent-acp` | `0.29.2` | 支持。声明 `promptCapabilities.image = true`，并把 ACP `image` block 转成 Claude SDK 的 `image` content。     | 只支持 `resource_link` 和文本 `resource` 的上下文化；blob/binary resource 被忽略。 |
| `@zed-industries/codex-acp`             |  `0.9.5` | 支持。声明 `promptCapabilities.image = true`，并把 ACP `ContentBlock::Image` 转成 Codex `UserInput::Image`。 | 支持 `ResourceLink` 和文本 `TextResourceContents` 转为文本上下文；其他资源类型被跳过。    |

---

## 1. Claude bridge：图片输入是明确支持的

`@agentclientprotocol/claude-agent-acp` 的 `package.json` 确认包名是 `@agentclientprotocol/claude-agent-acp`，版本是 `0.29.2`，并且依赖 `@agentclientprotocol/sdk` 和 `@anthropic-ai/claude-agent-sdk`。 

它的 README 明确写了该 ACP agent 支持：

```text
Images
```



源码里 `initialize()` 返回的 `agentCapabilities` 也明确声明：

```ts
promptCapabilities: {
  image: true,
  embeddedContext: true,
}
```



更关键的是 `promptToClaude()`：它遍历 `params.prompt`，当 `chunk.type === "image"` 时，如果有 `chunk.data`，会转换为 Claude SDK 的 base64 image source；如果 `chunk.uri` 是 http URL，会转换成 URL image source。 

所以 Claude bridge 的图片输入支持是明确的，ACP 侧应该传：

```ts
{
  type: 'image',
  data: '<base64>',
  mimeType: 'image/png'
}
```

或者：

```ts
{
  type: 'image',
  uri: 'https://...'
}
```

---

## 2. Claude bridge：普通文件附件不能按 blob 直传

Claude bridge 的 `promptToClaude()` 对资源类型的处理是：

```text
resource_link -> 转成文本链接
resource(text) -> 转成 <context ref="..."> 文本上下文
resource(blob) -> 忽略
```

源码里 `resource_link` 会格式化成文本链接；文本 resource 会追加到 context；注释明确写着：

```ts
// Ignore blob resources (unsupported)
```



所以它不是“不支持任何文件”，而是：

```text
支持：
- file:// / zed:// / http 这类 resource_link，以链接文本形式给模型
- text resource，以上下文文本形式给模型

不支持：
- blob/binary resource 作为真正附件直传
```

---

## 3. Codex bridge：0.9.5 版本也明确支持图片输入

`@zed-industries/codex-acp` 在 `v0.9.5` tag 的 `npm/package.json` 中确认包名和版本：

```json
"name": "@zed-industries/codex-acp",
"version": "0.9.5"
```



`v0.9.5` 的 `initialize()` 里也明确声明：

```rust
PromptCapabilities::new()
  .embedded_context(true)
  .image(true)
```



`v0.9.5` 的 `handle_prompt()` 会先执行：

```rust
let items = build_prompt_items(request.prompt);
```

然后把这些 items 放进 `Op::UserInput` 提交给 Codex。 

而 `build_prompt_items()` 明确把：

```rust
ContentBlock::Image(image_block)
```

转换成：

```rust
UserInput::Image {
  image_url: format!("data:{};base64,{}", image_block.mime_type, image_block.data),
}
```



所以 Codex bridge `0.9.5` 也支持 ACP 图片输入，形式也是 ACP `ContentBlock::Image`，也就是你在客户端侧应传 base64 图片块，而不是本地路径。

---

## 4. Codex bridge：文件附件同样不是任意二进制直传

`build_prompt_items()` 对文件/资源类内容的处理是：

```text
ResourceLink -> 转成文本 @链接
TextResourceContents -> 转成 <context ref="..."> 文本上下文
Audio / Resource 其他类型 / 未识别类型 -> 跳过
```

源码里可以看到 `ResourceLink` 被转成文本，`TextResourceContents` 被转成文本上下文，最后注释写着：

```rust
// Skip other content types for now
```

并跳过 `ContentBlock::Audio(..) | ContentBlock::Resource(..) | _`。

所以 Codex bridge 也不是“文件附件全支持”，而是：

```text
支持：
- 图片 ContentBlock::Image
- ResourceLink 作为文本链接
- TextResourceContents 作为文本上下文

不支持：
- 任意二进制文件作为真正 attachment
- 非文本 EmbeddedResource
- Audio
```

---

## 5. 对当前项目的实现结论

你之前设计里“尝试 `{ type: 'image', mimeType, path }` 然后 fallback”的方案需要修正。根据这两个 bridge 的源码，**应该优先走 ACP 标准 image block 的 base64 字段，而不是 path 字段**。

推荐在你的 `AcpRuntime` 中构造：

```ts
{
  type: 'image',
  data: imageBase64,
  mimeType: image.mimeType
}
```

不要构造：

```ts
{
  type: 'image',
  path: image.path
}
```

因为 Claude bridge 的 `promptToClaude()` 只看 `chunk.data` 或 http `chunk.uri`，Codex bridge 的 `ContentBlock::Image` 也需要 `mime_type` 和 `data`，然后内部组装成 `data:${mime};base64,...`。 

---

## 6. 最终建议

图片输入可以放心做，编码策略改成：

```text
1. 前端上传图片。
2. 后端保存图片文件。
3. 发送 prompt 时，后端读取图片文件并转 base64。
4. ACP prompt 中追加：
   { type: 'image', data: base64, mimeType }
5. 文本文件可以作为 resource text 或直接拼进 prompt context。
6. 二进制文件不要做“附件直传”，先只显示为 resource_link 或拒绝。
```

一句话：**Claude ACP 0.29.2 和 Codex ACP 0.9.5 都有图片能力证据；但“文件附件”只支持链接或文本上下文，不支持任意 blob/binary attachment 直传。**
