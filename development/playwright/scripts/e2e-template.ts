#!/usr/bin/env npx tsx
/**
 * E2E Test Template
 *
 * This is a template for creating E2E tests with Playwright.
 * Copy and modify this file for your specific test scenarios.
 *
 * Usage:
 *   npx tsx scripts/e2e-template.ts [--headed] [--slow]
 *
 * Options:
 *   --headed  Run with visible browser
 *   --slow    Add delay between actions for debugging
 */

import { chromium, type Page, type Browser } from 'playwright';

// Parse arguments
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const slow = args.includes('--slow');

// Test configuration - modify as needed
const CONFIG = {
  baseUrl: 'https://example.com',
  timeout: 30000,
  slowMo: slow ? 500 : 0,
};

// Test result types
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  screenshot?: string;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  totalDuration: number;
  passed: number;
  failed: number;
}

// Test case definition
interface TestCase {
  name: string;
  fn: (page: Page) => Promise<void>;
}

// ============================================================
// Test Cases - Modify these for your specific scenarios
// ============================================================

async function testHomepage(page: Page): Promise<void> {
  await page.goto(CONFIG.baseUrl);
  await page.waitForSelector('h1');

  const title = await page.title();
  if (!title) {
    throw new Error('Page title is empty');
  }
}

async function testNavigation(page: Page): Promise<void> {
  await page.goto(CONFIG.baseUrl);

  // Example: Check for navigation links
  const links = page.locator('nav a, header a');
  const count = await links.count();

  if (count === 0) {
    throw new Error('No navigation links found');
  }
}

async function testResponsive(page: Page): Promise<void> {
  // Test mobile viewport
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(CONFIG.baseUrl);
  await page.waitForLoadState('networkidle');

  // Check that page is still functional
  const body = page.locator('body');
  const isVisible = await body.isVisible();

  if (!isVisible) {
    throw new Error('Page body not visible on mobile viewport');
  }
}

// Add more test cases here...
// async function testLogin(page: Page): Promise<void> {
//   await page.goto(`${CONFIG.baseUrl}/login`);
//   await page.fill('#email', 'test@example.com');
//   await page.fill('#password', 'password123');
//   await page.click('button[type="submit"]');
//   await page.waitForURL('**/dashboard');
// }

// ============================================================
// Test Runner - Usually no need to modify below this line
// ============================================================

const testCases: TestCase[] = [
  { name: 'Homepage loads correctly', fn: testHomepage },
  { name: 'Navigation links present', fn: testNavigation },
  { name: 'Responsive design works', fn: testResponsive },
  // Add your test cases here:
  // { name: 'Login works', fn: testLogin },
];

async function runTests(): Promise<TestSuite> {
  const suiteStartTime = Date.now();
  const results: TestResult[] = [];

  const browser = await chromium.launch({
    headless: !headed,
    slowMo: CONFIG.slowMo,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  console.log('Running E2E tests...\n');

  for (const testCase of testCases) {
    const page = await context.newPage();
    page.setDefaultTimeout(CONFIG.timeout);

    const testStartTime = Date.now();
    let screenshotPath: string | undefined;

    try {
      await testCase.fn(page);
      const duration = Date.now() - testStartTime;

      results.push({
        name: testCase.name,
        passed: true,
        duration,
      });

      console.log(`✓ ${testCase.name} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - testStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Take screenshot on failure
      screenshotPath = `/tmp/test-failure-${Date.now()}.png`;
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        screenshotPath = undefined;
      }

      results.push({
        name: testCase.name,
        passed: false,
        duration,
        error: errorMessage,
        screenshot: screenshotPath,
      });

      console.log(`✗ ${testCase.name} (${duration}ms)`);
      console.log(`  Error: ${errorMessage}`);
      if (screenshotPath) {
        console.log(`  Screenshot: ${screenshotPath}`);
      }
    }

    await page.close();
  }

  await browser.close();

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = Date.now() - suiteStartTime;

  return {
    name: 'E2E Test Suite',
    results,
    totalDuration,
    passed,
    failed,
  };
}

// Run tests
runTests()
  .then((suite) => {
    console.log('\n-----------------------------------');
    console.log(`Results: ${suite.passed}/${suite.results.length} passed`);
    console.log(`Duration: ${suite.totalDuration}ms`);

    if (suite.failed > 0) {
      console.log(`\nFailed tests:`);
      for (const result of suite.results) {
        if (!result.passed) {
          console.log(`  - ${result.name}: ${result.error}`);
        }
      }
      process.exit(1);
    }

    console.log('\nAll tests passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
