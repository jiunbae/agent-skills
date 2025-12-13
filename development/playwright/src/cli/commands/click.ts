/**
 * Click command - Click elements on a web page
 */

import type { Command, CommandResult, WaitStrategy } from '../../types.js';
import { withBrowser, parseViewport } from '../../core/browser.js';
import { click } from '../../actions/interaction.js';

export const clickCommand: Command = {
  name: 'click',
  description: 'Click an element on a web page',
  usage: 'pw click <selector> [options]',
  options: [
    { flag: '--url <url>', description: 'URL to navigate to before clicking (required)' },
    { flag: '--wait <strategy>', description: 'Wait strategy after navigation: load, domcontentloaded, networkidle' },
    { flag: '--wait-for <selector>', description: 'Wait for this selector after clicking' },
    { flag: '--timeout <ms>', description: 'Timeout in milliseconds (default: 30000)' },
    { flag: '--double', description: 'Double click instead of single click' },
    { flag: '--right', description: 'Right click instead of left click' },
    { flag: '--screenshot', description: 'Take screenshot after clicking' },
    { flag: '--output <path>', description: 'Screenshot output path' },
    { flag: '--json', description: 'Output result as JSON' },
  ],

  async execute(args: string[], options: Record<string, unknown>): Promise<CommandResult> {
    const selector = args[0];

    if (!selector) {
      return {
        success: false,
        error: 'Selector is required. Usage: pw click <selector> --url <url>',
      };
    }

    const url = options.url as string | undefined;
    if (!url) {
      return {
        success: false,
        error: 'URL is required. Usage: pw click <selector> --url <url>',
      };
    }

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const waitStrategy = (options.wait as WaitStrategy) || 'load';
    const waitForSelector = options['wait-for'] as string | undefined;
    const timeout = options.timeout ? parseInt(String(options.timeout), 10) : 30000;
    const isDouble = Boolean(options.double);
    const isRight = Boolean(options.right);
    const takeScreenshot = Boolean(options.screenshot);
    const screenshotPath = options.output as string | undefined;

    const result = await withBrowser(
      async (page) => {
        // Navigate first
        await page.goto(fullUrl, { waitUntil: waitStrategy, timeout });

        // Click the element
        const clickResult = await click(page, {
          selector,
          button: isRight ? 'right' : 'left',
          clickCount: isDouble ? 2 : 1,
          timeout,
        });

        // Wait for selector if specified
        if (waitForSelector) {
          await page.locator(waitForSelector).waitFor({ state: 'visible', timeout });
        }

        // Take screenshot if requested
        let screenshotResult: { path: string } | undefined;
        if (takeScreenshot) {
          const path = screenshotPath || `/tmp/screenshot-click-${Date.now()}.png`;
          await page.screenshot({ path, fullPage: true });
          screenshotResult = { path };
        }

        return {
          selector,
          clicked: true,
          clickType: isDouble ? 'double' : isRight ? 'right' : 'left',
          currentUrl: page.url(),
          screenshot: screenshotResult,
          duration: clickResult.duration,
        };
      },
      { config: { headless: true } }
    );

    return {
      success: true,
      data: result,
    };
  },
};
