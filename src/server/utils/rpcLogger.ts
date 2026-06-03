import { createLogger, formatValue, sanitizeLogFields } from '@server/utils/logger';

const rpcLogger = createLogger('rpc');

export type LoggedFetchInit = RequestInit & {
  json?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1] & LoggedFetchInit;
type FetchFn = typeof fetch;

let originalFetch: FetchFn | null = null;

/** 安装全局 fetch 包装器，让 ACP/RPC 出站请求统一写入脱敏日志。 */
export function installRpcLogger(): void {
  if (originalFetch) return;
  originalFetch = globalThis.fetch.bind(globalThis) as FetchFn;
  globalThis.fetch = ((input: FetchInput, init?: FetchInit) =>
    executeLoggedFetch(originalFetch as FetchFn, input, init ?? {})) as FetchFn;
}

/** 直接发起一次带日志的 fetch，用于不希望替换全局 fetch 的调用点。 */
export async function loggedFetch(input: FetchInput, init: FetchInit = {}): Promise<Response> {
  return executeLoggedFetch(originalFetch ?? (globalThis.fetch.bind(globalThis) as FetchFn), input, init);
}

async function executeLoggedFetch(fetchImpl: FetchFn, input: FetchInput, init: FetchInit): Promise<Response> {
  const url = withParams(input, init.params);
  const method = init.method ?? methodFromInput(input) ?? 'GET';
  const headers = normalizeHeaders(init.headers ?? headersFromInput(input));
  const body = init.json === undefined ? init.body : JSON.stringify(init.json);
  const startedAt = Date.now();

  rpcLogger.info(
    `RPC request: method=${method}, url=${url.toString()}, json=${formatPythonValue(init.json)}, params=${formatPythonValue(init.params)}, headers=${formatPythonValue(headers)}`
  );

  const response = await fetchImpl(url, {
    ...init,
    method,
    headers,
    body,
  });

  rpcLogger.info(`RPC response: method=${method}, url=${url.toString()}, status=${response.status} ${response.statusText} - ${Date.now() - startedAt}ms`);
  return response;
}

function withParams(input: FetchInput, params: LoggedFetchInit['params']): URL {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function methodFromInput(input: FetchInput): string | undefined {
  return input instanceof Request ? input.method : undefined;
}

function headersFromInput(input: FetchInput): HeadersInit | undefined {
  return input instanceof Request ? input.headers : undefined;
}

function formatPythonValue(value: unknown): string {
  if (value === undefined || value === null) return 'None';
  const sanitized = sanitizeLogFields({ value }).value;
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return `{${Object.entries(sanitized as Record<string, unknown>)
      .map(([key, item]) => `'${key}': ${formatPythonScalar(item)}`)
      .join(', ')}}`;
  }
  return formatValue(sanitized);
}

function formatPythonScalar(value: unknown): string {
  if (value == null) return 'None';
  if (typeof value === 'string') return `'${value}'`;
  return formatValue(value);
}
