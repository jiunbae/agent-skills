/**
 * Browser instance management
 */

import { chromium, firefox, webkit } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserConfig } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';
import { BrowserLaunchError, wrapError } from '../utils/errors.js';

export type BrowserType = 'chromium' | 'firefox' | 'webkit';

/**
 * Browser manager singleton
 */
class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserConfig = DEFAULT_CONFIG;

  /**
   * Get browser launcher by type
   */
  private getBrowserLauncher(type: BrowserType) {
    switch (type) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      default:
        return chromium;
    }
  }

  /**
   * Launch browser with configuration
   */
  async launch(
    browserType: BrowserType = 'chromium',
    config: Partial<BrowserConfig> = {}
  ): Promise<Browser> {
    try {
      this.config = { ...DEFAULT_CONFIG, ...config };
      const launcher = this.getBrowserLauncher(browserType);

      this.browser = await launcher.launch({
        headless: this.config.headless,
        slowMo: this.config.slowMo,
      });

      return this.browser;
    } catch (error) {
      throw new BrowserLaunchError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Get or create browser instance
   */
  async getBrowser(browserType: BrowserType = 'chromium'): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.launch(browserType);
    }
    return this.browser!;
  }

  /**
   * Create new browser context
   */
  async createContext(config?: Partial<BrowserConfig>): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const mergedConfig = { ...this.config, ...config };

    this.context = await browser.newContext({
      viewport: mergedConfig.viewport,
      userAgent: mergedConfig.userAgent,
      locale: mergedConfig.locale,
      timezoneId: mergedConfig.timezone,
    });

    return this.context;
  }

  /**
   * Get or create context
   */
  async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      await this.createContext();
    }
    return this.context!;
  }

  /**
   * Create new page
   */
  async createPage(): Promise<Page> {
    const context = await this.getContext();
    this.page = await context.newPage();
    this.page.setDefaultTimeout(this.config.timeout);
    return this.page;
  }

  /**
   * Get or create page
   */
  async getPage(): Promise<Page> {
    if (!this.page || this.page.isClosed()) {
      await this.createPage();
    }
    return this.page!;
  }

  /**
   * Close current page
   */
  async closePage(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
      this.page = null;
    }
  }

  /**
   * Close current context
   */
  async closeContext(): Promise<void> {
    await this.closePage();
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    await this.closeContext();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): BrowserConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BrowserConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
export const browserManager = new BrowserManager();

/**
 * Quick browser session for one-off operations
 */
export async function withBrowser<T>(
  fn: (page: Page) => Promise<T>,
  options: {
    browserType?: BrowserType;
    config?: Partial<BrowserConfig>;
  } = {}
): Promise<T> {
  const { browserType = 'chromium', config } = options;
  let browser: Browser | null = null;

  try {
    const launcher =
      browserType === 'firefox'
        ? firefox
        : browserType === 'webkit'
          ? webkit
          : chromium;

    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    browser = await launcher.launch({
      headless: mergedConfig.headless,
      slowMo: mergedConfig.slowMo,
    });

    const context = await browser.newContext({
      viewport: mergedConfig.viewport,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(mergedConfig.timeout);

    const result = await fn(page);

    await context.close();
    return result;
  } catch (error) {
    throw wrapError(error, 'Browser operation failed');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Parse viewport string (e.g., "1920x1080")
 */
export function parseViewport(viewport: string): { width: number; height: number } {
  const match = viewport.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return DEFAULT_CONFIG.viewport;
  }
  return {
    width: parseInt(match[1], 10),
    height: parseInt(match[2], 10),
  };
}
