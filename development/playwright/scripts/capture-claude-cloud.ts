import { chromium } from 'playwright';

const BASE_URL = 'https://claude.<YOUR_DOMAIN>';
const EMAIL = 'maytryark@gmail.com';
const PASSWORD = 'REDACTED_PASSWORD';
const OUTPUT_DIR = '~/workspace/claude-code-cloud/public/screenshots';
const SESSION_NAME = 'ccc-usage-share';

async function main() {
  console.log('Starting browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    // 1. Go to login page
    console.log('Navigating to login page...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 2. Login
    console.log('Logging in...');
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', EMAIL);
    await page.fill('input[type="password"], input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
    await page.waitForTimeout(2000);

    // 3. Capture Dashboard
    console.log('Capturing dashboard...');
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${OUTPUT_DIR}/dashboard.png`,
      fullPage: false
    });
    console.log(`Saved: ${OUTPUT_DIR}/dashboard.png`);

    // 4. Click on the ccc-usage-share session
    console.log(`Looking for session: ${SESSION_NAME}...`);
    const sessionElement = await page.$(`text=${SESSION_NAME}`);

    if (sessionElement) {
      console.log('Found session, clicking...');
      await sessionElement.click();

      // Wait for session page to load
      console.log('Waiting for session page to load...');
      await page.waitForTimeout(3000);

      // Wait for "Connected" status to appear (indicates WebSocket is ready)
      console.log('Waiting for Claude to connect...');
      try {
        await page.waitForSelector('text=Connected', { timeout: 15000 });
        console.log('Claude connected!');
      } catch {
        console.log('Connection status not found, continuing...');
      }

      // Now wait 10 seconds for terminal content to fully load
      console.log('Waiting 10 seconds for terminal content to load...');
      await page.waitForTimeout(10000);

      // 5. Capture Terminal view (Claude tab)
      console.log('Capturing terminal view...');
      await page.screenshot({
        path: `${OUTPUT_DIR}/terminal.png`,
        fullPage: false
      });
      console.log(`Saved: ${OUTPUT_DIR}/terminal.png`);

      // 6. Click on Files tab
      console.log('Looking for Files tab...');
      const filesTab = await page.$('button:has-text("Files")');

      if (filesTab) {
        console.log('Clicking Files tab...');
        await filesTab.click();
        await page.waitForTimeout(3000); // Wait for file tree to load

        // Capture File Explorer
        console.log('Capturing file explorer...');
        await page.screenshot({
          path: `${OUTPUT_DIR}/files.png`,
          fullPage: false
        });
        console.log(`Saved: ${OUTPUT_DIR}/files.png`);
      } else {
        console.log('Files tab not found');
      }
    } else {
      console.log(`Session "${SESSION_NAME}" not found, taking debug screenshot...`);
      await page.screenshot({ path: `${OUTPUT_DIR}/debug-session-not-found.png` });
    }

    console.log('Screenshot capture completed!');

  } catch (error) {
    console.error('Error during capture:', error);
    // Take a debug screenshot
    await page.screenshot({ path: `${OUTPUT_DIR}/debug-error.png` });
    console.log('Debug screenshot saved.');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
