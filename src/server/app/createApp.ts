import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { AuthService } from '@server/services/authService';
import type { Logger } from '@server/utils/logger';
import { requestContextMiddleware } from '@server/utils/requestContext';
import { requestLogger } from '@server/utils/requestLogger';
import type { AttachmentRepositoryPort } from '@server/port/attachmentRepositoryPort';
import { createAuthRoutes } from '@server/app/routes/authRoutes';

/**
 * 创建 Express 应用并挂载认证、附件读取和前端静态资源路由。
 */
export function createApp(input: {
  auth: AuthService;
  logger: Logger;
  rendererDist: string;
  attachments?: AttachmentRepositoryPort;
}): express.Express {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(createAuthRoutes(input.auth, input.logger));
  if (input.attachments) {
    // 路由中的 name 只用于浏览器 URL，可访问的真实路径只来自数据库中的附件记录。
    app.get('/api/attachments/:id/:name', input.auth.authenticateRequest, (req, res) => {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const attachment = input.attachments?.getAttachment(id);
      if (!attachment) {
        res.status(404).end();
        return;
      }
      if (!existsSync(attachment.path)) {
        input.logger.warn('attachment_file_missing', {
          attachmentId: attachment.id,
          path: attachment.path,
        });
        res.status(404).end();
        return;
      }
      res.type(attachment.mimeType);
      // 历史剪贴板缓存可能以 `.jpg` 这类点文件名存在，读取附件时需要显式允许。
      res.sendFile(attachment.path, { dotfiles: 'allow' }, (error) => {
        if (!error) return;
        input.logger.warn('attachment_send_failed', {
          attachmentId: attachment.id,
          path: attachment.path,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) res.status(404).end();
      });
    });
  }
  serveRenderer(app, input.rendererDist);
  return app;
}

/** 提供已构建的 renderer 资源；前端未构建时返回明确的 503。 */
function serveRenderer(expressApp: express.Express, rendererDist: string): void {
  const indexHtml = path.join(rendererDist, 'index.html');
  if (existsSync(indexHtml)) {
    expressApp.use(express.static(rendererDist));
    expressApp.use((_req, res) => res.sendFile(indexHtml));
    return;
  }
  expressApp.use((_req, res) => {
    res
      .status(503)
      .send('Renderer is not built. Run `npm run build:renderer` or `npm run build` before starting the server.');
  });
}
