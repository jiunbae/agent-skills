import { chromium } from 'playwright';

async function testJsSettings() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    } else {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  try {
    // 1. Login
    console.log('1. Logging in...');
    await page.goto('https://webtoon.<YOUR_DOMAIN>/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'mstoon2024');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // 2. Go to viewer
    console.log('2. Going to viewer...');
    await page.goto('https://webtoon.<YOUR_DOMAIN>/viewer/3024e2fe-62f0-4810-b175-44747dad8e1e');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Helper function
    const analyzeAndCapture = async (label: string, filename: string) => {
      const result = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        const visible = images.filter(img => {
          const rect = img.getBoundingClientRect();
          return rect.top < 800 && rect.bottom > 0;
        });
        return {
          total: images.length,
          visible: visible.length,
          visibleDetails: visible.map((img, i) => {
            const rect = img.getBoundingClientRect();
            return {
              index: images.indexOf(img),
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              isBlob: img.src?.startsWith('blob:')
            };
          })
        };
      });

      console.log(`\n=== ${label} ===`);
      console.log(`Total: ${result.total}, Visible: ${result.visible}`);
      result.visibleDetails.forEach((img: any) => {
        console.log(`  Img ${img.index}: (${img.left},${img.top}) ${img.width}x${img.height} blob=${img.isBlob}`);
      });

      await page.screenshot({ path: `/tmp/${filename}.png`, fullPage: false });
      return result;
    };

    await analyzeAndCapture('Initial State', 'js-1-initial');

    // 3. Get current settings from localStorage
    console.log('\n3. Reading current settings...');
    const currentSettings = await page.evaluate(() => {
      const stored = localStorage.getItem('viewer-settings');
      return stored ? JSON.parse(stored) : null;
    });
    console.log('   Current settings:', JSON.stringify(currentSettings));

    // 4. Enable doublePageSplit via localStorage and reload
    console.log('\n4. Enabling doublePageSplit...');
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('viewer-settings') || '{}');
      settings.doublePageSplit = true;
      settings.doublePageDirection = 'ltr';
      localStorage.setItem('viewer-settings', JSON.stringify(settings));
    });

    // Reload page to apply settings
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000); // Wait for split processing

    await analyzeAndCapture('After Enable Split + LTR', 'js-2-split-ltr');

    // 5. Change to RTL
    console.log('\n5. Changing to RTL...');
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('viewer-settings') || '{}');
      settings.doublePageDirection = 'rtl';
      localStorage.setItem('viewer-settings', JSON.stringify(settings));
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    await analyzeAndCapture('After RTL', 'js-3-split-rtl');

    // 6. Disable split
    console.log('\n6. Disabling split...');
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('viewer-settings') || '{}');
      settings.doublePageSplit = false;
      localStorage.setItem('viewer-settings', JSON.stringify(settings));
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await analyzeAndCapture('After Disable Split', 'js-4-no-split');

    // 7. Re-enable and check for issues
    console.log('\n7. Re-enabling split...');
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('viewer-settings') || '{}');
      settings.doublePageSplit = true;
      settings.doublePageDirection = 'ltr';
      localStorage.setItem('viewer-settings', JSON.stringify(settings));
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    await analyzeAndCapture('After Re-enable Split', 'js-5-re-enabled');

    // 8. Scroll and check
    console.log('\n8. Scrolling...');
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(2000);

    await analyzeAndCapture('After Scroll', 'js-6-scrolled');

    // 9. Check for overlapping images
    console.log('\n9. Checking for overlaps...');
    const overlapCheck = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const rects = images.map((img, i) => ({
        index: i,
        rect: img.getBoundingClientRect()
      }));

      const overlaps: string[] = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i].rect;
          const b = rects[j].rect;
          // Check if they overlap
          if (a.left < b.right && a.right > b.left &&
              a.top < b.bottom && a.bottom > b.top) {
            // Check if both are visible
            if (a.bottom > 0 && a.top < 800 && b.bottom > 0 && b.top < 800) {
              overlaps.push(`Images ${rects[i].index} and ${rects[j].index} overlap!`);
            }
          }
        }
      }
      return overlaps;
    });

    if (overlapCheck.length > 0) {
      console.log('   OVERLAPS DETECTED:');
      overlapCheck.forEach(o => console.log(`   - ${o}`));
    } else {
      console.log('   No overlaps detected');
    }

    // 10. Console errors
    console.log('\n=== Console Errors ===');
    if (consoleErrors.length > 0) {
      consoleErrors.slice(0, 10).forEach(err => console.log(`  ${err}`));
    } else {
      console.log('  No errors');
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/js-error.png' });
  } finally {
    await browser.close();
  }
}

testJsSettings();
