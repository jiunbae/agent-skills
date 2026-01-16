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

    // 2. Click on a session
    console.log('Looking for session...');
    const sessionButton = await page.$('button:has-text("ccc-update"), button:has-text("solar"), button:has-text("poc")');

    if (sessionButton) {
      const text = await sessionButton.textContent();
      console.log(`Clicking session: ${text}`);
      await sessionButton.click();
      await page.waitForLoadState('networkidle');
      await delay(2000);

      // 3. Click "Start Claude" button
      console.log('Looking for Start Claude button...');
      const startButton = await page.$('button:has-text("Start Claude"), button:has-text("Start")');

      if (startButton) {
        console.log('Clicking Start Claude...');
        await startButton.click();

        // 4. Wait 10 seconds for session to load
        console.log('Waiting 10 seconds for session to start...');
        await delay(10000);

        // 5. Take screenshot
        console.log('Capturing running terminal...');
        await takeScreenshot(page, 'terminal');

        // 6. Try Files tab
        const filesTab = await page.$('button:has-text("Files"), [role="tab"]:has-text("Files")');
        if (filesTab) {
          console.log('Clicking Files tab...');
          await filesTab.click();
          await delay(2000);
          await takeScreenshot(page, 'files');
        }
      } else {
        console.log('Start button not found, session might be already running');
        await delay(3000);
        await takeScreenshot(page, 'terminal');
      }
    }

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'error.png') });
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
