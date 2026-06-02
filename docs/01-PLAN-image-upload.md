满足性检查结论：

```text
1. 尽量不用 JSON：上一版基本满足，但要明确禁止 files_json / attachments_json / mailbox.files_json。
2. 关联消息和附件：上一版普通 messages 已经能关联，但 Team mailbox 必须也用关系表，不能用 JSON。
3. 新方案应该统一用三类表：
   - attachments
   - message_attachments
   - mailbox_attachments
```

下面是修正后的编码方案。

---

# 图片上传与消息关联编码方案

## 一、核心原则

数据库里不存这些字段：

```sql
files_json TEXT
attachments_json TEXT
mailbox_files_json TEXT
```

也不要把图片 base64 存进：

```sql
messages.content
mailbox_messages.content
agent_events.payload
```

所有图片关系都用关系表：

```text
messages.id
  -> message_attachments.message_id
  -> attachments.id

mailbox_messages.id
  -> mailbox_attachments.mailbox_message_id
  -> attachments.id
```

---

# 二、数据库表设计

## 1. `attachments`

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  url TEXT NOT NULL,
  sha256 TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_kind
ON attachments(kind);

CREATE INDEX IF NOT EXISTS idx_attachments_created_at
ON attachments(created_at);
```

说明：

```text
kind      当前固定 image，后续可扩展 file/pdf/audio
path      后端真实文件路径，只给服务端用
url       前端访问图片的 URL
sha256    可选，用于以后去重
```

---

## 2. `message_attachments_rel`

普通聊天消息和附件的关联表。

```sql
CREATE TABLE IF NOT EXISTS message_attachments (
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id
ON message_attachments(message_id);

CREATE INDEX IF NOT EXISTS idx_message_attachments_attachment_id
ON message_attachments(attachment_id);
```

---

## 3. `mailbox_attachments_rel`

Team mailbox 消息和附件的关联表。

```sql
CREATE TABLE IF NOT EXISTS mailbox_attachments (
  mailbox_message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mailbox_message_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_message_id
ON mailbox_attachments(mailbox_message_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_attachment_id
ON mailbox_attachments(attachment_id);
```

要求：`mailbox_messages` 必须有稳定 `id` 字段。

---

# 三、Shared Types

`src/shared/types.ts`

```ts
export type AttachmentKind = "image";

export type AttachmentRef = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: number;
};

export type StoredAttachment = AttachmentRef & {
  path: string;
  sha256?: string;
};
```

`ChatMessage` 增加：

```ts
export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  attachments?: AttachmentRef[];
  createdAt: number;
  status?: "streaming" | "done" | "error";
};
```

上传接口：

```ts
'attachment.upload': {
  params: {
    fileName: string;
    mimeType: string;
    dataBase64: string;
  };
  result: AttachmentRef;
};
```

发送接口保留：

```ts
files?: string[];
```

但语义明确为：

```text
files = attachmentId[]
```

这是 RPC 参数，不是数据库 JSON 存储。

---

# 四、AttachmentService

新增：

```text
src/server/attachments.ts
```

职责：

```text
1. 校验图片 MIME。
2. 校验图片大小。
3. 解码 base64。
4. 计算 sha256。
5. 保存图片到 dataDir/attachments/<attachmentId>/<safeName>。
6. 返回 StoredAttachment。
```

限制：

```ts
const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
```

核心方法：

```ts
export class AttachmentService {
  constructor(private readonly rootDir: string) {}

  async saveImage(input: {
    fileName: string;
    mimeType: string;
    dataBase64: string;
  }): Promise<StoredAttachment> {
    // 校验 mimeType
    // strip data url prefix
    // Buffer.from(base64, 'base64')
    // 校验 size
    // crypto.createHash('sha256').update(buffer).digest('hex')
    // crypto.randomUUID()
    // mkdir + writeFile
    // 返回 StoredAttachment
  }
}
```

---

# 五、Repository 方法设计

`src/server/repository.ts`

## 1. 附件 CRUD

```ts
createAttachment(input: StoredAttachment): StoredAttachment;

getAttachment(id: string): StoredAttachment | null;

listAttachments(ids: string[]): StoredAttachment[];
```

`listAttachments(ids)` 必须保持传入顺序：

```ts
listAttachments(ids: string[]): StoredAttachment[] {
  if (ids.length === 0) return [];

  const uniqueIds = [...new Set(ids)];

  const rows = this.db
    .prepare(`
      SELECT * FROM attachments
      WHERE id IN (${uniqueIds.map(() => '?').join(',')})
    `)
    .all(...uniqueIds)
    .map(rowToStoredAttachment);

  const map = new Map(rows.map((item) => [item.id, item]));

  return uniqueIds
    .map((id) => map.get(id))
    .filter((item): item is StoredAttachment => Boolean(item));
}
```

---

## 2. 普通消息附件关联

```ts
linkMessageAttachments(messageId: string, attachmentIds: string[]): void;

listMessageAttachments(messageId: string): AttachmentRef[];

listMessageAttachmentsForMessages(
  messageIds: string[]
): Record<string, AttachmentRef[]>;
```

`linkMessageAttachments`：

```ts
linkMessageAttachments(messageId: string, attachmentIds: string[]): void {
  const stmt = this.db.prepare(`
    INSERT OR IGNORE INTO message_attachments (
      message_id,
      attachment_id,
      sort_order
    )
    VALUES (?, ?, ?)
  `);

  const tx = this.db.transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      stmt.run(messageId, id, index);
    });
  });

  tx([...new Set(attachmentIds)]);
}
```

`listMessages()` 不要 N+1，应该批量查询：

```ts
const messages = rows.map(rowToMessage);

const attachmentsByMessage = this.listMessageAttachmentsForMessages(
  messages.map((item) => item.id),
);

return messages.map((message) => ({
  ...message,
  attachments: attachmentsByMessage[message.id] ?? [],
}));
```

---

## 3. Mailbox 附件关联

```ts
linkMailboxAttachments(
  mailboxMessageId: string,
  attachmentIds: string[]
): void;

listMailboxAttachments(
  mailboxMessageId: string
): AttachmentRef[];

listMailboxAttachmentsForMessages(
  mailboxMessageIds: string[]
): Record<string, AttachmentRef[]>;
```

`listUnreadMailboxMessages()` 也要升级成返回附件：

```ts
listUnreadMailboxMessagesWithAttachments(
  teamId: string,
  toAgentId: string
): MailboxMessage[];
```

实现方式：

```text
1. 先查 unread mailbox_messages。
2. 拿到 mailbox message ids。
3. 批量查 mailbox_attachments + attachments。
4. 组装 attachments 字段。
```

---

# 六、后端注册上传与图片读取

`src/server/index.ts`

## 1. 初始化

```ts
const attachmentService = new AttachmentService(
  path.join(config.dataDir, "attachments"),
);
```

---

## 2. Bridge 上传接口

```ts
bridge.register(
  "attachment.upload",
  async ({ fileName, mimeType, dataBase64 }) => {
    const saved = await attachmentService.saveImage({
      fileName,
      mimeType,
      dataBase64,
    });

    const stored = repo.createAttachment(saved);

    return toAttachmentRef(stored);
  },
);
```

```ts
function toAttachmentRef(file: StoredAttachment): AttachmentRef {
  return {
    id: file.id,
    kind: file.kind,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    url: file.url,
    createdAt: file.createdAt,
  };
}
```

---

## 3. 图片访问接口

```ts
app.get("/api/attachments/:id/:name", requireAuth, (req, res) => {
  const attachment = repo.getAttachment(req.params.id);

  if (!attachment) {
    res.status(404).end();
    return;
  }

  res.type(attachment.mimeType);
  res.sendFile(attachment.path);
});
```

安全要求：

```text
1. 必须 requireAuth。
2. 不使用 req.params.name 拼真实路径。
3. 真实路径只能来自 attachments.path。
```

---

# 七、ConversationService 改造

## 1. 普通消息发送

`sendMessage()`：

```ts
async sendMessage(input: {
  conversationId: string;
  content: string;
  files?: string[];
}): Promise<void> {
  const conversation = this.repo.getConversation(input.conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`);
  }

  const attachments = this.repo.listAttachments(input.files ?? []);

  const userMessage = this.repo.addMessage({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    role: 'user',
    content: input.content,
    createdAt: Date.now(),
    status: 'done',
  });

  this.repo.linkMessageAttachments(
    userMessage.id,
    attachments.map((item) => item.id)
  );

  this.events.emit('conversation.stream', {
    conversationId: conversation.id,
    message: {
      ...userMessage,
      attachments: attachments.map(toAttachmentRef),
    },
  });

  const runtime = this.getRuntime(conversation);

  await runtime.send({
    text: input.content,
    attachments,
  });
}
```

注意：

```text
addMessage 不接收 attachments。
attachments 只通过 message_attachments 关联。
```

---

## 2. Team 唤醒发送

`sendRuntimePrompt()`：

```ts
async sendRuntimePrompt(input: {
  conversationId: string;
  prompt: string;
  displayMessage?: string;
  files?: string[];
}): Promise<void> {
  const conversation = this.repo.getConversation(input.conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`);
  }

  const attachments = this.repo.listAttachments(input.files ?? []);

  if (input.displayMessage?.trim() || attachments.length > 0) {
    const userMessage = this.repo.addMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      content: input.displayMessage?.trim() ?? '',
      createdAt: Date.now(),
      status: 'done',
    });

    this.repo.linkMessageAttachments(
      userMessage.id,
      attachments.map((item) => item.id)
    );

    this.events.emit('conversation.stream', {
      conversationId: conversation.id,
      message: {
        ...userMessage,
        attachments: attachments.map(toAttachmentRef),
      },
    });
  }

  const runtime = this.getRuntime(conversation);

  await runtime.send({
    text: input.prompt,
    attachments,
  });
}
```

这样满足：

```text
1. Team wrapper prompt 不进 UI。
2. displayMessage 和图片附件能正确关联。
3. Agent runtime 能收到图片。
```

---

# 八、TeamService 改造

## 1. MailboxMessage 类型

```ts
export type MailboxMessage = {
  id: string;
  teamId: string;
  toAgentId: string;
  fromAgentId: string;
  content: string;
  attachments?: AttachmentRef[];
  read: boolean;
  createdAt: number;
};
```

不加：

```ts
files_json;
attachments_json;
```

---

## 2. deliver 内部参数

```ts
type DeliverInput = {
  teamId: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  attachmentIds?: string[];
};
```

`deliver()`：

```ts
const mailboxMessage = this.repo.addMailboxMessage({
  id: crypto.randomUUID(),
  teamId: input.teamId,
  fromAgentId: input.fromAgentId,
  toAgentId: input.toAgentId,
  content: input.content,
  read: false,
  createdAt: Date.now(),
});

this.repo.linkMailboxAttachments(mailboxMessage.id, input.attachmentIds ?? []);
```

---

## 3. team.sendMessage

```ts
async sendMessage(input: {
  teamId: string;
  content: string;
  files?: string[];
}): Promise<void> {
  await this.deliver({
    teamId: input.teamId,
    fromAgentId: 'user',
    toAgentId: leader.slotId,
    content: input.content,
    attachmentIds: input.files ?? [],
  });
}
```

---

## 4. wakeAgent

```ts
const messages = this.repo.listUnreadMailboxMessagesWithAttachments(
  team.id,
  agent.slotId,
);

const attachmentIds = unique(
  messages.flatMap((message) =>
    (message.attachments ?? []).map((attachment) => attachment.id),
  ),
);

await this.conversations.sendRuntimePrompt({
  conversationId: agent.conversationId,
  prompt,
  displayMessage: formatMailboxDisplay(messages, team),
  files: attachmentIds,
});
```

`formatMailboxDisplay()`：

```ts
function formatMailboxDisplay(messages: MailboxMessage[], team: Team): string {
  return messages
    .map((message) => {
      const lines = [
        `${formatSender(message.fromAgentId, team)}: ${message.content}`,
      ];

      if (message.attachments?.length) {
        lines.push(`[图片附件 ${message.attachments.length} 张]`);
      }

      return lines.join("\n");
    })
    .join("\n");
}
```

---

# 九、AcpRuntime 改造

`src/server/acpRuntime.ts`

```ts
export type RuntimePromptInput = {
  text: string;
  attachments?: StoredAttachment[];
};
```

`send()`：

```ts
async send(input: string | RuntimePromptInput): Promise<void> {
  const normalized =
    typeof input === 'string'
      ? { text: input, attachments: [] }
      : { text: input.text, attachments: input.attachments ?? [] };

  const prompt = await this.buildPromptBlocks(normalized);

  await this.connection!.prompt({
    sessionId: this.sessionId!,
    prompt,
  });
}
```

`buildPromptBlocks()`：

```ts
private async buildPromptBlocks(input: RuntimePromptInput): Promise<unknown[]> {
  const blocks: unknown[] = [];

  if (input.text.trim()) {
    blocks.push({
      type: 'text',
      text: input.text,
    });
  }

  for (const attachment of input.attachments ?? []) {
    if (attachment.kind !== 'image') continue;

    const buffer = await fs.promises.readFile(attachment.path);

    blocks.push({
      type: 'image',
      data: buffer.toString('base64'),
      mimeType: attachment.mimeType,
    });
  }

  return blocks;
}
```

不使用：

```ts
{ type: 'image', path: attachment.path }
```

---

# 十、前端改造

## 1. SendBox

`onSend` 类型：

```ts
onSend: (input: { content: string; files?: string[] }) => Promise<void>;
```

状态：

```ts
const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
```

允许纯图片消息：

```ts
const canSend =
  (content.trim().length > 0 || attachments.length > 0) &&
  !disabled &&
  !sending;
```

发送：

```ts
await onSend({
  content: content.trim(),
  files: attachments.map((item) => item.id),
});

setContent("");
setAttachments([]);
```

---

## 2. ImageAttachmentPicker

新增：

```text
src/renderer/app/chat/ImageAttachmentPicker.tsx
```

功能：

```text
1. 点击上传
2. 粘贴上传
3. 拖拽上传
4. 预览缩略图
5. 删除附件
```

上传：

```ts
const attachment = await bridge.invoke("attachment.upload", {
  fileName: file.name || "image.png",
  mimeType: file.type,
  dataBase64,
});
```

前端只保存 `AttachmentRef`，不保存 base64。

---

## 3. useConversationStream

```ts
sendTeamMessage(input: {
  content: string;
  files?: string[];
}): Promise<void>;
```

调用 `resolveTeamSendInvocation()` 时传入 `files`。

---

## 4. MessageBubble

```tsx
{
  message.attachments?.length ? (
    <div className="message-attachments">
      {message.attachments.map((attachment) => (
        <a
          key={attachment.id}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
        >
          <img src={attachment.url} alt={attachment.name} />
        </a>
      ))}
    </div>
  ) : null;
}
```

---

# 十一、最终满足性

## 1. 尽量不用 JSON

满足。

新方案里附件相关数据不使用 JSON 字段：

```text
attachments               普通表
message_attachments       关系表
mailbox_attachments       关系表
```

允许存在的 JSON 只有：

```text
1. 前后端 RPC 参数序列化，这是通信层，不是数据库存储。
2. 现有 agent_events.payload，如果项目原本就这么设计，本次图片功能不要继续往里面塞图片或附件。
```

---

## 2. 关联消息和附件

满足。

关联关系完整：

```text
普通 conversation message:
messages.id
  -> message_attachments.message_id
  -> attachments.id

Team mailbox message:
mailbox_messages.id
  -> mailbox_attachments.mailbox_message_id
  -> attachments.id

Team 唤醒后的可见消息:
messages.id
  -> message_attachments.message_id
  -> attachments.id
```

图片不会只“上传成功但没有归属”。

---

# 十二、测试清单

## 数据库检查

```sql
SELECT name, sql
FROM sqlite_master
WHERE type = 'table'
AND (
  sql LIKE '%files_json%'
  OR sql LIKE '%attachments_json%'
);
```

预期：无结果。

检查关联：

```sql
SELECT * FROM attachments;
SELECT * FROM message_attachments;
SELECT * FROM mailbox_attachments;
```

---

## 功能检查

```text
1. 上传图片后 attachments 有记录。
2. 发送普通消息后 message_attachments 有记录。
3. 发送 Team 消息后 mailbox_attachments 有记录。
4. Team 唤醒后目标 conversation 的 messages + message_attachments 也有记录。
5. 刷新页面后历史图片仍显示。
6. Claude / Codex bridge 收到 image block。
7. 未登录访问 /api/attachments/:id/:name 被拒绝。
```

---

# 十三、推荐提交

```text
feat(attachments): 增加图片附件表和上传服务
feat(chat): 使用关系表关联消息和图片附件
feat(team): 使用关系表关联 mailbox 和图片附件
feat(acp): 通过 image block 向 bridge 发送图片
feat(ui): 支持发送框上传和预览图片
```

最终可合并为：

```text
feat(attachments): 支持图片上传并关联消息
```
