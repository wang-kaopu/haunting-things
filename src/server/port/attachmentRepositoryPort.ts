import type { AttachmentRef, StoredAttachment } from '@shared/types';

/** 附件服务依赖的持久化接口。 */
export interface AttachmentRepositoryPort {
  createAttachment(input: StoredAttachment): StoredAttachment;
  getAttachment(id: string): StoredAttachment | null;
  listAttachments(ids: string[]): StoredAttachment[];
  linkMessageAttachments(messageId: string, attachmentIds: string[]): void;
  listMessageAttachments(messageId: string): AttachmentRef[];
  listMessageAttachmentsForMessages(messageIds: string[]): Record<string, AttachmentRef[]>;
  linkMailboxAttachments(mailboxMessageId: string, attachmentIds: string[]): void;
  listMailboxAttachments(mailboxMessageId: string): AttachmentRef[];
  listMailboxAttachmentsForMessages(mailboxMessageIds: string[]): Record<string, AttachmentRef[]>;
  deleteAttachment(attachmentId: string): StoredAttachment[];
  deleteMessage(messageId: string): StoredAttachment[];
  deleteMessageAttachment(messageId: string, attachmentId: string): StoredAttachment[];
  deleteTeamAttachments(teamId: string, conversationIds: string[]): StoredAttachment[];
}
