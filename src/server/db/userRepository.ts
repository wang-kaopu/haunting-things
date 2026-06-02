import type { User } from '../../shared/types';
import type { Db } from './connection';

export class UserRepository {
  constructor(private readonly db: Db) {}

  getUserByUsername(username: string): (User & { passwordHash: string; jwtSecret: string }) | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, jwt_secret FROM users WHERE username = ?')
      .get(username) as { id: string; username: string; password_hash: string; jwt_secret: string } | undefined;
    return row
      ? { id: row.id, username: row.username, passwordHash: row.password_hash, jwtSecret: row.jwt_secret }
      : null;
  }

  /** 获取首个用户，用于单管理员初始化和密码流程。 */
  getAnyUser(): (User & { passwordHash: string; jwtSecret: string }) | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, jwt_secret FROM users ORDER BY created_at ASC LIMIT 1')
      .get() as { id: string; username: string; password_hash: string; jwt_secret: string } | undefined;
    return row
      ? { id: row.id, username: row.username, passwordHash: row.password_hash, jwtSecret: row.jwt_secret }
      : null;
  }

  /** 持久化新用户，并返回公开字段。 */
  createUser(input: { id: string; username: string; passwordHash: string; jwtSecret: string }): User {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, jwt_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(input.id, input.username, input.passwordHash, input.jwtSecret, now, now);
    return { id: input.id, username: input.username };
  }

  /** 认证成功后更新最近登录元数据。 */
  updateLastLogin(userId: string): void {
    this.db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), userId);
  }

  /** 替换用户密码哈希和 JWT secret，使旧 token 失效。 */
  updatePassword(userId: string, passwordHash: string, jwtSecret: string): void {
    this.db
      .prepare('UPDATE users SET password_hash = ?, jwt_secret = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, jwtSecret, Date.now(), userId);
  }

  /** 清除所有本地用户，用于 CLI reset 后重新走首次初始化流程。 */
  deleteAllUsers(): number {
    return this.db.prepare('DELETE FROM users').run().changes;
  }
}

export type UserRepositoryPort = Pick<
  UserRepository,
  'getUserByUsername' | 'getAnyUser' | 'createUser' | 'updateLastLogin' | 'updatePassword' | 'deleteAllUsers'
>;
