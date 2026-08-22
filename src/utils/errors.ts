export class AppError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.isOperational = isOperational;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', false, context);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', true, context);
  }
}

export class ProviderError extends AppError {
  constructor(providerName: string, message: string, context?: Record<string, unknown>) {
    super(`[${providerName}] ${message}`, 'PROVIDER_ERROR', true, context);
  }
}

export class SafetyViolationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'SAFETY_VIOLATION', false, context);
  }
}

export class DuplicateRecordError extends AppError {
  constructor(entity: string, details: string) {
    super(`${entity} already exists with details: ${details}`, 'DUPLICATE_RECORD', true);
  }
}
