import { chromium } from 'playwright';

async function testSplitToggle() {
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

    // 2. Go to viewer
    console.log('2. Going to viewer...');
    await page.goto('https://webtoon.<YOUR_DOMAIN>/viewer/3024e2fe-62f0-4810-b175-44747dad8e1e');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Helper to analyze images
    const analyzeImages = async (label: string) => {
      const result = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        return images.map((img, i) => {
          const rect = img.getBoundingClientRect();
          return {
            index: i,
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            isBlob: img.src?.startsWith('blob:'),
            visible: rect.top < 800 && rect.bottom > 0 && rect.left < 1280 && rect.right > 0
          };
        });
      });

      console.log(`\n=== ${label} ===`);
      console.log(`Total images: ${result.length}`);
      const visible = result.filter((img: any) => img.visible);
      console.log(`Visible images: ${visible.length}`);
      visible.forEach((img: any) => {
        console.log(`  Image ${img.index}: pos(${img.left}, ${img.top}) size(${img.width}x${img.height}) blob=${img.isBlob}`);
      });

      return result;
    };

    await analyzeImages('Initial State');
    await page.screenshot({ path: '/tmp/split-1-initial.png', fullPage: false });

    // 3. Find settings panel toggle button (gear icon)
    console.log('\n3. Opening settings panel...');
    const gearButton = await page.$('button[aria-label="뷰어 설정 열기"]');
    if (!gearButton) {
      console.log('   Settings button not found!');
      return;
    }
    // Panel might already be open, check
    const panelVisible = await page.$('text=이미지 분할');
    if (!panelVisible) {
      await gearButton.click();
      await page.waitForTimeout(500);
    }
    console.log('   Settings panel opened');

    // 4. Find image split toggle (rounded-full button)
    console.log('\n4. Looking for image split toggle...');

    // The toggle is a button with w-12 h-7 rounded-full
    const splitToggle = await page.$('button.rounded-full.w-12');
    if (!splitToggle) {
      // Try alternative selector
      const allButtons = await page.$$('button');
      console.log(`   Found ${allButtons.length} buttons total`);

      // Find by class pattern
      for (const btn of allButtons) {
        const className = await btn.getAttribute('class');
        if (className?.includes('rounded-full') && className?.includes('w-12')) {
          console.log('   Found toggle button by class!');

          // Click to enable split
          await btn.click();
          await page.waitForTimeout(3000);
          await page.screenshot({ path: '/tmp/split-2-after-toggle.png', fullPage: false });
          await analyzeImages('After Enabling Split');

          break;
        }
      }
    } else {
      await splitToggle.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/split-2-after-toggle.png', fullPage: false });
      await analyzeImages('After Enabling Split');
    }

    // 5. Now try LTR/RTL buttons (they should be enabled now)
    console.log('\n5. Testing LTR button...');
    const ltrButton = await page.$('button:has-text("LTR"):not([disabled])');
    if (ltrButton) {
      const isDisabled = await ltrButton.isDisabled();
      console.log(`   LTR button disabled: ${isDisabled}`);
      if (!isDisabled) {
        await ltrButton.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: '/tmp/split-3-ltr.png', fullPage: false });
        await analyzeImages('After LTR');
      }
    } else {
      console.log('   LTR button not found or disabled');
    }

    console.log('\n6. Testing RTL button...');
    const rtlButton = await page.$('button:has-text("RTL"):not([disabled])');
    if (rtlButton) {
      const isDisabled = await rtlButton.isDisabled();
      console.log(`   RTL button disabled: ${isDisabled}`);
      if (!isDisabled) {
        await rtlButton.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: '/tmp/split-4-rtl.png', fullPage: false });
        await analyzeImages('After RTL');
      }
    } else {
      console.log('   RTL button not found or disabled');
    }

    // 7. Scroll test
    console.log('\n7. Testing scroll...');
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/split-5-scrolled.png', fullPage: false });
    await analyzeImages('After Scroll');

    // 8. Console errors
    console.log('\n=== Console Errors ===');
    if (consoleErrors.length > 0) {
      consoleErrors.forEach(err => console.log(`  ${err}`));
    } else {
      console.log('  No console errors');
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/split-error.png' });
  } finally {
    await browser.close();
  }
}

testSplitToggle();
