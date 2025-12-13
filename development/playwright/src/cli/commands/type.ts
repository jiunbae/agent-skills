/**
 * Type command - Type text into elements on a web page
 */

import type { Command, CommandResult, WaitStrategy } from '../../types.js';
import { withBrowser } from '../../core/browser.js';
import { type as typeAction, fill } from '../../actions/interaction.js';

export const typeCommand: Command = {
  name: 'type',
  description: 'Type text into an element on a web page',
  usage: 'pw type <selector> <text> [options]',
  options: [
    { flag: '--url <url>', description: 'URL to navigate to before typing (required)' },
    { flag: '--wait <strategy>', description: 'Wait strategy after navigation: load, domcontentloaded, networkidle' },
    { flag: '--clear', description: 'Clear existing text before typing' },
    { flag: '--delay <ms>', description: 'Delay between keystrokes in milliseconds' },
    { flag: '--fill', description: 'Use fill instead of type (faster, replaces entire value)' },
    { flag: '--timeout <ms>', description: 'Timeout in milliseconds (default: 30000)' },
    { flag: '--screenshot', description: 'Take screenshot after typing' },
    { flag: '--output <path>', description: 'Screenshot output path' },
    { flag: '--json', description: 'Output result as JSON' },
  ],

  async execute(args: string[], options: Record<string, unknown>): Promise<CommandResult> {
    const selector = args[0];
    const text = args[1];

    if (!selector || text === undefined) {
      return {
        success: false,
        error: 'Selector and text are required. Usage: pw type <selector> <text> --url <url>',
      };
    }

    const url = options.url as string | undefined;
    if (!url) {
      return {
        success: false,
        error: 'URL is required. Usage: pw type <selector> <text> --url <url>',
      };
    }

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const waitStrategy = (options.wait as WaitStrategy) || 'load';
    const clearFirst = Boolean(options.clear);
    const delay = options.delay ? parseInt(String(options.delay), 10) : 0;
    const useFill = Boolean(options.fill);
    const timeout = options.timeout ? parseInt(String(options.timeout), 10) : 30000;
    const takeScreenshot = Boolean(options.screenshot);
    const screenshotPath = options.output as string | undefined;

    const result = await withBrowser(
      async (page) => {
        // Navigate first
        await page.goto(fullUrl, { waitUntil: waitStrategy, timeout });

        // Type or fill
        let actionResult;
        if (useFill) {
          actionResult = await fill(page, selector, text, timeout);
        } else {
          actionResult = await typeAction(page, {
            selector,
            text,
            delay,
            clear: clearFirst,
            timeout,
          });
        }

        // Take screenshot if requested
        let screenshotResult: { path: string } | undefined;
        if (takeScreenshot) {
          const path = screenshotPath || `/tmp/screenshot-type-${Date.now()}.png`;
          await page.screenshot({ path, fullPage: true });
          screenshotResult = { path };
        }

        return {
          selector,
          text,
          action: useFill ? 'fill' : 'type',
          cleared: clearFirst,
          screenshot: screenshotResult,
          duration: actionResult.duration,
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
