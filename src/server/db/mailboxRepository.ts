import type { Repository } from './db';

export type MailboxRepository = Pick<
  Repository,
  'writeMailbox' | 'readUnreadAndMark' | 'listUnreadMailbox' | 'listMailbox'
>;
