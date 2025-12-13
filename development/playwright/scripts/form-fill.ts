#!/usr/bin/env npx tsx
/**
 * Form Fill Template
 *
 * Template for automating form filling with Playwright.
 * Modify the FORM_CONFIG and FORM_DATA sections for your use case.
 *
 * Usage:
 *   npx tsx scripts/form-fill.ts [--headed] [--no-submit]
 *
 * Options:
 *   --headed     Run with visible browser
 *   --no-submit  Don't submit the form (for testing)
 */

import { chromium, type Page } from 'playwright';

// Parse arguments
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const noSubmit = args.includes('--no-submit');

// ============================================================
// Configuration - Modify for your form
// ============================================================

const FORM_CONFIG = {
  url: 'https://example.com/contact',
  waitUntil: 'networkidle' as const,
  timeout: 30000,
};

// Form field definitions
// Modify this section for your specific form
const FORM_DATA: Array<{
  type: 'fill' | 'select' | 'check' | 'upload';
  selector: string;
  value: string;
  description?: string;
}> = [
  // Text inputs
  { type: 'fill', selector: '#name', value: 'John Doe', description: 'Full Name' },
  { type: 'fill', selector: '#email', value: 'john@example.com', description: 'Email' },
  { type: 'fill', selector: '#phone', value: '+1-234-567-8900', description: 'Phone' },

  // Textarea
  { type: 'fill', selector: '#message', value: 'Hello, this is a test message.', description: 'Message' },

  // Select dropdown
  { type: 'select', selector: '#country', value: 'US', description: 'Country' },

  // Checkbox
  { type: 'check', selector: '#agree', value: '', description: 'Terms Agreement' },

  // File upload (uncomment if needed)
  // { type: 'upload', selector: '#file', value: '/path/to/file.pdf', description: 'Upload File' },
];

// Submit button selector
const SUBMIT_SELECTOR = 'button[type="submit"]';

// Success indicator (element that appears after successful submission)
const SUCCESS_SELECTOR = '.success-message';

// ============================================================
// Form Fill Logic
// ============================================================

async function fillForm(page: Page): Promise<void> {
  console.log('Starting form fill...\n');

  for (const field of FORM_DATA) {
    const desc = field.description || field.selector;
    console.log(`Filling: ${desc}`);

    try {
      switch (field.type) {
        case 'fill':
          await page.fill(field.selector, field.value);
          break;

        case 'select':
          await page.selectOption(field.selector, field.value);
          break;

        case 'check':
          await page.check(field.selector);
          break;

        case 'upload':
          await page.setInputFiles(field.selector, field.value);
          break;
      }
      console.log(`  ✓ Done`);
    } catch (error) {
      console.log(`  ✗ Failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }
}

async function submitForm(page: Page): Promise<boolean> {
  if (noSubmit) {
    console.log('\nSkipping form submission (--no-submit flag)');
    return true;
  }

  console.log('\nSubmitting form...');

  try {
    // Click submit button
    await page.click(SUBMIT_SELECTOR);

    // Wait for success indicator or navigation
    try {
      await page.waitForSelector(SUCCESS_SELECTOR, { timeout: 10000 });
      console.log('✓ Success indicator found');
      return true;
    } catch {
      // Check if page navigated
      const currentUrl = page.url();
      if (currentUrl !== FORM_CONFIG.url) {
        console.log(`✓ Page navigated to: ${currentUrl}`);
        return true;
      }

      // Check for error messages
      const errorMessages = await page.locator('.error, .alert-danger, [role="alert"]').allTextContents();
      if (errorMessages.length > 0) {
        console.log('✗ Form errors found:');
        for (const msg of errorMessages) {
          console.log(`  - ${msg.trim()}`);
        }
        return false;
      }

      console.log('? Unknown submission result');
      return false;
    }
  } catch (error) {
    console.log(`✗ Submit failed: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log(`Form Fill Automation`);
  console.log(`URL: ${FORM_CONFIG.url}`);
  console.log(`Headless: ${!headed}`);
  console.log('-----------------------------------\n');

  const browser = await chromium.launch({
    headless: !headed,
    slowMo: headed ? 100 : 0,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(FORM_CONFIG.timeout);

  try {
    // Navigate to form
    console.log('Navigating to form page...');
    await page.goto(FORM_CONFIG.url, { waitUntil: FORM_CONFIG.waitUntil });
    console.log('✓ Page loaded\n');

    // Fill form
    await fillForm(page);

    // Take screenshot before submit
    const screenshotPath = `/tmp/form-filled-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nScreenshot saved: ${screenshotPath}`);

    // Submit form
    const success = await submitForm(page);

    // Take screenshot after submit
    if (!noSubmit) {
      const afterScreenshot = `/tmp/form-submitted-${Date.now()}.png`;
      await page.screenshot({ path: afterScreenshot, fullPage: true });
      console.log(`After-submit screenshot: ${afterScreenshot}`);
    }

    if (success) {
      console.log('\n✓ Form fill completed successfully');
    } else {
      console.log('\n✗ Form fill completed with errors');
      process.exit(1);
    }
  } catch (error) {
    console.error('\nFatal error:', error instanceof Error ? error.message : error);

    // Save error screenshot
    try {
      const errorScreenshot = `/tmp/form-error-${Date.now()}.png`;
      await page.screenshot({ path: errorScreenshot, fullPage: true });
      console.log(`Error screenshot: ${errorScreenshot}`);
    } catch {
      // Ignore screenshot errors
    }

    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
