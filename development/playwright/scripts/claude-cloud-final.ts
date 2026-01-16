import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';

const OUTPUT_DIR = '~/workspace/<GITHUB_USERNAME>.github.io/contents/posts/2025-01-04-claude-code-cloud';
const BASE_URL = 'https://claude.<YOUR_DOMAIN>';
const LOGIN_EMAIL = 'maytryark@gmail.com';
const LOGIN_PASSWORD = 'REDACTED_PASSWORD';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page: Page, name: string) {
  const outputPath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`✓ Screenshot saved: ${name}.png`);
}

async function main() {
  console.log('Launching browser...');
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });

  const page: Page = await context.newPage();

  try {
    // 1. Login
    console.log('Logging in...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await delay(1000);

    await page.fill('input[type="email"], input[name="email"], #email', LOGIN_EMAIL);
    await page.fill('input[type="password"], input[name="password"], #password', LOGIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await delay(2000);

    // 2. Dashboard screenshot
    console.log('Capturing dashboard...');
    await takeScreenshot(page, 'dashboard');

    // 3. Click on a session (using the button text pattern we found)
    console.log('Looking for session buttons...');

    // Find all buttons that might be sessions
    const sessionButton = await page.$('button:has-text("ccc-update"), button:has-text("solar"), button:has-text("poc")');

    if (sessionButton) {
      const text = await sessionButton.textContent();
      console.log(`Clicking session: ${text}`);
      await sessionButton.click();
      await page.waitForLoadState('networkidle');
      await delay(3000);

      // 4. Terminal screenshot
      console.log('Capturing terminal...');
      await takeScreenshot(page, 'terminal');

      // 5. Try to find and click Files tab
      const allTabs = await page.$$('button[role="tab"], [role="tab"], .tab');
      console.log(`Found ${allTabs.length} tabs`);

      for (const tab of allTabs) {
        const tabText = await tab.textContent();
        console.log(`Tab: ${tabText}`);
        if (tabText?.toLowerCase().includes('file')) {
          await tab.click();
          await delay(2000);
          console.log('Capturing files...');
          await takeScreenshot(page, 'files');
          break;
        }
      }

      // Check for any other tabs
      for (const tab of allTabs) {
        const tabText = await tab.textContent();
        if (tabText?.toLowerCase().includes('shell')) {
          await tab.click();
          await delay(2000);
          console.log('Capturing shell...');
          await takeScreenshot(page, 'shell');
          break;
        }
      }
    } else {
      console.log('No session button found, trying direct navigation...');

      // Look for any clickable session element
      const sessionElements = await page.$$('button, a, [role="button"]');
      for (const el of sessionElements) {
        const text = await el.textContent();
        if (text && (text.includes('ccc') || text.includes('solar') || text.includes('poc'))) {
          console.log(`Trying: ${text.slice(0, 50)}`);
          await el.click();
          await page.waitForLoadState('networkidle');
          await delay(3000);
          await takeScreenshot(page, 'terminal');
          break;
        }
      }
    }

    console.log('\n✅ All screenshots captured!');
    console.log(`📁 Output: ${OUTPUT_DIR}`);

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'error.png') });
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
