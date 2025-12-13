/**
 * Screenshot capture actions
 */

import type { Page } from 'playwright';
import type { ScreenshotOptions, CommandResult } from '../types.js';
import { ScreenshotError, wrapError } from '../utils/errors.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Generate default screenshot path
 */
function generateScreenshotPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `/tmp/screenshot-${timestamp}.png`;
}

/**
 * Ensure directory exists
 */
function ensureDirectory(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Take a screenshot of the current page
 */
export async function screenshot(
  page: Page,
  options: ScreenshotOptions = {}
): Promise<CommandResult<{ path: string; size?: number }>> {
  const {
    path: outputPath = generateScreenshotPath(),
    fullPage = true,
    type = 'png',
    quality,
    clip,
  } = options;

  const startTime = Date.now();

  try {
    ensureDirectory(outputPath);

    const buffer = await page.screenshot({
      path: outputPath,
      fullPage,
      type,
      quality: type === 'jpeg' ? quality || 80 : undefined,
      clip,
    });

    return {
      success: true,
      data: {
        path: outputPath,
        size: buffer.length,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw new ScreenshotError(
      error instanceof Error ? error.message : String(error),
      outputPath
    );
  }
}

/**
 * Take a screenshot of a specific element
 */
export async function screenshotElement(
  page: Page,
  selector: string,
  options: Omit<ScreenshotOptions, 'fullPage' | 'clip'> = {}
): Promise<CommandResult<{ path: string; size?: number }>> {
  const {
    path: outputPath = generateScreenshotPath(),
    type = 'png',
    quality,
  } = options;

  const startTime = Date.now();

  try {
    ensureDirectory(outputPath);

    const locator = page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout: 30000 });

    const buffer = await locator.screenshot({
      path: outputPath,
      type,
      quality: type === 'jpeg' ? quality || 80 : undefined,
    });

    return {
      success: true,
      data: {
        path: outputPath,
        size: buffer.length,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw new ScreenshotError(
      error instanceof Error ? error.message : String(error),
      outputPath
    );
  }
}

/**
 * Take multiple viewport screenshots
 */
export async function screenshotViewports(
  page: Page,
  url: string,
  viewports: Array<{ name: string; width: number; height: number }>,
  outputDir: string = '/tmp'
): Promise<CommandResult<{ screenshots: Array<{ name: string; path: string }> }>> {
  const startTime = Date.now();
  const screenshots: Array<{ name: string; path: string }> = [];

  try {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(url, { waitUntil: 'networkidle' });

      const timestamp = Date.now();
      const path = `${outputDir}/screenshot-${viewport.name}-${timestamp}.png`;

      await page.screenshot({ path, fullPage: true });
      screenshots.push({ name: viewport.name, path });
    }

    return {
      success: true,
      data: { screenshots },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw wrapError(error, 'Viewport screenshots failed');
  }
}

/**
 * Common viewport presets
 */
export const VIEWPORT_PRESETS = {
  mobile: { name: 'mobile', width: 375, height: 667 },
  tablet: { name: 'tablet', width: 768, height: 1024 },
  laptop: { name: 'laptop', width: 1366, height: 768 },
  desktop: { name: 'desktop', width: 1920, height: 1080 },
  '4k': { name: '4k', width: 3840, height: 2160 },
} as const;

/**
 * Take screenshots in all common viewports
 */
export async function screenshotAllViewports(
  page: Page,
  url: string,
  outputDir: string = '/tmp'
): Promise<CommandResult<{ screenshots: Array<{ name: string; path: string }> }>> {
  const viewports = Object.values(VIEWPORT_PRESETS);
  return screenshotViewports(page, url, viewports, outputDir);
}

/**
 * Generate PDF of the page
 */
export async function pdf(
  page: Page,
  outputPath?: string
): Promise<CommandResult<{ path: string; size?: number }>> {
  const path = outputPath || `/tmp/page-${Date.now()}.pdf`;
  const startTime = Date.now();

  try {
    ensureDirectory(path);

    const buffer = await page.pdf({
      path,
      format: 'A4',
      printBackground: true,
    });

    return {
      success: true,
      data: {
        path,
        size: buffer.length,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    throw wrapError(error, 'PDF generation failed');
  }
}
