/**
 * Screenshot command - Take screenshots of web pages
 */

import type { Command, CommandResult, WaitStrategy } from '../../types.js';
import { withBrowser, parseViewport } from '../../core/browser.js';
import { screenshot, VIEWPORT_PRESETS } from '../../actions/screenshot.js';

export const screenshotCommand: Command = {
  name: 'screenshot',
  description: 'Take a screenshot of a web page',
  usage: 'pw screenshot <url> [options]',
  options: [
    { flag: '--output, -o <path>', description: 'Output file path (default: /tmp/screenshot-<timestamp>.png)' },
    { flag: '--full-page', description: 'Capture full page (default: true)' },
    { flag: '--viewport <WxH>', description: 'Viewport size (e.g., 1920x1080)' },
    { flag: '--wait <strategy>', description: 'Wait strategy: load, domcontentloaded, networkidle' },
    { flag: '--timeout <ms>', description: 'Navigation timeout in milliseconds (default: 30000)' },
    { flag: '--type <format>', description: 'Image format: png or jpeg (default: png)' },
    { flag: '--quality <0-100>', description: 'JPEG quality (only for jpeg)' },
    { flag: '--mobile', description: 'Use mobile viewport (375x667)' },
    { flag: '--tablet', description: 'Use tablet viewport (768x1024)' },
    { flag: '--json', description: 'Output result as JSON' },
  ],

  async execute(args: string[], options: Record<string, unknown>): Promise<CommandResult> {
    const url = args[0];

    if (!url) {
      return {
        success: false,
        error: 'URL is required. Usage: pw screenshot <url>',
      };
    }

    // Ensure URL has protocol
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;

    const outputPath = (options.output || options.o) as string | undefined;
    const fullPage = options['full-page'] !== false;
    const waitStrategy = (options.wait as WaitStrategy) || 'networkidle';
    const timeout = options.timeout ? parseInt(String(options.timeout), 10) : 30000;
    const imageType = (options.type as 'png' | 'jpeg') || 'png';
    const quality = options.quality ? parseInt(String(options.quality), 10) : undefined;

    // Determine viewport
    let viewport = { width: 1920, height: 1080 };
    if (options.mobile) {
      viewport = VIEWPORT_PRESETS.mobile;
    } else if (options.tablet) {
      viewport = VIEWPORT_PRESETS.tablet;
    } else if (options.viewport) {
      viewport = parseViewport(String(options.viewport));
    }

    const result = await withBrowser(
      async (page) => {
        await page.setViewportSize(viewport);
        await page.goto(fullUrl, { waitUntil: waitStrategy, timeout });

        const screenshotResult = await screenshot(page, {
          path: outputPath,
          fullPage,
          type: imageType,
          quality,
        });

        return {
          url: fullUrl,
          viewport: `${viewport.width}x${viewport.height}`,
          ...screenshotResult.data,
        };
      },
      { config: { headless: true, viewport } }
    );

    return {
      success: true,
      data: result,
    };
  },
};
