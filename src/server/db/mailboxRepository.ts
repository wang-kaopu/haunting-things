import type { MailboxMessage } from '../../shared/types';
import type { Db } from './connection';
import { rowToMailbox } from './mappers';

export class MailboxRepository {
  constructor(private readonly db: Db) {}

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

  listUnreadMailbox(teamId: string, toAgentId: string): MailboxMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM mailbox WHERE team_id = ? AND to_agent_id = ? AND read = 0 ORDER BY created_at ASC')
      .all(teamId, toAgentId) as any[];
    return rows.map(rowToMailbox);
  }

  listMailbox(teamId: string): MailboxMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM mailbox WHERE team_id = ? ORDER BY created_at ASC')
      .all(teamId) as any[];
    return rows.map(rowToMailbox);
  }
}

export type MailboxRepositoryPort = Pick<
  MailboxRepository,
  'writeMailbox' | 'readUnreadAndMark' | 'listUnreadMailbox' | 'listMailbox'
>;
