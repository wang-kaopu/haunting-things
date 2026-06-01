import type { Repository } from './db';

export type UserRepository = Pick<
  Repository,
  'getUserByUsername' | 'getAnyUser' | 'createUser' | 'updateLastLogin' | 'updatePassword'
>;
