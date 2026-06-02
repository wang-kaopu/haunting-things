import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { AuthService } from '../services/authService';
import type { Logger } from '../utils/logger';
import { requestContextMiddleware } from '../utils/requestContext';
import { requestLogger } from '../utils/requestLogger';
import type { AttachmentRepositoryPort } from '../db/attachmentRepository';
import { createAuthRoutes } from './routes/authRoutes';

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
