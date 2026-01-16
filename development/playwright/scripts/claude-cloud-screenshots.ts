import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const OUTPUT_DIR = '~/workspace/<GITHUB_USERNAME>.github.io/contents/posts/2025-01-04-claude-code-cloud';
const BASE_URL = 'https://claude.<YOUR_DOMAIN>';
const LOGIN_EMAIL = 'maytryark@gmail.com';
const LOGIN_PASSWORD = 'REDACTED_PASSWORD';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page: Page, name: string, fullPage: boolean = true) {
  const outputPath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: outputPath, fullPage });
  console.log(`✓ Screenshot saved: ${name}.png`);
  return outputPath;
}

async function main() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Launching browser...');
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2, // Retina quality
  });

  const page: Page = await context.newPage();

  try {
    // 1. Navigate to login page
    console.log('Navigating to login page...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await delay(1000);

    // Take login page screenshot
    await takeScreenshot(page, 'login', false);

    // 2. Fill login form
    console.log('Logging in...');
    await page.fill('input[type="email"], input[name="email"], #email', LOGIN_EMAIL);
    await page.fill('input[type="password"], input[name="password"], #password', LOGIN_PASSWORD);

    // Click login button
    await page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("로그인")');

    // Wait for navigation
    await page.waitForLoadState('networkidle');
    await delay(2000);

    // 3. Dashboard screenshot
    console.log('Capturing dashboard...');
    await takeScreenshot(page, 'dashboard', false);

    // 4. Find and click on a session if available
    const sessionCards = await page.$$('[data-testid="session-card"], .session-card, [class*="session"]');
    console.log(`Found ${sessionCards.length} session cards`);

    if (sessionCards.length > 0) {
      // Click first session to view details
      await sessionCards[0].click();
      await page.waitForLoadState('networkidle');
      await delay(2000);

      // 5. Session detail / Terminal screenshot
      console.log('Capturing session detail...');
      await takeScreenshot(page, 'terminal', false);

      // 6. Try to find file explorer tab
      const fileTab = await page.$('button:has-text("Files"), [data-tab="files"], .file-tab');
      if (fileTab) {
        await fileTab.click();
        await delay(1500);
        console.log('Capturing file explorer...');
        await takeScreenshot(page, 'files', false);
      }

      // 7. Try to find shell tab
      const shellTab = await page.$('button:has-text("Shell"), [data-tab="shell"]');
      if (shellTab) {
        await shellTab.click();
        await delay(1500);
        console.log('Capturing shell...');
        await takeScreenshot(page, 'shell', false);
      }
    }

    // 8. Go back to home and capture session list
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await delay(1500);
    console.log('Capturing session list...');
    await takeScreenshot(page, 'sessions', false);

    console.log('\n✅ All screenshots captured successfully!');
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);

  } catch (error) {
    console.error('Error:', error);
    // Take error screenshot for debugging
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'error-debug.png') });
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
