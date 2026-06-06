import type { MailboxMessage } from '@shared/types';

/** 团队邮箱服务依赖的持久化接口。 */
export interface MailboxRepositoryPort {
  writeMailbox(message: MailboxMessage): MailboxMessage;
  readUnreadAndMark(teamId: string, toAgentId: string): MailboxMessage[];
  listUnreadMailbox(teamId: string, toAgentId: string): MailboxMessage[];
  listMailbox(teamId: string): MailboxMessage[];
}
