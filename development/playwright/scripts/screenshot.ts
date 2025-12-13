#!/usr/bin/env npx tsx
/**
 * Standalone screenshot script
 *
 * Usage:
 *   npx tsx scripts/screenshot.ts <url> [output-path]
 *
 * Examples:
 *   npx tsx scripts/screenshot.ts https://example.com
 *   npx tsx scripts/screenshot.ts https://example.com /tmp/example.png
 *   npx tsx scripts/screenshot.ts https://example.com ./screenshots/page.png
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Parse arguments
const url = process.argv[2];
const outputPath = process.argv[3] || `/tmp/screenshot-${Date.now()}.png`;

if (!url) {
  console.error('Usage: npx tsx scripts/screenshot.ts <url> [output-path]');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx scripts/screenshot.ts https://example.com');
  console.error('  npx tsx scripts/screenshot.ts https://example.com /tmp/example.png');
  process.exit(1);
}

// Ensure URL has protocol
const fullUrl = url.startsWith('http') ? url : `https://${url}`;

// Ensure output directory exists
const dir = dirname(outputPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

async function takeScreenshot(): Promise<void> {
  const startTime = Date.now();
  console.log(`Taking screenshot of: ${fullUrl}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // Navigate to page
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Take screenshot
    await page.screenshot({
      path: outputPath,
      fullPage: true,
    });

    const duration = Date.now() - startTime;
    console.log(`Screenshot saved: ${outputPath}`);
    console.log(`Page title: ${await page.title()}`);
    console.log(`Duration: ${duration}ms`);
  } catch (error) {
    console.error('Screenshot failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

takeScreenshot().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
