import type { MailboxMessage } from '@shared/types';
import type { Db } from '@server/db/connection';
import { rowToMailbox } from '@server/db/mappers';

/** 负责团队内部 Agent 邮箱消息的写入、读取和已读状态推进。 */
export class MailboxRepository {
  constructor(private readonly db: Db) {}

  /** 写入一条 Agent 间消息，供目标成员稍后读取。 */
  writeMailbox(message: MailboxMessage): MailboxMessage {
    this.db
      .prepare(
        'INSERT INTO mailbox (id, team_id, to_agent_id, from_agent_id, content, summary, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        message.id,
        message.teamId,
        message.toAgentId,
        message.fromAgentId,
        message.content,
        message.summary ?? null,
        message.read ? 1 : 0,
        message.createdAt
      );
    return message;
  }

  /** 原子读取未读消息并标记已读，避免同一轮协作重复消费。 */
  readUnreadAndMark(teamId: string, toAgentId: string): MailboxMessage[] {
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT * FROM mailbox WHERE team_id = ? AND to_agent_id = ? AND read = 0 ORDER BY created_at ASC')
        .all(teamId, toAgentId) as any[];
      this.db.prepare('UPDATE mailbox SET read = 1 WHERE team_id = ? AND to_agent_id = ? AND read = 0').run(teamId, toAgentId);
      return rows.map(rowToMailbox);
    });
    return tx();
  }

  /** 查看目标成员未读消息，不改变已读状态，供前端徽标和预览使用。 */
  listUnreadMailbox(teamId: string, toAgentId: string): MailboxMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM mailbox WHERE team_id = ? AND to_agent_id = ? AND read = 0 ORDER BY created_at ASC')
      .all(teamId, toAgentId) as any[];
    return rows.map(rowToMailbox);
  }

  /** 列出团队全部邮箱消息，供团队视图合并展示最近协作内容。 */
  listMailbox(teamId: string): MailboxMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM mailbox WHERE team_id = ? ORDER BY created_at ASC')
      .all(teamId) as any[];
    return rows.map(rowToMailbox);
  }
}
