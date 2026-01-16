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

async function takeScreenshot(page: Page, name: string, fullPage: boolean = false) {
  const outputPath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: outputPath, fullPage });
  console.log(`✓ Screenshot saved: ${name}.png`);
  return outputPath;
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

    // 2. Check page structure
    console.log('Analyzing page structure...');
    const html = await page.content();

    // Find all links to sessions
    const sessionLinks = await page.$$eval('a[href*="/session/"]', els =>
      els.map(el => ({ href: el.getAttribute('href'), text: el.textContent?.trim() }))
    );
    console.log('Session links found:', sessionLinks);

    // Find any buttons or cards
    const buttons = await page.$$eval('button', els =>
      els.slice(0, 10).map(el => el.textContent?.trim())
    );
    console.log('Buttons:', buttons);

    // Try to find session elements with different selectors
    const possibleSessions = await page.$$('a[href*="session"], [class*="Session"], [class*="session"], tr, .card, article');
    console.log(`Found ${possibleSessions.length} possible session elements`);

    if (sessionLinks.length > 0) {
      // Click first session link
      const firstSessionHref = sessionLinks[0].href;
      console.log(`Navigating to session: ${firstSessionHref}`);
      await page.goto(`${BASE_URL}${firstSessionHref}`, { waitUntil: 'networkidle' });
      await delay(3000);

      await takeScreenshot(page, 'terminal');

      // Try clicking on Files tab
      const filesTab = await page.$('button:has-text("Files"), [role="tab"]:has-text("Files"), text=Files');
      if (filesTab) {
        console.log('Found Files tab, clicking...');
        await filesTab.click();
        await delay(2000);
        await takeScreenshot(page, 'files');
      }
    } else {
      console.log('No sessions found. Creating a new session...');

      // Try to find "New Session" button
      const newSessionBtn = await page.$('button:has-text("New"), button:has-text("Create"), button:has-text("Add")');
      if (newSessionBtn) {
        console.log('Found new session button');
        const btnText = await newSessionBtn.textContent();
        console.log('Button text:', btnText);
      }

      // Take current state screenshot
      await takeScreenshot(page, 'current-state');
    }

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'error-debug.png') });
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
