import type { AttachmentRef, StoredAttachment } from '../../shared/types';
import type { Db } from './connection';
import { rowToStoredAttachment, toAttachmentRef } from './mappers';

export class AttachmentRepository {
  constructor(private readonly db: Db) {}

  createAttachment(input: StoredAttachment): StoredAttachment {
    this.db
      .prepare(
        `INSERT INTO attachments (id, kind, name, mime_type, size, path, url, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.kind,
        input.name,
        input.mimeType,
        input.size,
        input.path,
        input.url,
        input.sha256 ?? null,
        input.createdAt
      );
    return input;
  }

  getAttachment(id: string): StoredAttachment | null {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as any;
    return row ? rowToStoredAttachment(row) : null;
  }

  listAttachments(ids: string[]): StoredAttachment[] {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const rows = this.db
      .prepare(`SELECT * FROM attachments WHERE id IN (${uniqueIds.map(() => '?').join(',')})`)
      .all(...uniqueIds) as any[];
    const byId = new Map(rows.map((row) => [row.id, rowToStoredAttachment(row)]));
    return uniqueIds.map((id) => byId.get(id)).filter((item): item is StoredAttachment => Boolean(item));
  }

  linkMessageAttachments(messageId: string, attachmentIds: string[]): void {
    this.linkAttachments('message_attachments', 'message_id', messageId, attachmentIds);
  }

  listMessageAttachments(messageId: string): AttachmentRef[] {
    return this.listMessageAttachmentsForMessages([messageId])[messageId] ?? [];
  }

  listMessageAttachmentsForMessages(messageIds: string[]): Record<string, AttachmentRef[]> {
    return this.listLinkedAttachments('message_attachments', 'message_id', messageIds);
  }

  linkMailboxAttachments(mailboxMessageId: string, attachmentIds: string[]): void {
    this.linkAttachments('mailbox_attachments', 'mailbox_message_id', mailboxMessageId, attachmentIds);
  }

  listMailboxAttachments(mailboxMessageId: string): AttachmentRef[] {
    return this.listMailboxAttachmentsForMessages([mailboxMessageId])[mailboxMessageId] ?? [];
  }

  listMailboxAttachmentsForMessages(mailboxMessageIds: string[]): Record<string, AttachmentRef[]> {
    return this.listLinkedAttachments('mailbox_attachments', 'mailbox_message_id', mailboxMessageIds);
  }

  deleteAttachment(attachmentId: string): StoredAttachment[] {
    const attachment = this.getAttachment(attachmentId);
    if (!attachment) return [];
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM message_attachments WHERE attachment_id = ?').run(attachmentId);
      this.db.prepare('DELETE FROM mailbox_attachments WHERE attachment_id = ?').run(attachmentId);
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);
    });
    tx();
    return [attachment];
  }

  deleteMessage(messageId: string): StoredAttachment[] {
    const attachmentIds = this.getMessageAttachmentIds([messageId]);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM message_attachments WHERE message_id = ?').run(messageId);
      this.db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
      return this.deleteUnreferencedAttachments(attachmentIds);
    });
    return tx();
  }

  deleteMessageAttachment(messageId: string, attachmentId: string): StoredAttachment[] {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM message_attachments WHERE message_id = ? AND attachment_id = ?')
        .run(messageId, attachmentId);
      return this.deleteUnreferencedAttachments([attachmentId]);
    });
    return tx();
  }

  deleteTeamAttachments(teamId: string, conversationIds: string[]): StoredAttachment[] {
    const mailboxIds = this.getMailboxIdsForTeam(teamId);
    const messageIds = this.getMessageIdsForConversations(conversationIds);
    const attachmentIds = [
      ...this.getMailboxAttachmentIds(mailboxIds),
      ...this.getMessageAttachmentIds(messageIds),
    ];

    const tx = this.db.transaction(() => {
      if (mailboxIds.length > 0) {
        this.db
          .prepare(`DELETE FROM mailbox_attachments WHERE mailbox_message_id IN (${mailboxIds.map(() => '?').join(',')})`)
          .run(...mailboxIds);
      }
      if (messageIds.length > 0) {
        this.db
          .prepare(`DELETE FROM message_attachments WHERE message_id IN (${messageIds.map(() => '?').join(',')})`)
          .run(...messageIds);
      }
      return this.deleteUnreferencedAttachments(attachmentIds);
    });
    return tx();
  }

  private linkAttachments(table: string, ownerColumn: string, ownerId: string, attachmentIds: string[]): void {
    const uniqueIds = [...new Set(attachmentIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO ${table} (${ownerColumn}, attachment_id, sort_order) VALUES (?, ?, ?)`
    );
    const tx = this.db.transaction((ids: string[]) => {
      ids.forEach((id, index) => stmt.run(ownerId, id, index));
    });
    tx(uniqueIds);
  }

  private listLinkedAttachments(table: string, ownerColumn: string, ownerIds: string[]): Record<string, AttachmentRef[]> {
    const uniqueOwnerIds = [...new Set(ownerIds.filter(Boolean))];
    if (uniqueOwnerIds.length === 0) return {};

    const rows = this.db
      .prepare(
        `SELECT rel.${ownerColumn} AS owner_id,
          a.id,
          a.kind,
          a.name,
          a.mime_type,
          a.size,
          a.path,
          a.url,
          a.sha256,
          a.created_at
        FROM ${table} rel
        JOIN attachments a ON a.id = rel.attachment_id
        WHERE rel.${ownerColumn} IN (${uniqueOwnerIds.map(() => '?').join(',')})
        ORDER BY rel.sort_order ASC`
      )
      .all(...uniqueOwnerIds) as Array<any & { owner_id: string }>;

    const result: Record<string, AttachmentRef[]> = {};
    for (const row of rows) {
      const ownerId = row.owner_id;
      result[ownerId] = result[ownerId] ?? [];
      result[ownerId].push(toAttachmentRef(rowToStoredAttachment(row)));
    }
    return result;
  }

  private getMailboxIdsForTeam(teamId: string): string[] {
    const rows = this.db.prepare('SELECT id FROM mailbox WHERE team_id = ?').all(teamId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private getMessageIdsForConversations(conversationIds: string[]): string[] {
    const ids = [...new Set(conversationIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT id FROM messages WHERE conversation_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private getMessageAttachmentIds(messageIds: string[]): string[] {
    return this.getLinkedAttachmentIds('message_attachments', 'message_id', messageIds);
  }

  private getMailboxAttachmentIds(mailboxMessageIds: string[]): string[] {
    return this.getLinkedAttachmentIds('mailbox_attachments', 'mailbox_message_id', mailboxMessageIds);
  }

  private getLinkedAttachmentIds(table: string, ownerColumn: string, ownerIds: string[]): string[] {
    const ids = [...new Set(ownerIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT attachment_id FROM ${table}
        WHERE ${ownerColumn} IN (${ids.map(() => '?').join(',')})`
      )
      .all(...ids) as Array<{ attachment_id: string }>;
    return [...new Set(rows.map((row) => row.attachment_id))];
  }

  private deleteUnreferencedAttachments(attachmentIds: string[]): StoredAttachment[] {
    const ids = [...new Set(attachmentIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT a.* FROM attachments a
        WHERE a.id IN (${ids.map(() => '?').join(',')})
          AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM mailbox_attachments ba WHERE ba.attachment_id = a.id)`
      )
      .all(...ids) as any[];
    const attachments = rows.map(rowToStoredAttachment);
    if (attachments.length === 0) return [];
    this.db
      .prepare(`DELETE FROM attachments WHERE id IN (${attachments.map(() => '?').join(',')})`)
      .run(...attachments.map((attachment) => attachment.id));
    return attachments;
  }
}

export type AttachmentRepositoryPort = Pick<
  AttachmentRepository,
  | 'createAttachment'
  | 'getAttachment'
  | 'listAttachments'
  | 'linkMessageAttachments'
  | 'listMessageAttachments'
  | 'listMessageAttachmentsForMessages'
  | 'linkMailboxAttachments'
  | 'listMailboxAttachments'
  | 'listMailboxAttachmentsForMessages'
  | 'deleteAttachment'
  | 'deleteMessage'
  | 'deleteMessageAttachment'
  | 'deleteTeamAttachments'
>;
