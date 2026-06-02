import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export type RequestContext = {
  requestId: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** 读取当前异步调用链上的请求上下文，用于日志和服务层串联同一次请求。 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** 在指定上下文中执行逻辑，保证跨 await 的日志仍能带上同一个请求标识。 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** 给当前请求补充业务字段，通常在认证完成后写入用户标识。 */
export function setRequestContext(fields: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, fields);
}

/** 为 Express 请求建立请求上下文，并把请求标识回写给前端便于排查。 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = readHeader(req, 'x-request-id') || createRequestId();
  res.setHeader('X-Request-ID', requestId);
  storage.run({ requestId }, next);
}

/** 生成短请求标识，避免日志中使用过长 UUID 影响可读性。 */
export function createRequestId(): string {
  return randomBytes(8).readBigUInt64BE().toString();
}

function readHeader(req: Request, name: string): string {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
}
