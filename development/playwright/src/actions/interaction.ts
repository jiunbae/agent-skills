/**
 * Element interaction actions
 */

import type { Page, Locator } from 'playwright';
import type { ClickOptions, TypeOptions, CommandResult } from '../types.js';
import { ElementNotFoundError, TimeoutError, wrapError } from '../utils/errors.js';

/**
 * Wait for element and get locator
 */
async function getLocator(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<Locator> {
  const locator = page.locator(selector);

  try {
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  } catch (error) {
    throw new ElementNotFoundError(selector, timeout);
  }
}

/**
 * Click an element
 */
export async function click(
  page: Page,
  options: ClickOptions
): Promise<CommandResult> {
  const {
    selector,
    button = 'left',
    clickCount = 1,
    delay,
    force = false,
    timeout = 30000,
  } = options;

  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);

    await locator.click({
      button,
      clickCount,
      delay,
      force,
      timeout,
    });

    return {
      success: true,
      data: { selector, clicked: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Click failed on ${selector}`);
  }
}

/**
 * Double click an element
 */
export async function doubleClick(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.dblclick({ timeout });

    return {
      success: true,
      data: { selector, doubleClicked: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Double click failed on ${selector}`);
  }
}

/**
 * Right click an element
 */
export async function rightClick(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.click({ button: 'right', timeout });

    return {
      success: true,
      data: { selector, rightClicked: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Right click failed on ${selector}`);
  }
}

/**
 * Type text into an element
 */
export async function type(
  page: Page,
  options: TypeOptions
): Promise<CommandResult> {
  const { selector, text, delay = 0, clear = false, timeout = 30000 } = options;
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);

    if (clear) {
      await locator.clear({ timeout });
    }

    await locator.type(text, { delay, timeout });

    return {
      success: true,
      data: { selector, text, typed: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Type failed on ${selector}`);
  }
}

/**
 * Fill an input field (faster than type, replaces entire value)
 */
export async function fill(
  page: Page,
  selector: string,
  value: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.fill(value, { timeout });

    return {
      success: true,
      data: { selector, value, filled: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Fill failed on ${selector}`);
  }
}

/**
 * Clear an input field
 */
export async function clear(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.clear({ timeout });

    return {
      success: true,
      data: { selector, cleared: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Clear failed on ${selector}`);
  }
}

/**
 * Select option from dropdown
 */
export async function selectOption(
  page: Page,
  selector: string,
  value: string | string[],
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    const selected = await locator.selectOption(value, { timeout });

    return {
      success: true,
      data: { selector, selected },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Select option failed on ${selector}`);
  }
}

/**
 * Check a checkbox
 */
export async function check(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.check({ timeout });

    return {
      success: true,
      data: { selector, checked: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Check failed on ${selector}`);
  }
}

/**
 * Uncheck a checkbox
 */
export async function uncheck(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.uncheck({ timeout });

    return {
      success: true,
      data: { selector, unchecked: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Uncheck failed on ${selector}`);
  }
}

/**
 * Hover over an element
 */
export async function hover(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.hover({ timeout });

    return {
      success: true,
      data: { selector, hovered: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Hover failed on ${selector}`);
  }
}

/**
 * Focus on an element
 */
export async function focus(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    await locator.focus({ timeout });

    return {
      success: true,
      data: { selector, focused: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Focus failed on ${selector}`);
  }
}

/**
 * Press keyboard key
 */
export async function press(
  page: Page,
  key: string
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    await page.keyboard.press(key);

    return {
      success: true,
      data: { key, pressed: true },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw wrapError(error, `Press key ${key} failed`);
  }
}

/**
 * Get element text content
 */
export async function getText(
  page: Page,
  selector: string,
  timeout: number = 30000
): Promise<CommandResult<string | null>> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    const text = await locator.textContent({ timeout });

    return {
      success: true,
      data: text,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Get text failed on ${selector}`);
  }
}

/**
 * Get element attribute
 */
export async function getAttribute(
  page: Page,
  selector: string,
  attribute: string,
  timeout: number = 30000
): Promise<CommandResult<string | null>> {
  const startTime = Date.now();

  try {
    const locator = await getLocator(page, selector, timeout);
    const value = await locator.getAttribute(attribute, { timeout });

    return {
      success: true,
      data: value,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof ElementNotFoundError) {
      throw error;
    }
    throw wrapError(error, `Get attribute ${attribute} failed on ${selector}`);
  }
}

/**
 * Check if element is visible
 */
export async function isVisible(
  page: Page,
  selector: string
): Promise<boolean> {
  try {
    const locator = page.locator(selector);
    return await locator.isVisible();
  } catch {
    return false;
  }
}

/**
 * Wait for element to appear
 */
export async function waitForElement(
  page: Page,
  selector: string,
  state: 'visible' | 'hidden' | 'attached' | 'detached' = 'visible',
  timeout: number = 30000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const locator = page.locator(selector);
    await locator.waitFor({ state, timeout });

    return {
      success: true,
      data: { selector, state },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw new TimeoutError(`Wait for element ${selector} timed out`, timeout, selector);
  }
}
