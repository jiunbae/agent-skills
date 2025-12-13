/**
 * Custom error types for browser automation
 */

/**
 * Base error class for all browser automation errors
 */
export class BrowserAutomationError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'BrowserAutomationError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends BrowserAutomationError {
  constructor(message: string, timeout: number, selector?: string) {
    super(message, 'TIMEOUT', { timeout, selector });
    this.name = 'TimeoutError';
  }
}

/**
 * Element not found error
 */
export class ElementNotFoundError extends BrowserAutomationError {
  constructor(selector: string, timeout?: number) {
    super(`Element not found: ${selector}`, 'ELEMENT_NOT_FOUND', { selector, timeout });
    this.name = 'ElementNotFoundError';
  }
}

/**
 * Navigation error
 */
export class NavigationError extends BrowserAutomationError {
  constructor(url: string, reason: string) {
    super(`Navigation failed to ${url}: ${reason}`, 'NAVIGATION_FAILED', { url, reason });
    this.name = 'NavigationError';
  }
}

/**
 * Browser launch error
 */
export class BrowserLaunchError extends BrowserAutomationError {
  constructor(reason: string) {
    super(`Failed to launch browser: ${reason}`, 'BROWSER_LAUNCH_FAILED', { reason });
    this.name = 'BrowserLaunchError';
  }
}

/**
 * Screenshot error
 */
export class ScreenshotError extends BrowserAutomationError {
  constructor(reason: string, path?: string) {
    super(`Screenshot failed: ${reason}`, 'SCREENSHOT_FAILED', { reason, path });
    this.name = 'ScreenshotError';
  }
}

/**
 * Invalid selector error
 */
export class InvalidSelectorError extends BrowserAutomationError {
  constructor(selector: string, reason: string) {
    super(`Invalid selector "${selector}": ${reason}`, 'INVALID_SELECTOR', { selector, reason });
    this.name = 'InvalidSelectorError';
  }
}

/**
 * Form validation error
 */
export class FormValidationError extends BrowserAutomationError {
  constructor(field: string, reason: string) {
    super(`Form validation failed for "${field}": ${reason}`, 'FORM_VALIDATION', { field, reason });
    this.name = 'FormValidationError';
  }
}

/**
 * Wrap an unknown error into a BrowserAutomationError
 */
export function wrapError(error: unknown, context?: string): BrowserAutomationError {
  if (error instanceof BrowserAutomationError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = context ? `${context}: ${message}` : message;

  return new BrowserAutomationError(fullMessage, 'UNKNOWN_ERROR', {
    originalError: error instanceof Error ? error.name : typeof error,
  });
}

/**
 * Format error for CLI output
 */
export function formatError(error: unknown): string {
  if (error instanceof BrowserAutomationError) {
    let output = `Error [${error.code}]: ${error.message}`;
    if (error.details) {
      output += `\nDetails: ${JSON.stringify(error.details, null, 2)}`;
    }
    return output;
  }

  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return `Error: ${String(error)}`;
}
