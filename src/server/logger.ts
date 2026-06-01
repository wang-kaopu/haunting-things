type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;
type LogFormat = 'pretty' | 'json';

/** 带常见密钥脱敏能力的轻量结构化 logger。 */
class Logger {
  constructor(private readonly scope: string) {}

  /** 仅在 `LOG_LEVEL=debug` 时写入 debug 日志。 */
  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }

  /** 写入 info 级别日志。 */
  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  /** 写入 warn 级别日志。 */
  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  /** 写入 error 级别日志。 */
  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

  /** 构建、脱敏、格式化并输出一条日志到控制台。 */
  private write(level: LogLevel, event: string, fields: LogFields): void {
    if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') {
      return;
    }

    const payload = {
      time: new Date().toISOString(),
      level,
      scope: this.scope,
      event,
      ...sanitizeLogFields(fields),
    };

    const line = getLogFormat() === 'json' ? JSON.stringify(payload) : formatPrettyLog(payload);

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else if (level === 'debug') {
      console.debug(line);
    } else {
      console.log(line);
    }
  }
}

/** 解析配置的输出格式，默认使用便于开发阅读的 pretty 日志。 */
function getLogFormat(): LogFormat {
  if (process.env.LOG_FORMAT === 'json') return 'json';
  if (process.env.LOG_FORMAT === 'pretty') return 'pretty';
  return 'pretty';
}

/** 将一条结构化日志格式化为紧凑的单行消息。 */
function formatPrettyLog(payload: Record<string, unknown>): string {
  const time = String(payload.time ?? '').slice(11, 19);
  const level = String(payload.level ?? 'info').toUpperCase().padEnd(5);
  const scope = String(payload.scope ?? 'app');
  const event = String(payload.event ?? 'event');

  const fields = Object.entries(payload)
    .filter(([key]) => !['time', 'level', 'scope', 'event'].includes(key))
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');

  return fields ? `[${time}] ${level} ${scope} ${event} ${fields}` : `[${time}] ${level} ${scope} ${event}`;
}

/** 为 pretty 输出渲染字段值，并限制过长日志行。 */
function formatValue(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === 'string') {
    if (value.length > 160) return JSON.stringify(`${value.slice(0, 157)}...`);
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  } catch {
    return '[unserializable]';
  }
}

/** 对字段做 JSON 往返处理，确保嵌套值可脱敏且可序列化。 */
function sanitizeLogFields(fields: LogFields): LogFields {
  try {
    const text = JSON.stringify(fields, (_key, value) => sanitizeValue(value));

    return JSON.parse(text);
  } catch {
    return {
      message: 'failed to serialize log fields',
    };
  }
}

/** 写日志前脱敏 bearer token 和常见 API key 形态。 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-***')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***');
}

/** 创建供 server 子系统使用的带作用域 logger。 */
export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
