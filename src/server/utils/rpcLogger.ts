import { createLogger, formatValue, sanitizeLogFields } from '@server/utils/logger';

const rpcLogger = createLogger('rpc');

/** 支持 JSON body 和查询参数记录的 fetch 初始化参数。 */
export type LoggedFetchInit = RequestInit & {
  json?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
};

/** fetch 的请求输入类型别名。 */
type FetchInput = Parameters<typeof fetch>[0];
/** fetch 初始化参数，并包含日志扩展字段。 */
type FetchInit = Parameters<typeof fetch>[1] & LoggedFetchInit;
/** fetch 函数签名别名。 */
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

/** 执行一次 fetch，并记录脱敏后的请求和响应摘要。 */
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

/** 将额外查询参数合并到请求 URL。 */
function withParams(input: FetchInput, params: LoggedFetchInit['params']): URL {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

/** 将 HeadersInit 统一转换成普通对象，方便日志序列化。 */
function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

/** 从 Request 输入中读取 HTTP 方法。 */
function methodFromInput(input: FetchInput): string | undefined {
  return input instanceof Request ? input.method : undefined;
}

/** 从 Request 输入中读取请求头。 */
function headersFromInput(input: FetchInput): HeadersInit | undefined {
  return input instanceof Request ? input.headers : undefined;
}

/** 将日志值格式化为 Python 风格文本，便于复制到排查脚本。 */
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

/** 格式化 Python 风格对象中的标量字段。 */
function formatPythonScalar(value: unknown): string {
  if (value == null) return 'None';
  if (typeof value === 'string') return `'${value}'`;
  return formatValue(value);
}
