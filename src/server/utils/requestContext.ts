import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export type RequestContext = {
  requestId: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function setRequestContext(fields: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, fields);
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = readHeader(req, 'x-request-id') || createRequestId();
  res.setHeader('X-Request-ID', requestId);
  storage.run({ requestId }, next);
}

export function createRequestId(): string {
  return randomBytes(8).readBigUInt64BE().toString();
}

function readHeader(req: Request, name: string): string {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
}
