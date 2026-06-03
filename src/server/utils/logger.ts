import pino from 'pino';
import { getRequestContext } from '@server/utils/requestContext';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type LogFormat = 'pretty' | 'json';
export type LogOptions = {
  reveal?: string[];
};

type SanitizedPayload = {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
  request_id?: string;
  user_id?: string;
} & LogFields;

const jsonLogger = pino({
  level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
  base: undefined,
});

/** 带请求上下文和常见密钥脱敏能力的轻量 logger 门面。 */
export class Logger {
  constructor(private readonly scope: string) {}

  debug(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('debug', message, fields, options);
  }

  info(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('info', message, fields, options);
  }

  warn(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('warn', message, fields, options);
  }

  error(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('error', message, fields, options);
  }

  private write(level: LogLevel, message: string, fields: LogFields, options: LogOptions): void {
    if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') return;

    const context = getRequestContext();
    const payload: SanitizedPayload = {
      time: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...(context?.requestId ? { request_id: context.requestId } : {}),
      ...(context?.userId ? { user_id: context.userId } : {}),
      ...sanitizeLogFields(fields, options.reveal),
    };

    if (getLogFormat() === 'json') {
      const { time, level: _payloadLevel, ...jsonPayload } = payload;
      jsonLogger[level]({ ...jsonPayload, timestamp: time });
      return;
    }

    const line = formatPrettyLog(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'debug') console.debug(line);
    else console.log(line);
  }
}

/** 为指定业务域创建 logger，scope 会出现在每一行日志中。 */
export function createLogger(scope: string): Logger {
  return new Logger(scope);
}

/** 根据环境变量选择日志输出格式，本地默认保持易读的 pretty 格式。 */
export function getLogFormat(): LogFormat {
  if (process.env.LOG_FORMAT === 'json') return 'json';
  return 'pretty';
}

/** 把结构化日志载荷转换成本地开发时易扫读的一行文本。 */
export function formatPrettyLog(payload: SanitizedPayload): string {
  const time = formatTimestamp(payload.time);
  const level = payload.level.toUpperCase();
  const context = formatContext(payload);
  const fields = Object.entries(payload)
    .filter(([key]) => !['time', 'level', 'scope', 'message', 'request_id', 'user_id'].includes(key))
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
  const message = fields ? `${payload.message} ${fields}` : payload.message;

  return `${time} - ${payload.scope} - ${level} - ${context} - ${message}`;
}

/** 对日志字段做密钥脱敏，避免令牌、密码和图片数据泄露到终端。 */
export function sanitizeLogFields(fields: LogFields, reveal: string[] = []): LogFields {
  try {
    const revealKeys = new Set(reveal.map(normalizeKey));
    const text = JSON.stringify(fields, (key, value) => sanitizeValue(key, value, revealKeys));
    return JSON.parse(text) as LogFields;
  } catch {
    return { message: 'failed to serialize log fields' };
  }
}

/** 将任意日志值转换成单行安全文本，保留完整内容用于排查问题。 */
export function formatValue(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function formatTimestamp(isoTime: string): string {
  const date = new Date(isoTime);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())},${pad(date.getMilliseconds(), 3)}`,
  ].join(' ');
}

function formatContext(payload: Pick<SanitizedPayload, 'request_id' | 'user_id'>): string {
  const entries = [
    payload.request_id ? `request_id=${payload.request_id}` : '',
    payload.user_id ? `user_id=${payload.user_id}` : '',
  ].filter(Boolean);
  return `[${entries.join(',')}]`;
}

function sanitizeValue(key: string, value: unknown, revealKeys: Set<string>): unknown {
  if (revealKeys.has(normalizeKey(key))) return value;
  if (isSensitiveKey(key)) return '***';
  if (typeof value !== 'string') return value;

  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-***')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'set-cookie' ||
    normalized.includes('token') ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized === 'apikey' ||
    normalized === 'api_key' ||
    normalized === 'database64'
  );
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}
