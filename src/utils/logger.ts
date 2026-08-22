import { config } from '../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /token/i,
  /auth/i,
  /client[_-]?secret/i,
];

/**
 * Recursively masks sensitive fields in logged objects/strings.
 */
export function sanitizeLogData(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Basic regex masking for obvious key patterns if any
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
      const isSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive && typeof val === 'string' && val.length > 0) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof val === 'object' && val !== null) {
        sanitized[key] = sanitizeLogData(val);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  return data;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  action?: string;
  message: string;
  context?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private module: string;
  private minLevelPriority: number;

  constructor(moduleName: string = 'System') {
    this.module = moduleName;
    const currentLevel = (config.LOG_LEVEL || 'info') as LogLevel;
    this.minLevelPriority = LOG_LEVEL_PRIORITY[currentLevel] ?? LOG_LEVEL_PRIORITY.info;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= this.minLevelPriority;
  }

  private formatEntry(
    level: LogLevel,
    message: string,
    action?: string,
    context?: unknown,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
    };

    if (action) entry.action = action;
    if (context !== undefined) entry.context = sanitizeLogData(context);
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: config.NODE_ENV !== 'production' ? error.stack : undefined,
      };
    }

    return entry;
  }

  private output(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    if (config.NODE_ENV === 'production') {
      // In production, emit raw structured JSON lines
      console.log(JSON.stringify(entry));
      return;
    }

    // In development / test, emit clean readable color-coded formatted output
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}${entry.action ? `::${entry.action}` : ''}]:`;
    const details = entry.context ? ` | Context: ${JSON.stringify(entry.context)}` : '';
    const errDetails = entry.error ? ` | Error: ${entry.error.name}: ${entry.error.message}` : '';

    switch (entry.level) {
      case 'error':
        console.error(`${prefix} ${entry.message}${details}${errDetails}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${entry.message}${details}`);
        break;
      case 'debug':
        console.debug(`${prefix} ${entry.message}${details}`);
        break;
      case 'info':
      default:
        console.log(`${prefix} ${entry.message}${details}`);
        break;
    }
  }

  public debug(message: string, context?: unknown, action?: string): void {
    this.output(this.formatEntry('debug', message, action, context));
  }

  public info(message: string, context?: unknown, action?: string): void {
    this.output(this.formatEntry('info', message, action, context));
  }

  public warn(message: string, context?: unknown, action?: string): void {
    this.output(this.formatEntry('warn', message, action, context));
  }

  public error(message: string, error?: unknown, context?: unknown, action?: string): void {
    const err = error instanceof Error ? error : (error ? new Error(String(error)) : undefined);
    this.output(this.formatEntry('error', message, action, context, err));
  }

  public child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }
}

export const logger = new Logger('App');

export function createLogger(moduleName: string): Logger {
  return new Logger(moduleName);
}
