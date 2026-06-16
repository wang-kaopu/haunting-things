import bcrypt from 'bcrypt';
import { parse as parseCookie } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { User } from '@shared/types';
import type { UserRepositoryPort } from '@server/port/userRepositoryPort';
import { createId } from '@server/id';
import { setRequestContext } from '@server/utils/requestContext';

const COOKIE_NAME = 'hs_session';
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ADMIN_PASSWORD = '123456';

/** 认证服务启动后暴露给 UI 的初始账号状态。 */
export type AuthState = {
  initialPassword: string | null;
};

/** JWT 中保存的最小用户身份信息。 */
type TokenPayload = {
  userId: string;
  username: string;
};

/** 管理本地用户认证、会话 token 和 Express 鉴权中间件。 */
export class AuthService {
  readonly state: AuthState = { initialPassword: null };

  constructor(private readonly repo: UserRepositoryPort) { }

  /** 确保首次启动时存在默认管理员，便于无配置状态下进入系统。 */
  async ensureAdmin(): Promise<void> {
    if (this.repo.getAnyUser()) return;

    const password = DEFAULT_ADMIN_PASSWORD;
    const passwordHash = await bcrypt.hash(password, 12);
    this.repo.createUser({
      id: createId(),
      username: 'admin',
      passwordHash,
      jwtSecret: randomBytes(48).toString('hex'),
    });
    this.state.initialPassword = password;
  }

  /** 校验账号密码；用户名不存在时创建本地账号并签发会话 token。 */
  async login(username: string, password: string): Promise<{ user: User; token: string } | null> {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) return null;

    const user = this.repo.getUserByUsername(normalizedUsername);
    if (!user) {
      const passwordHash = await bcrypt.hash(password, 12);
      const jwtSecret = randomBytes(48).toString('hex');
      const created = this.repo.createUser({
        id: createId(),
        username: normalizedUsername,
        passwordHash,
        jwtSecret,
      });
      return this.issueSession({ ...created, jwtSecret });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;

    return this.issueSession(user);
  }

  /** 更新登录元数据并为指定用户签发浏览器会话。 */
  private issueSession(user: User & { jwtSecret: string }): { user: User; token: string } {
    this.repo.updateLastLogin(user.id);
    const token = jwt.sign({ userId: user.id, username: user.username } satisfies TokenPayload, user.jwtSecret, {
      expiresIn: '7d',
      issuer: 'Haunting-things',
      audience: 'Haunting-things-web',
    });
    return { user: { id: user.id, username: user.username }, token };
  }

  /** 校验当前用户密码并轮换 JWT secret，让旧会话在改密后立即失效。 */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = this.repo.getUserById(userId);
    if (!user) return false;
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok || newPassword.length < 8) return false;
    const passwordHash = await bcrypt.hash(newPassword, 12);
    this.repo.updatePassword(user.id, passwordHash, randomBytes(48).toString('hex'));
    this.state.initialPassword = null;
    return true;
  }

  /** 清除本地管理员密码状态；下次启动会重新创建初始 admin。 */
  clearAdminPassword(): number {
    this.state.initialPassword = null;
    return this.repo.deleteAllUsers();
  }

  /** 使用用户当前 JWT secret 解码并校验会话 token。 */
  verifyToken(token: string | null | undefined): User | null {
    if (!token) return null;
    const decoded = jwt.decode(token) as TokenPayload | null;
    if (!decoded?.username) return null;
    const user = this.repo.getUserByUsername(decoded.username);
    if (!user) return null;
    try {
      jwt.verify(token, user.jwtSecret, { issuer: 'Haunting-things', audience: 'Haunting-things-web' });
      return { id: user.id, username: user.username };
    } catch {
      return null;
    }
  }

  /** 从浏览器 cookie 头中提取本地会话 token。 */
  extractTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    return parseCookie(cookieHeader)[COOKIE_NAME] ?? null;
  }

  /** Express 鉴权中间件，成功后把用户写入请求对象和请求上下文。 */
  authenticateRequest = (req: Request, res: Response, next: NextFunction): void => {
    const token = this.extractTokenFromCookieHeader(req.headers.cookie);
    const user = this.verifyToken(token);
    if (!user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    (req as Request & { user: User }).user = user;
    setRequestContext({ userId: user.id });
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
