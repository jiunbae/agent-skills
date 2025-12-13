/**
 * Type definitions for jelly-playwright
 */

import type { Page, Browser, BrowserContext, Locator } from 'playwright';

// Re-export Playwright types for convenience
export type { Page, Browser, BrowserContext, Locator };

/**
 * Browser configuration options
 */
export interface BrowserConfig {
  headless: boolean;
  slowMo?: number;
  timeout: number;
  viewport: {
    width: number;
    height: number;
  };
  userAgent?: string;
  locale?: string;
  timezone?: string;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: BrowserConfig = {
  headless: true,
  timeout: 30000,
  viewport: {
    width: 1920,
    height: 1080,
  },
};

/**
 * Navigation wait strategies
 */
export type WaitStrategy = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

/**
 * Navigation options
 */
export interface NavigationOptions {
  url: string;
  waitUntil?: WaitStrategy;
  timeout?: number;
}

/**
 * Screenshot options
 */
export interface ScreenshotOptions {
  path?: string;
  fullPage?: boolean;
  type?: 'png' | 'jpeg';
  quality?: number;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Click options
 */
export interface ClickOptions {
  selector: string;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  force?: boolean;
  timeout?: number;
}

/**
 * Type options
 */
export interface TypeOptions {
  selector: string;
  text: string;
  delay?: number;
  clear?: boolean;
  timeout?: number;
}

/**
 * Scrape options
 */
export interface ScrapeOptions {
  selector: string;
  attribute?: string;
  multiple?: boolean;
  timeout?: number;
}

/**
 * Scrape result
 */
export interface ScrapeResult {
  success: boolean;
  data: string | string[] | null;
  count?: number;
  error?: string;
}

/**
 * Command result
 */
export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
}

/**
 * CLI Command interface
 */
export interface Command {
  name: string;
  description: string;
  usage: string;
  options?: CommandOption[];
  execute: (args: string[], options: Record<string, unknown>) => Promise<CommandResult>;
}

/**
 * CLI Option interface
 */
export interface CommandOption {
  flag: string;
  description: string;
  default?: unknown;
  required?: boolean;
}

/**
 * Element state for wait conditions
 */
export interface ElementState {
  present: boolean;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
}

/**
 * Wait condition types
 */
export type WaitCondition = 'presence' | 'visible' | 'hidden' | 'enabled' | 'clickable';

/**
 * Form field types
 */
export type FormFieldType = 'input' | 'textarea' | 'select' | 'checkbox' | 'radio';

/**
 * Form field info
 */
export interface FormFieldInfo {
  selector: string;
  type: FormFieldType;
  name?: string;
  value?: string;
  required?: boolean;
}
