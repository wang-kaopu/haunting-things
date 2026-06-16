import bcrypt from 'bcrypt';
import { describe, expect, it } from 'vitest';
import type { User } from '@shared/types';
import type { UserRepositoryPort } from '@server/port/userRepositoryPort';
import { AuthService } from '@server/services/authService';

type StoredUser = User & { passwordHash: string; jwtSecret: string; lastLogin?: number };

/** 认证服务测试使用的内存用户仓储。 */
class InMemoryUserRepository implements UserRepositoryPort {
  private readonly users = new Map<string, StoredUser>();

  /** 按用户名返回认证私有字段。 */
  getUserByUsername(username: string): StoredUser | null {
    return this.users.get(username) ?? null;
  }

  /** 按用户 ID 返回认证私有字段。 */
  getUserById(userId: string): StoredUser | null {
    for (const user of this.users.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }

  /** 返回首个用户，用于兼容认证服务的初始化流程。 */
  getAnyUser(): StoredUser | null {
    return this.users.values().next().value ?? null;
  }

  /** 保存新用户并返回公开字段。 */
  createUser(input: { id: string; username: string; passwordHash: string; jwtSecret: string }): User {
    this.users.set(input.username, { ...input });
    return { id: input.id, username: input.username };
  }

  /** 记录最近登录时间。 */
  updateLastLogin(userId: string): void {
    for (const user of this.users.values()) {
      if (user.id === userId) {
        user.lastLogin = Date.now();
        return;
      }
    }
  }

  /** 替换用户密码哈希和 JWT secret。 */
  updatePassword(userId: string, passwordHash: string, jwtSecret: string): void {
    for (const user of this.users.values()) {
      if (user.id === userId) {
        user.passwordHash = passwordHash;
        user.jwtSecret = jwtSecret;
        return;
      }
    }
  }

  /** 删除所有用户并返回删除数量。 */
  deleteAllUsers(): number {
    const count = this.users.size;
    this.users.clear();
    return count;
  }

  /** 返回当前用户数量，便于断言不会重复注册。 */
  count(): number {
    return this.users.size;
  }
}

describe('AuthService', () => {
  it('registers and signs in when username does not exist', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);

    const result = await auth.login('new-user', 'secret-password');

    expect(result?.user.username).toBe('new-user');
    expect(result?.token).toEqual(expect.any(String));
    expect(repo.count()).toBe(1);
    expect(auth.verifyToken(result?.token)).toEqual(result?.user);
  });

  it('validates password when username already exists', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    const first = await auth.login('existing-user', 'correct-password');

    const second = await auth.login('existing-user', 'correct-password');

    expect(second?.user).toEqual(first?.user);
    expect(second?.token).toEqual(expect.any(String));
    expect(repo.count()).toBe(1);
  });

  it('rejects wrong password for existing username without creating another account', async () => {
    const repo = new InMemoryUserRepository();
    const passwordHash = await bcrypt.hash('correct-password', 12);
    repo.createUser({
      id: 'user-1',
      username: 'taken',
      passwordHash,
      jwtSecret: 'jwt-secret',
    });
    const auth = new AuthService(repo);

    await expect(auth.login('taken', 'wrong-password')).resolves.toBeNull();
    expect(repo.count()).toBe(1);
  });

  it('changes password only for the current user', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    const first = await auth.login('first-user', 'first-password');
    const second = await auth.login('second-user', 'second-password');

    const changed = await auth.changePassword(second?.user.id ?? '', 'second-password', 'second-password-next');

    expect(changed).toBe(true);
    await expect(auth.login('first-user', 'first-password')).resolves.toMatchObject({ user: first?.user });
    await expect(auth.login('second-user', 'second-password')).resolves.toBeNull();
    await expect(auth.login('second-user', 'second-password-next')).resolves.toMatchObject({ user: second?.user });
  });
});
