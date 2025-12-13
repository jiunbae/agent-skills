#!/usr/bin/env npx tsx
/**
 * Standalone web scraping script
 *
 * Usage:
 *   npx tsx scripts/scrape.ts <url> <selector> [--json] [--attr <attribute>]
 *
 * Examples:
 *   npx tsx scripts/scrape.ts https://example.com h1
 *   npx tsx scripts/scrape.ts https://news.ycombinator.com ".titleline a" --json
 *   npx tsx scripts/scrape.ts https://example.com "a" --attr href --json
 */

import { chromium } from 'playwright';

// Parse arguments
const args = process.argv.slice(2);
const url = args[0];
const selector = args[1];
const outputJson = args.includes('--json');
const attrIndex = args.indexOf('--attr');
const attribute = attrIndex !== -1 ? args[attrIndex + 1] : undefined;

if (!url || !selector) {
  console.error('Usage: npx tsx scripts/scrape.ts <url> <selector> [--json] [--attr <attribute>]');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx scripts/scrape.ts https://example.com h1');
  console.error('  npx tsx scripts/scrape.ts https://news.ycombinator.com ".titleline a" --json');
  console.error('  npx tsx scripts/scrape.ts https://example.com "a" --attr href --json');
  process.exit(1);
}

// Ensure URL has protocol
const fullUrl = url.startsWith('http') ? url : `https://${url}`;

interface ScrapeResult {
  url: string;
  selector: string;
  attribute: string;
  count: number;
  data: string[];
  timestamp: string;
}

async function scrapeData(): Promise<void> {
  const startTime = Date.now();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // Navigate to page
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for selector
    await page.locator(selector).first().waitFor({ state: 'attached', timeout: 10000 });

    // Extract data
    const locators = page.locator(selector);
    const count = await locators.count();

    let data: string[];
    if (attribute) {
      data = await locators.evaluateAll(
        (elements, attr) => elements.map(el => el.getAttribute(attr) || '').filter(Boolean),
        attribute
      );
    } else {
      data = await locators.allTextContents();
      data = data.map(s => s.trim()).filter(s => s.length > 0);
    }

    const duration = Date.now() - startTime;

    if (outputJson) {
      const result: ScrapeResult = {
        url: fullUrl,
        selector,
        attribute: attribute || 'textContent',
        count: data.length,
        data,
        timestamp: new Date().toISOString(),
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Scraped ${data.length} items from ${fullUrl}`);
      console.log(`Selector: ${selector}`);
      console.log(`Attribute: ${attribute || 'textContent'}`);
      console.log(`Duration: ${duration}ms`);
      console.log('---');
      for (const item of data) {
        console.log(item);
      }
    }
  } catch (error) {
    console.error('Scraping failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

scrapeData().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
