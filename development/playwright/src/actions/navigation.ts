/**
 * Navigation actions
 */

import type { Page } from 'playwright';
import type { NavigationOptions, WaitStrategy, CommandResult } from '../types.js';
import { NavigationError, TimeoutError, wrapError } from '../utils/errors.js';

/**
 * Navigate to a URL
 */
export async function navigate(
  page: Page,
  options: NavigationOptions
): Promise<CommandResult<{ url: string; title: string }>> {
  const { url, waitUntil = 'load', timeout = 30000 } = options;
  const startTime = Date.now();

  try {
    const response = await page.goto(url, {
      waitUntil,
      timeout,
    });

    if (!response) {
      throw new NavigationError(url, 'No response received');
    }

    if (!response.ok()) {
      throw new NavigationError(url, `HTTP ${response.status()}`);
    }

    const title = await page.title();

    return {
      success: true,
      data: {
        url: page.url(),
        title,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof NavigationError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('Timeout')) {
      throw new TimeoutError(`Navigation timed out after ${timeout}ms`, timeout);
    }

    throw new NavigationError(url, message);
  }
}

/**
 * Reload current page
 */
export async function reload(
  page: Page,
  waitUntil: WaitStrategy = 'load'
): Promise<CommandResult<{ url: string }>> {
  const startTime = Date.now();

  try {
    await page.reload({ waitUntil });

    return {
      success: true,
      data: { url: page.url() },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw wrapError(error, 'Reload failed');
  }
}

/**
 * Go back in history
 */
export async function goBack(
  page: Page,
  waitUntil: WaitStrategy = 'load'
): Promise<CommandResult<{ url: string }>> {
  const startTime = Date.now();

  try {
    const response = await page.goBack({ waitUntil });

    if (!response) {
      return {
        success: false,
        error: 'No previous page in history',
        duration: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: { url: page.url() },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw wrapError(error, 'Go back failed');
  }
}

/**
 * Go forward in history
 */
export async function goForward(
  page: Page,
  waitUntil: WaitStrategy = 'load'
): Promise<CommandResult<{ url: string }>> {
  const startTime = Date.now();

  try {
    const response = await page.goForward({ waitUntil });

    if (!response) {
      return {
        success: false,
        error: 'No next page in history',
        duration: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: { url: page.url() },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw wrapError(error, 'Go forward failed');
  }
}

/**
 * Get current page info
 */
export async function getPageInfo(
  page: Page
): Promise<CommandResult<{ url: string; title: string }>> {
  try {
    return {
      success: true,
      data: {
        url: page.url(),
        title: await page.title(),
      },
    };
  } catch (error) {
    throw wrapError(error, 'Failed to get page info');
  }
}

/**
 * Wait for navigation to complete
 */
export async function waitForNavigation(
  page: Page,
  waitUntil: WaitStrategy = 'load',
  timeout: number = 30000
): Promise<void> {
  try {
    await page.waitForLoadState(waitUntil, { timeout });
  } catch (error) {
    throw new TimeoutError(`Wait for navigation timed out`, timeout);
  }
}
