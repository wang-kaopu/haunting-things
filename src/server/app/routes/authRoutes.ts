import { Router } from 'express';
import type { AuthService } from '../../services/authService';
import type { Logger } from '../../utils/logger';
import { setRequestContext } from '../../utils/requestContext';

/** 创建认证相关 HTTP 路由，并把登录/改密等安全事件写入审计日志。 */
export function createAuthRoutes(auth: AuthService, logger: Logger): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      logger.warn('auth_login_invalid_request', {
        username: typeof username === 'string' ? username : undefined,
      });
      res.status(400).json({ success: false, error: 'username and password are required' });
      return;
    }
    const result = await auth.login(username, password);
    if (!result) {
      logger.warn('auth_login_failed', {
        username,
      });
      res.status(401).json({ success: false, error: 'Invalid username or password' });
      return;
    }
    setRequestContext({ userId: result.user.id });
    auth.setCookie(res, result.token);
    logger.info('auth_login_success', {
      username: result.user.username,
      userId: result.user.id,
    });
    res.json({ success: true, user: result.user });
  });

  router.post('/logout', auth.authenticateRequest, (req, res) => {
    const user = (req as any).user as { id?: string; username?: string } | undefined;
    logger.info('auth_logout', {
      userId: user?.id,
      username: user?.username,
    });
    auth.clearCookie(res);
    res.json({ success: true });
  });

  router.get('/api/auth/user', auth.authenticateRequest, (req, res) => {
    res.json({ success: true, user: (req as any).user });
  });

  router.post('/api/auth/change-password', auth.authenticateRequest, async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      const user = (req as any).user as { id?: string; username?: string } | undefined;
      logger.warn('auth_change_password_invalid_request', {
        userId: user?.id,
        username: user?.username,
      });
      res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
      return;
    }
    const ok = await auth.changePassword(currentPassword, newPassword);
    if (!ok) {
      const user = (req as any).user as { id?: string; username?: string } | undefined;
      logger.warn('auth_change_password_failed', {
        userId: user?.id,
        username: user?.username,
      });
      res.status(400).json({ success: false, error: 'Password update failed' });
      return;
    }
    const user = (req as any).user as { id?: string; username?: string } | undefined;
    logger.info('auth_change_password_success', {
      userId: user?.id,
      username: user?.username,
    });
    auth.clearCookie(res);
    res.json({ success: true });
  });

  return router;
}
