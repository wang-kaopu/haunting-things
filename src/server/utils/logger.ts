import pino from 'pino';
import { getRequestContext } from '@server/utils/requestContext';

/** 日志输出支持的级别。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志附加字段，写入前会经过敏感字段脱敏。 */
export type LogFields = Record<string, unknown>;

/** 日志输出格式：便于本地阅读的文本或机器可解析 JSON。 */
export type LogFormat = 'pretty' | 'json';

/** 单次日志写入的脱敏例外配置。 */
export type LogOptions = {
  reveal?: string[];
};

/** 脱敏后准备输出的结构化日志载荷。 */
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

  /**
   * 写入调试日志；只有 LOG_LEVEL=debug 时才会输出。
   */
  debug(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('debug', message, fields, options);
  }

  /**
   * 写入普通运行日志。
   */
  info(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('info', message, fields, options);
  }

  /**
   * 写入需要关注但不一定中断流程的警告日志。
   */
  warn(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('warn', message, fields, options);
  }

  /**
   * 写入错误日志，并保持同样的请求上下文和脱敏规则。
   */
  error(message: string, fields: LogFields = {}, options: LogOptions = {}): void {
    this.write('error', message, fields, options);
  }

  /** 应用请求上下文、字段脱敏和输出格式后写入日志。 */
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

/** 将 ISO 时间格式化为 pretty 日志行使用的本地时间文本。 */
function formatTimestamp(isoTime: string): string {
  const date = new Date(isoTime);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())},${pad(date.getMilliseconds(), 3)}`,
  ].join(' ');
}

/** 将请求上下文字段压缩成 pretty 日志中的方括号片段。 */
function formatContext(payload: Pick<SanitizedPayload, 'request_id' | 'user_id'>): string {
  const entries = [
    payload.request_id ? `request_id=${payload.request_id}` : '',
    payload.user_id ? `user_id=${payload.user_id}` : '',
  ].filter(Boolean);
  return `[${entries.join(',')}]`;
}

/** 对单个日志字段值执行密钥和凭据脱敏。 */
function sanitizeValue(key: string, value: unknown, revealKeys: Set<string>): unknown {
  if (revealKeys.has(normalizeKey(key))) return value;
  if (isSensitiveKey(key)) return '***';
  if (typeof value !== 'string') return value;

  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-***')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***');
}

/** 判断字段名是否属于默认需要隐藏的敏感信息。 */
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

/** 归一化字段名，便于大小写和分隔符不敏感地匹配敏感字段。 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}
