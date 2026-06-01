import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { parse as parseCookie } from 'cookie';
import type { Repository } from './db';
import type { User } from '../shared/types';

const COOKIE_NAME = 'hs_session';
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthState = {
  initialPassword: string | null;
};

type TokenPayload = {
  userId: string;
  username: string;
};

export class AuthService {
  readonly state: AuthState = { initialPassword: null };

  constructor(private readonly repo: Repository) {}

  async ensureAdmin(): Promise<void> {
    if (this.repo.getAnyUser()) return;

    const password = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 12);
    this.repo.createUser({
      id: crypto.randomUUID(),
      username: 'admin',
      passwordHash,
      jwtSecret: crypto.randomBytes(48).toString('hex'),
    });
    this.state.initialPassword = password;
  }

  /** 校验账号密码，并签发会话 token。 */
  async login(username: string, password: string): Promise<{ user: User; token: string } | null> {
    const user = this.repo.getUserByUsername(username);
    if (!user) {
      await bcrypt.compare(password, '$2a$12$s5cKddFA1hp06nhAubmZa.eT3/xT9Bmve36cul7fZ6ch2mz9EITDu');
      return null;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;

    this.repo.updateLastLogin(user.id);
    const token = jwt.sign({ userId: user.id, username: user.username } satisfies TokenPayload, user.jwtSecret, {
      expiresIn: '7d',
      issuer: 'haunting-souls',
      audience: 'haunting-souls-web',
    });
    return { user: { id: user.id, username: user.username }, token };
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const user = this.repo.getAnyUser();
    if (!user) return false;
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok || newPassword.length < 8) return false;
    const passwordHash = await bcrypt.hash(newPassword, 12);
    this.repo.updatePassword(user.id, passwordHash, crypto.randomBytes(48).toString('hex'));
    this.state.initialPassword = null;
    return true;
  }

  /** 为命令行重置流程生成新的管理员密码。 */
  async resetAdminPassword(): Promise<string> {
    const user = this.repo.getAnyUser();
    if (!user) throw new Error('No admin user exists');
    const password = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 12);
    this.repo.updatePassword(user.id, passwordHash, crypto.randomBytes(48).toString('hex'));
    this.state.initialPassword = password;
    return password;
  }

  /** 使用用户当前 JWT secret 解码并校验会话 token。 */
  verifyToken(token: string | null | undefined): User | null {
    if (!token) return null;
    const decoded = jwt.decode(token) as TokenPayload | null;
    if (!decoded?.username) return null;
    const user = this.repo.getUserByUsername(decoded.username);
    if (!user) return null;
    try {
      jwt.verify(token, user.jwtSecret, { issuer: 'haunting-souls', audience: 'haunting-souls-web' });
      return { id: user.id, username: user.username };
    } catch {
      return null;
    }
  }

  extractTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    return parseCookie(cookieHeader)[COOKIE_NAME] ?? null;
  }

  authenticateRequest = (req: Request, res: Response, next: NextFunction): void => {
    const token = this.extractTokenFromCookieHeader(req.headers.cookie);
    const user = this.verifyToken(token);
    if (!user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    (req as Request & { user: User }).user = user;
    next();
  };

  /** 将认证会话 cookie 写入响应。 */
  setCookie(res: Response, token: string): void {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: TOKEN_MAX_AGE_MS,
      path: '/',
    });
  }

  /** 清除认证会话 cookie。 */
  clearCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
