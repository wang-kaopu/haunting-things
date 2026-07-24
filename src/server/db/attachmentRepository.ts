import type { AttachmentRef, StoredAttachment } from '@shared/types';
import type { Db } from '@server/db/connection';
import type { DatabaseRow } from '@server/db/mappers';
import { rowToStoredAttachment, toAttachmentRef } from '@server/db/mappers';

/**
 * 管理附件元数据和消息关联关系。
 *
 * 附件可能同时被普通 conversation 消息和 Team mailbox 消息引用，删除时必须先判断是否仍有其它引用。
 */
export class AttachmentRepository {
  constructor(private readonly db: Db) {}

  /**
   * 持久化已落盘附件的元数据。
   */
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

  /**
   * 查询单个附件的服务端完整记录。
   */
  getAttachment(id: string): StoredAttachment | null {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as DatabaseRow | undefined;
    return row ? rowToStoredAttachment(row) : null;
  }

  /**
   * 按调用方传入的附件 ID 顺序返回附件。
   *
   * 发送 prompt 时依赖这个顺序保持用户选择图片的上下文顺序。
   */
  listAttachments(ids: string[]): StoredAttachment[] {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const rows = this.db
      .prepare(`SELECT * FROM attachments WHERE id IN (${uniqueIds.map(() => '?').join(',')})`)
      .all(...uniqueIds) as Array<DatabaseRow & { id: string }>;
    const byId = new Map(rows.map((row) => [row.id, rowToStoredAttachment(row)]));
    return uniqueIds.map((id) => byId.get(id)).filter((item): item is StoredAttachment => Boolean(item));
  }

  /**
   * 将普通 conversation 消息和附件建立关系。
   */
  linkMessageAttachments(messageId: string, attachmentIds: string[]): void {
    this.linkAttachments('message_attachments', 'message_id', messageId, attachmentIds);
  }

  /**
   * 查询单条普通消息的附件引用。
   */
  listMessageAttachments(messageId: string): AttachmentRef[] {
    return this.listMessageAttachmentsForMessages([messageId])[messageId] ?? [];
  }

  /**
   * 批量查询普通消息附件，避免历史消息加载时出现 N+1 查询。
   */
  listMessageAttachmentsForMessages(messageIds: string[]): Record<string, AttachmentRef[]> {
    return this.listLinkedAttachments('message_attachments', 'message_id', messageIds);
  }

  /**
   * 将 Team mailbox 消息和附件建立关系。
   */
  linkMailboxAttachments(mailboxMessageId: string, attachmentIds: string[]): void {
    this.linkAttachments('mailbox_attachments', 'mailbox_message_id', mailboxMessageId, attachmentIds);
  }

  /**
   * 查询单条 Team mailbox 消息的附件引用。
   */
  listMailboxAttachments(mailboxMessageId: string): AttachmentRef[] {
    return this.listMailboxAttachmentsForMessages([mailboxMessageId])[mailboxMessageId] ?? [];
  }

  /**
   * 批量查询 Team mailbox 附件，避免唤醒 Agent 时重复查询。
   */
  listMailboxAttachmentsForMessages(mailboxMessageIds: string[]): Record<string, AttachmentRef[]> {
    return this.listLinkedAttachments('mailbox_attachments', 'mailbox_message_id', mailboxMessageIds);
  }

  /**
   * 删除一个尚未发送或已被明确移除的附件。
   *
   * 返回值交给文件服务删除磁盘缓存，保持数据库事务和文件系统操作分离。
   */
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

  /**
   * 删除普通消息，并清理不再被其它消息引用的附件元数据。
   */
  deleteMessage(messageId: string): StoredAttachment[] {
    const attachmentIds = this.getMessageAttachmentIds([messageId]);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM message_attachments WHERE message_id = ?').run(messageId);
      this.db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
      return this.deleteUnreferencedAttachments(attachmentIds);
    });
    return tx();
  }

  /**
   * 从普通消息中移除单个附件，并清理由此变成孤立状态的附件。
   */
  deleteMessageAttachment(messageId: string, attachmentId: string): StoredAttachment[] {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM message_attachments WHERE message_id = ? AND attachment_id = ?')
        .run(messageId, attachmentId);
      return this.deleteUnreferencedAttachments([attachmentId]);
    });
    return tx();
  }

  /**
   * 删除 Team 时清理 mailbox 和成员 conversation 关联的附件。
   *
   * Team 删除本身会通过外键清理 mailbox，这里提前断开附件关系以找出可安全删除的缓存文件。
   */
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

  /**
   * 写入附件关系表，并保留用户选择顺序。
   */
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

  /**
   * 从关系表批量组装前端可见的附件引用。
   */
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
      .all(...uniqueOwnerIds) as Array<DatabaseRow & { owner_id: string }>;

    const result: Record<string, AttachmentRef[]> = {};
    for (const row of rows) {
      const ownerId = row.owner_id;
      result[ownerId] = result[ownerId] ?? [];
      result[ownerId].push(toAttachmentRef(rowToStoredAttachment(row)));
    }
    return result;
  }

  /**
   * 查询 Team mailbox 中的消息 ID，用于删除 Team 前定位附件关系。
   */
  private getMailboxIdsForTeam(teamId: string): string[] {
    const rows = this.db.prepare('SELECT id FROM mailbox WHERE team_id = ?').all(teamId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * 查询一组 conversation 下的消息 ID，用于删除 Team 成员历史附件。
   */
  private getMessageIdsForConversations(conversationIds: string[]): string[] {
    const ids = [...new Set(conversationIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT id FROM messages WHERE conversation_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * 查询普通消息关联过的附件 ID。
   */
  private getMessageAttachmentIds(messageIds: string[]): string[] {
    return this.getLinkedAttachmentIds('message_attachments', 'message_id', messageIds);
  }

  /**
   * 查询 Team mailbox 消息关联过的附件 ID。
   */
  private getMailboxAttachmentIds(mailboxMessageIds: string[]): string[] {
    return this.getLinkedAttachmentIds('mailbox_attachments', 'mailbox_message_id', mailboxMessageIds);
  }

  /**
   * 从指定关系表读取附件 ID，并去重。
   */
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

  /**
   * 删除已经没有任何消息引用的附件元数据。
   *
   * 普通消息和 mailbox 都可能引用同一附件，必须同时检查两张关系表。
   */
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
      .all(...ids) as DatabaseRow[];
    const attachments = rows.map(rowToStoredAttachment);
    if (attachments.length === 0) return [];
    this.db
      .prepare(`DELETE FROM attachments WHERE id IN (${attachments.map(() => '?').join(',')})`)
      .run(...attachments.map((attachment) => attachment.id));
    return attachments;
  }
}
