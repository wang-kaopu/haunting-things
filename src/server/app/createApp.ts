import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { AuthService } from '../services/authService';
import type { Logger } from '../logger';
import { createAuthRoutes } from './routes/authRoutes';

export function createApp(input: {
  auth: AuthService;
  logger: Logger;
  rendererDist: string;
}): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(createAuthRoutes(input.auth, input.logger));
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
