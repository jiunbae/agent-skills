/**
 * Navigate command - Navigate to a URL
 */

import type { Command, CommandResult, WaitStrategy } from '../../types.js';
import { withBrowser, parseViewport } from '../../core/browser.js';
import { navigate } from '../../actions/navigation.js';

export const navigateCommand: Command = {
  name: 'navigate',
  description: 'Navigate to a URL and optionally take a screenshot',
  usage: 'pw navigate <url> [options]',
  options: [
    { flag: '--wait <strategy>', description: 'Wait strategy: load, domcontentloaded, networkidle' },
    { flag: '--timeout <ms>', description: 'Navigation timeout in milliseconds (default: 30000)' },
    { flag: '--viewport <WxH>', description: 'Viewport size (e.g., 1920x1080)' },
    { flag: '--screenshot', description: 'Take a screenshot after navigation' },
    { flag: '--output <path>', description: 'Screenshot output path (with --screenshot)' },
    { flag: '--headless', description: 'Run in headless mode (default: true)' },
    { flag: '--json', description: 'Output result as JSON' },
  ],

  async execute(args: string[], options: Record<string, unknown>): Promise<CommandResult> {
    const url = args[0];

    if (!url) {
      return {
        success: false,
        error: 'URL is required. Usage: pw navigate <url>',
      };
    }

    // Ensure URL has protocol
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;

    const waitStrategy = (options.wait as WaitStrategy) || 'load';
    const timeout = options.timeout ? parseInt(String(options.timeout), 10) : 30000;
    const viewport = options.viewport ? parseViewport(String(options.viewport)) : undefined;
    const takeScreenshot = Boolean(options.screenshot);
    const screenshotPath = options.output as string | undefined;
    const headless = options.headless !== false;

    const result = await withBrowser(
      async (page) => {
        if (viewport) {
          await page.setViewportSize(viewport);
        }

        const navResult = await navigate(page, {
          url: fullUrl,
          waitUntil: waitStrategy,
          timeout,
        });

        let screenshotResult: { path: string } | undefined;

        if (takeScreenshot) {
          const path = screenshotPath || `/tmp/screenshot-${Date.now()}.png`;
          await page.screenshot({ path, fullPage: true });
          screenshotResult = { path };
        }

        return {
          ...navResult.data,
          screenshot: screenshotResult,
        };
      },
      { config: { headless, viewport: viewport || { width: 1920, height: 1080 } } }
    );

    return {
      success: true,
      data: result,
    };
  },
};
