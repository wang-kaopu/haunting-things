import type { User } from '@shared/types';

/** 认证服务依赖的用户持久化接口。 */
export interface UserRepositoryPort {
  getUserByUsername(username: string): (User & { passwordHash: string; jwtSecret: string }) | null;
  getUserById(userId: string): (User & { passwordHash: string; jwtSecret: string }) | null;
  getAnyUser(): (User & { passwordHash: string; jwtSecret: string }) | null;
  createUser(input: { id: string; username: string; passwordHash: string; jwtSecret: string }): User;
  updateLastLogin(userId: string): void;
  updatePassword(userId: string, passwordHash: string, jwtSecret: string): void;
  deleteAllUsers(): number;
}
