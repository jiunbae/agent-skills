import { chromium } from 'playwright';

async function testRealtime() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
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

    // 2. Go to viewer (reset settings first)
    console.log('2. Resetting settings and going to viewer...');
    await page.evaluate(() => {
      localStorage.setItem('viewer-settings', JSON.stringify({
        readingMode: 'scroll',
        doublePageSplit: false,
        doublePageDirection: 'ltr',
        imageWidth: 'full',
        customWidth: 800
      }));
    });

    await page.goto('https://webtoon.<YOUR_DOMAIN>/viewer/3024e2fe-62f0-4810-b175-44747dad8e1e');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Helper function
    const analyzeAndCapture = async (label: string, filename: string) => {
      await page.waitForTimeout(500);
      const result = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        const containers = Array.from(document.querySelectorAll('div')).filter(d => {
          const style = getComputedStyle(d);
          return style.position === 'absolute' && d.querySelector('img');
        });

        return {
          totalImages: images.length,
          containers: containers.length,
          visibleImages: images.filter(img => {
            const rect = img.getBoundingClientRect();
            return rect.top < 800 && rect.bottom > 0;
          }).map((img, i) => {
            const rect = img.getBoundingClientRect();
            return {
              top: Math.round(rect.top),
              height: Math.round(rect.height),
              width: Math.round(rect.width),
              isBlob: img.src?.startsWith('blob:')
            };
          })
        };
      });

      console.log(`\n=== ${label} ===`);
      console.log(`Images: ${result.totalImages}, Containers: ${result.containers}`);
      console.log(`Visible:`);
      result.visibleImages.forEach((img: any, i: number) => {
        console.log(`  ${i}: top=${img.top} h=${img.height} w=${img.width} blob=${img.isBlob}`);
      });

      await page.screenshot({ path: `/tmp/${filename}.png`, fullPage: false });
      return result;
    };

    await analyzeAndCapture('Initial (no split)', 'rt-1-initial');

    // 3. Use JavaScript to simulate clicking the toggle (trigger React state change)
    console.log('\n3. Simulating toggle click via dispatchEvent...');

    // Find and click the toggle button using force: true
    await page.evaluate(() => {
      // Find the toggle button (rounded-full with w-12)
      const toggles = document.querySelectorAll('button');
      for (const btn of toggles) {
        if (btn.className.includes('rounded-full') && btn.className.includes('w-12')) {
          btn.click();
          console.log('Toggle clicked!');
          break;
        }
      }
    });

    await page.waitForTimeout(3000);
    await analyzeAndCapture('After toggle (split enabled)', 'rt-2-split-on');

    // 4. Click LTR button
    console.log('\n4. Clicking LTR...');
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent === 'LTR') {
          btn.click();
          console.log('LTR clicked!');
          break;
        }
      }
    });

    await page.waitForTimeout(2000);
    await analyzeAndCapture('After LTR', 'rt-3-ltr');

    // 5. Click RTL button
    console.log('\n5. Clicking RTL...');
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent === 'RTL') {
          btn.click();
          console.log('RTL clicked!');
          break;
        }
      }
    });

    await page.waitForTimeout(2000);
    await analyzeAndCapture('After RTL', 'rt-4-rtl');

    // 6. Toggle off
    console.log('\n6. Toggling split off...');
    await page.evaluate(() => {
      const toggles = document.querySelectorAll('button');
      for (const btn of toggles) {
        if (btn.className.includes('rounded-full') && btn.className.includes('w-12')) {
          btn.click();
          break;
        }
      }
    });

    await page.waitForTimeout(2000);
    await analyzeAndCapture('After toggle off', 'rt-5-split-off');

    // 7. Toggle on again
    console.log('\n7. Toggling split on again...');
    await page.evaluate(() => {
      const toggles = document.querySelectorAll('button');
      for (const btn of toggles) {
        if (btn.className.includes('rounded-full') && btn.className.includes('w-12')) {
          btn.click();
          break;
        }
      }
    });

    await page.waitForTimeout(3000);
    await analyzeAndCapture('After toggle on again', 'rt-6-split-on-again');

    // 8. Rapid toggling test
    console.log('\n8. Rapid toggle test...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const toggles = document.querySelectorAll('button');
        for (const btn of toggles) {
          if (btn.className.includes('rounded-full') && btn.className.includes('w-12')) {
            btn.click();
            break;
          }
        }
      });
      await page.waitForTimeout(500);
    }

    await page.waitForTimeout(3000);
    await analyzeAndCapture('After rapid toggle', 'rt-7-rapid');

    // 9. Check for overlaps
    console.log('\n9. Final overlap check...');
    const overlaps = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const results: string[] = [];

      for (let i = 0; i < images.length; i++) {
        for (let j = i + 1; j < images.length; j++) {
          const a = images[i].getBoundingClientRect();
          const b = images[j].getBoundingClientRect();

          // Check if visible
          if ((a.top >= 800 || a.bottom <= 0) && (b.top >= 800 || b.bottom <= 0)) continue;

          // Check overlap
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
            results.push(`Img ${i} (${Math.round(a.top)}-${Math.round(a.bottom)}) overlaps Img ${j} (${Math.round(b.top)}-${Math.round(b.bottom)})`);
          }
        }
      }
      return results;
    });

    if (overlaps.length > 0) {
      console.log('OVERLAPS FOUND:');
      overlaps.forEach(o => console.log(`  ${o}`));
    } else {
      console.log('No overlaps');
    }

    // 10. Console errors
    console.log('\n=== Console Errors ===');
    if (consoleErrors.length > 0) {
      consoleErrors.forEach(err => console.log(`  ${err}`));
    } else {
      console.log('  None');
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/rt-error.png' });
  } finally {
    await browser.close();
  }
}

testRealtime();
