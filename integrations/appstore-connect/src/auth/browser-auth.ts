/**
 * App Store Connect Skill - Browser Authentication Manager
 *
 * Manages browser-based authentication for App Store Connect.
 * Uses Playwright with session persistence.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserConfig, SessionState } from '../types.js';
import { SessionError, BrowserError, TimeoutError } from '../utils/errors.js';
import { SessionStore, getDefaultSessionStore } from './session-store.js';

const APP_STORE_CONNECT_URL = 'https://appstoreconnect.apple.com';
const APPLE_ID_URL = 'https://appleid.apple.com';

/**
 * Browser Authentication Manager
 */
export class BrowserAuthManager {
  private readonly config: BrowserConfig;
  private readonly sessionStore: SessionStore;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(config: BrowserConfig, sessionStore?: SessionStore) {
    this.config = config;
    this.sessionStore = sessionStore || getDefaultSessionStore();
  }

  /**
   * Check if we have a valid session
   */
  public hasValidSession(): boolean {
    return this.sessionStore.isValid();
  }

  /**
   * Get session info
   */
  public getSessionInfo() {
    return this.sessionStore.getInfo();
  }

  /**
   * Create an authenticated browser context
   */
  public async createAuthenticatedContext(): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
  }> {
    if (!this.hasValidSession()) {
      throw new SessionError(
        'No valid session found. Please run "asc auth login --headed" first.'
      );
    }

    try {
      // Launch browser
      this.browser = await chromium.launch({
        headless: this.config.headless,
        slowMo: this.config.slowMo,
      });

      // Create context with saved state
      this.context = await this.browser.newContext({
        storageState: this.sessionStore.getStoragePath(),
        viewport: this.config.viewport,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await this.context.newPage();

      // Navigate to App Store Connect to verify session
      await page.goto(APP_STORE_CONNECT_URL, {
        waitUntil: 'networkidle',
        timeout: this.config.twoFactorTimeout,
      });

      // Check if we're still logged in
      const isLoggedIn = await this.checkLoginStatus(page);

      if (!isLoggedIn) {
        await this.close();
        throw new SessionError(
          'Session expired. Please run "asc auth login --headed" to re-authenticate.'
        );
      }

      // Update session last used time
      this.sessionStore.touch();

      return {
        browser: this.browser,
        context: this.context,
        page,
      };
    } catch (error) {
      await this.close();

      if (error instanceof SessionError) {
        throw error;
      }

      throw new BrowserError(
        `Failed to create authenticated context: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: String(error) }
      );
    }
  }

  /**
   * Perform interactive login (requires --headed mode)
   */
  public async performLogin(appleId?: string): Promise<void> {
    if (this.config.headless) {
      throw new BrowserError(
        'Login requires headed mode. Use --headed flag.',
        { suggestion: 'npm run asc -- auth login --headed' }
      );
    }

    console.log('\n🍎 Starting App Store Connect login...\n');

    try {
      // Launch visible browser
      this.browser = await chromium.launch({
        headless: false,
        slowMo: 100,
      });

      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await this.context.newPage();

      // Navigate to App Store Connect
      console.log('📱 Opening App Store Connect...');
      await page.goto(APP_STORE_CONNECT_URL, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Pre-fill Apple ID if provided
      if (appleId) {
        try {
          const accountInput = await page.waitForSelector(
            'input[name="account_name_text_field"], input#account_name_text_field',
            { timeout: 5000 }
          );
          if (accountInput) {
            await accountInput.fill(appleId);
            console.log(`✅ Apple ID pre-filled: ${appleId}`);
          }
        } catch {
          // Input might not be visible yet, user will fill manually
        }
      }

      // Instructions for user
      console.log('\n📋 Instructions:');
      console.log('   1. Enter your Apple ID and password in the browser');
      console.log('   2. Complete two-factor authentication if prompted');
      console.log('   3. Wait until you see the App Store Connect dashboard');
      console.log('\n⏳ Waiting for login to complete...');
      console.log(`   (Timeout: ${this.config.twoFactorTimeout / 1000} seconds)\n`);

      // Wait for successful login
      await this.waitForLogin(page);

      // Save session state
      console.log('💾 Saving session...');
      const storageState = await this.context.storageState();

      const sessionState: SessionState = {
        ...storageState,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        appleId,
      };

      this.sessionStore.save(sessionState);

      console.log('\n✅ Login successful! Session saved.');
      console.log('   You can now use API commands without --headed.\n');

    } catch (error) {
      if (error instanceof TimeoutError) {
        throw error;
      }

      throw new BrowserError(
        `Login failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      await this.close();
    }
  }

  /**
   * Wait for login to complete
   */
  private async waitForLogin(page: Page): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.twoFactorTimeout;

    while (Date.now() - startTime < timeout) {
      // Check if we're on the App Store Connect dashboard
      const url = page.url();

      if (url.includes('appstoreconnect.apple.com/apps') ||
          url.includes('appstoreconnect.apple.com/analytics') ||
          url.includes('appstoreconnect.apple.com/access')) {
        // Verify by checking for dashboard elements
        const isLoggedIn = await this.checkLoginStatus(page);
        if (isLoggedIn) {
          return;
        }
      }

      // Wait a bit before checking again
      await page.waitForTimeout(1000);
    }

    throw new TimeoutError('Login', timeout);
  }

  /**
   * Check if user is logged in
   */
  private async checkLoginStatus(page: Page): Promise<boolean> {
    try {
      // Check for common dashboard elements
      const dashboardIndicators = [
        '[data-testid="app-navigation"]',
        '.apps-list',
        '.analytics-container',
        'button[data-testid="user-menu-button"]',
        'nav[role="navigation"]',
      ];

      for (const selector of dashboardIndicators) {
        try {
          const element = await page.$(selector);
          if (element) {
            return true;
          }
        } catch {
          // Continue checking other selectors
        }
      }

      // Check URL patterns
      const url = page.url();
      if (url.includes('/apps') || url.includes('/analytics')) {
        // Additional check: ensure we're not on login page
        const loginForm = await page.$('input[name="account_name_text_field"]');
        return !loginForm;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Logout and clear session
   */
  public async logout(): Promise<void> {
    this.sessionStore.clear();
    await this.close();
    console.log('✅ Logged out. Session cleared.');
  }

  /**
   * Close browser
   */
  public async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Ignore close errors
      }
      this.context = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore close errors
      }
      this.browser = null;
    }
  }
}

/**
 * Create a browser auth manager instance
 */
export function createBrowserAuthManager(
  config: BrowserConfig,
  sessionStore?: SessionStore
): BrowserAuthManager {
  return new BrowserAuthManager(config, sessionStore);
}
