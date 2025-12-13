/**
 * Scrape command - Extract data from web pages
 */

import type { Command, CommandResult, WaitStrategy } from '../../types.js';
import { withBrowser } from '../../core/browser.js';

export const scrapeCommand: Command = {
  name: 'scrape',
  description: 'Extract data from a web page using CSS selectors',
  usage: 'pw scrape <url> <selector> [options]',
  options: [
    { flag: '--attribute <attr>', description: 'Extract attribute value (default: textContent)' },
    { flag: '--multiple', description: 'Extract from all matching elements' },
    { flag: '--wait <strategy>', description: 'Wait strategy: load, domcontentloaded, networkidle' },
    { flag: '--timeout <ms>', description: 'Timeout in milliseconds (default: 30000)' },
    { flag: '--json', description: 'Output result as JSON' },
    { flag: '--trim', description: 'Trim whitespace from results (default: true)' },
  ],

  async execute(args: string[], options: Record<string, unknown>): Promise<CommandResult> {
    const url = args[0];
    const selector = args[1];

    if (!url || !selector) {
      return {
        success: false,
        error: 'URL and selector are required. Usage: pw scrape <url> <selector>',
      };
    }

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const attribute = options.attribute as string | undefined;
    const multiple = Boolean(options.multiple);
    const waitStrategy = (options.wait as WaitStrategy) || 'networkidle';
    const timeout = options.timeout ? parseInt(String(options.timeout), 10) : 30000;
    const trim = options.trim !== false;

    const result = await withBrowser(
      async (page) => {
        const startTime = Date.now();

        // Navigate to page
        await page.goto(fullUrl, { waitUntil: waitStrategy, timeout });

        // Wait for selector
        await page.locator(selector).first().waitFor({ state: 'attached', timeout });

        let data: string | string[] | null;
        let count: number;

        if (multiple) {
          // Get all matching elements
          const locators = page.locator(selector);
          count = await locators.count();

          if (attribute) {
            data = await locators.evaluateAll(
              (elements, attr) => elements.map(el => el.getAttribute(attr) || ''),
              attribute
            );
          } else {
            data = await locators.allTextContents();
          }

          if (trim && Array.isArray(data)) {
            data = data.map(s => s.trim()).filter(s => s.length > 0);
          }
        } else {
          // Get first matching element
          const locator = page.locator(selector).first();
          count = 1;

          if (attribute) {
            data = await locator.getAttribute(attribute);
          } else {
            data = await locator.textContent();
          }

          if (trim && data) {
            data = data.trim();
          }
        }

        return {
          url: fullUrl,
          selector,
          attribute: attribute || 'textContent',
          count,
          data,
          duration: Date.now() - startTime,
        };
      },
      { config: { headless: true } }
    );

    // For non-JSON output, print data directly
    if (!options.json && result.data) {
      if (Array.isArray(result.data)) {
        for (const item of result.data) {
          console.log(item);
        }
      } else {
        console.log(result.data);
      }
    }

    return {
      success: true,
      data: result,
    };
  },
};
