import { chromium } from 'playwright';

async function analyzeViewer() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    // 1. Login
    console.log('1. Navigating to login page...');
    await page.goto('https://webtoon.<YOUR_DOMAIN>/login');
    await page.waitForLoadState('networkidle');

    // Fill credentials
    await page.fill('input[type="text"], input[name="username"], input[placeholder*="아이디"]', 'admin');
    await page.fill('input[type="password"]', 'mstoon2024');

    // Click login button
    await page.click('button[type="submit"], button:has-text("로그인")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take screenshot after login
    await page.screenshot({ path: '/tmp/after-login.png', fullPage: true });
    console.log('2. Login successful, screenshot saved to /tmp/after-login.png');

    // Get current URL
    console.log('   Current URL:', page.url());

    // 3. Navigate to library and find a comic
    console.log('3. Looking for comics...');

    // Check if we're on library page or need to navigate
    if (!page.url().includes('/library')) {
      await page.goto('https://webtoon.<YOUR_DOMAIN>/library');
      await page.waitForLoadState('networkidle');
    }

    await page.screenshot({ path: '/tmp/library.png', fullPage: true });
    console.log('   Library screenshot saved');

    // Find first comic link
    const comicLinks = await page.$$('a[href*="/series/"], a[href*="/viewer/"]');
    console.log(`   Found ${comicLinks.length} comic links`);

    if (comicLinks.length > 0) {
      // Click first comic
      await comicLinks[0].click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      console.log('4. Navigated to comic, URL:', page.url());
      await page.screenshot({ path: '/tmp/comic-detail.png', fullPage: true });

      // If on series page, find viewer link
      if (page.url().includes('/series/')) {
        const viewerLinks = await page.$$('a[href*="/viewer/"]');
        if (viewerLinks.length > 0) {
          await viewerLinks[0].click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(3000);
        }
      }
    }

    // 5. Now analyze viewer page
    console.log('5. Analyzing viewer page, URL:', page.url());
    await page.screenshot({ path: '/tmp/viewer-initial.png', fullPage: true });

    // Check for images and their states
    const images = await page.$$eval('img', (imgs) => {
      return imgs.map((img, i) => ({
        index: i,
        src: img.src?.substring(0, 100),
        width: img.clientWidth,
        height: img.clientHeight,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        display: getComputedStyle(img).display,
        visibility: getComputedStyle(img).visibility,
        position: getComputedStyle(img).position,
        complete: img.complete,
        error: !img.complete && img.naturalWidth === 0
      }));
    });

    console.log('\n=== Image Analysis ===');
    console.log(`Total images found: ${images.length}`);
    images.forEach((img, i) => {
      if (i < 10) { // Show first 10
        console.log(`Image ${i}: ${img.width}x${img.height}, display: ${img.display}, complete: ${img.complete}, error: ${img.error}`);
      }
    });

    // Check for error messages
    const errorMessages = await page.$$eval('*', (elements) => {
      return elements
        .filter(el => el.textContent?.includes('불러올 수 없') || el.textContent?.includes('error'))
        .map(el => el.textContent?.trim())
        .filter(t => t && t.length < 100);
    });

    if (errorMessages.length > 0) {
      console.log('\n=== Error Messages Found ===');
      errorMessages.slice(0, 5).forEach(msg => console.log(msg));
    }

    // 6. Try to find and interact with settings panel
    console.log('\n6. Looking for settings panel...');

    // Click on page to show UI
    await page.click('body');
    await page.waitForTimeout(500);

    // Look for settings button (gear icon or settings text)
    const settingsButtons = await page.$$('button:has(svg), [class*="settings"], [class*="setting"]');
    console.log(`   Found ${settingsButtons.length} potential settings buttons`);

    // Take screenshot of current state
    await page.screenshot({ path: '/tmp/viewer-with-ui.png', fullPage: true });

    // Check page structure
    const pageStructure = await page.evaluate(() => {
      const viewer = document.querySelector('[class*="viewer"], [class*="Viewer"]');
      const virtualScroll = document.querySelector('[class*="virtual"], [class*="scroll"]');

      return {
        hasViewer: !!viewer,
        hasVirtualScroll: !!virtualScroll,
        bodyClasses: document.body.className,
        mainDivs: Array.from(document.querySelectorAll('div')).slice(0, 20).map(d => ({
          className: d.className,
          childCount: d.children.length,
          height: d.clientHeight
        }))
      };
    });

    console.log('\n=== Page Structure ===');
    console.log('Has viewer container:', pageStructure.hasViewer);
    console.log('Has virtual scroll:', pageStructure.hasVirtualScroll);

    // 7. Check console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Reload to capture console errors
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: '/tmp/viewer-reloaded.png', fullPage: true });

    if (consoleErrors.length > 0) {
      console.log('\n=== Console Errors ===');
      consoleErrors.slice(0, 10).forEach(err => console.log(err));
    }

    console.log('\n=== Analysis Complete ===');
    console.log('Screenshots saved to /tmp/');

  } catch (error) {
    console.error('Error during analysis:', error);
    await page.screenshot({ path: '/tmp/error-state.png' });
  } finally {
    await browser.close();
  }
}

analyzeViewer();
