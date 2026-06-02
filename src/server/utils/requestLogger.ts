import type { NextFunction, Request, Response } from 'express';
import { createLogger } from './logger';

const httpLogger = createLogger('http');

/** 记录每个 HTTP 请求的最终状态和耗时，便于和桥接/RPC 日志对齐排查。 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  res.on('finish', () => {
    const statusText = `${res.statusCode} ${statusMessage(res.statusCode)}`.trim();
    httpLogger.info(`${req.method} "${req.originalUrl || req.url}" ${statusText} - ${Date.now() - startedAt}ms`);
  });
  next();
}

function statusMessage(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return 'OK';
  if (statusCode === 304) return 'Not Modified';
  if (statusCode === 400) return 'Bad Request';
  if (statusCode === 401) return 'Unauthorized';
  if (statusCode === 403) return 'Forbidden';
  if (statusCode === 404) return 'Not Found';
  if (statusCode >= 500) return 'Internal Server Error';
  return '';
}
