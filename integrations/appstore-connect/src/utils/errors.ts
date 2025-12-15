/**
 * App Store Connect Skill - Error Handling
 */

export type ErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'rate_limit'
  | 'validation'
  | 'connection'
  | 'timeout'
  | 'session'
  | 'browser'
  | 'unknown';

export interface ErrorDetails {
  code: string;
  message: string;
  category: ErrorCategory;
  statusCode?: number;
  details?: Record<string, unknown>;
  cause?: Error;
}

/**
 * Base error class for App Store Connect skill
 */
export class AppStoreConnectError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly statusCode?: number;
  public readonly details?: Record<string, unknown>;
  public readonly cause?: Error;

  constructor(errorDetails: ErrorDetails) {
    super(errorDetails.message);
    this.name = 'AppStoreConnectError';
    this.code = errorDetails.code;
    this.category = errorDetails.category;
    this.statusCode = errorDetails.statusCode;
    this.details = errorDetails.details;
    this.cause = errorDetails.cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      category: this.category,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

/**
 * Authentication error (invalid credentials, expired token)
 */
export class AuthenticationError extends AppStoreConnectError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'AUTH_ERROR',
      message,
      category: 'authentication',
      statusCode: 401,
      details,
    });
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error (insufficient permissions)
 */
export class AuthorizationError extends AppStoreConnectError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'FORBIDDEN',
      message,
      category: 'authorization',
      statusCode: 403,
      details,
    });
    this.name = 'AuthorizationError';
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends AppStoreConnectError {
  constructor(resource: string, id?: string) {
    super({
      code: 'NOT_FOUND',
      message: id ? `${resource} not found: ${id}` : `${resource} not found`,
      category: 'not_found',
      statusCode: 404,
      details: { resource, id },
    });
    this.name = 'NotFoundError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AppStoreConnectError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super({
      code: 'RATE_LIMIT',
      message: retryAfter
        ? `Rate limit exceeded. Retry after ${retryAfter} seconds.`
        : 'Rate limit exceeded.',
      category: 'rate_limit',
      statusCode: 429,
      details: { retryAfter },
    });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Validation error (invalid input)
 */
export class ValidationError extends AppStoreConnectError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'VALIDATION_ERROR',
      message,
      category: 'validation',
      statusCode: 400,
      details,
    });
    this.name = 'ValidationError';
  }
}

/**
 * Connection error (network issues)
 */
export class ConnectionError extends AppStoreConnectError {
  constructor(message: string, cause?: Error) {
    super({
      code: 'CONNECTION_ERROR',
      message,
      category: 'connection',
      cause,
    });
    this.name = 'ConnectionError';
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends AppStoreConnectError {
  constructor(operation: string, timeoutMs: number) {
    super({
      code: 'TIMEOUT',
      message: `Operation "${operation}" timed out after ${timeoutMs}ms`,
      category: 'timeout',
      details: { operation, timeoutMs },
    });
    this.name = 'TimeoutError';
  }
}

/**
 * Session error (invalid or expired session)
 */
export class SessionError extends AppStoreConnectError {
  constructor(message: string) {
    super({
      code: 'SESSION_ERROR',
      message,
      category: 'session',
    });
    this.name = 'SessionError';
  }
}

/**
 * Browser automation error
 */
export class BrowserError extends AppStoreConnectError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'BROWSER_ERROR',
      message,
      category: 'browser',
      details,
    });
    this.name = 'BrowserError';
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AppStoreConnectError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'CONFIG_ERROR',
      message,
      category: 'validation',
      details,
    });
    this.name = 'ConfigurationError';
  }
}

/**
 * Convert HTTP status code to error category
 */
export function statusToCategory(statusCode: number): ErrorCategory {
  if (statusCode === 401) return 'authentication';
  if (statusCode === 403) return 'authorization';
  if (statusCode === 404) return 'not_found';
  if (statusCode === 429) return 'rate_limit';
  if (statusCode >= 400 && statusCode < 500) return 'validation';
  if (statusCode >= 500) return 'connection';
  return 'unknown';
}

/**
 * Parse API error response
 */
export function parseAPIError(response: {
  status: number;
  data?: { errors?: Array<{ code: string; title: string; detail: string }> };
}): AppStoreConnectError {
  const { status, data } = response;
  const errors = data?.errors || [];
  const firstError = errors[0];

  const message = firstError
    ? `${firstError.title}: ${firstError.detail}`
    : `API error: HTTP ${status}`;

  const category = statusToCategory(status);

  switch (category) {
    case 'authentication':
      return new AuthenticationError(message);
    case 'authorization':
      return new AuthorizationError(message);
    case 'not_found':
      return new NotFoundError('Resource', firstError?.detail);
    case 'rate_limit':
      return new RateLimitError();
    case 'validation':
      return new ValidationError(message, { errors });
    default:
      return new AppStoreConnectError({
        code: firstError?.code || 'API_ERROR',
        message,
        category,
        statusCode: status,
        details: { errors },
      });
  }
}

/**
 * Format error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof AppStoreConnectError) {
    const json = error.toJSON();
    return `[${json.code}] ${json.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof ConnectionError) return true;
  if (error instanceof TimeoutError) return true;

  if (error instanceof AppStoreConnectError) {
    return error.statusCode !== undefined && error.statusCode >= 500;
  }

  return false;
}
