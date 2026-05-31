type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

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

    const line = JSON.stringify(payload);

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

function sanitizeLogFields(fields: LogFields): LogFields {
  try {
    const text = JSON.stringify(fields, (_key, value) => {
      if (typeof value !== 'string') return value;

      return value
        .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
        .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-***')
        .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***');
    });

    return JSON.parse(text);
  } catch {
    return {
      message: 'failed to serialize log fields',
    };
  }
}

export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
