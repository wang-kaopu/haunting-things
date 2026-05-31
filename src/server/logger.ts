type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;
type LogFormat = 'pretty' | 'json';

class Logger {
  constructor(private readonly scope: string) {}

  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

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

function getLogFormat(): LogFormat {
  if (process.env.LOG_FORMAT === 'json') return 'json';
  if (process.env.LOG_FORMAT === 'pretty') return 'pretty';
  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
}

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

function sanitizeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-***')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***');
}

export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
