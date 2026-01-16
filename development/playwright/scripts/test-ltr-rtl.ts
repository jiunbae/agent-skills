import { chromium } from 'playwright';

async function testLtrRtl() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  // Capture console logs
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

    // 2. Go to viewer with wide images (manga)
    console.log('2. Going to viewer...');
    await page.goto('https://webtoon.<YOUR_DOMAIN>/viewer/3024e2fe-62f0-4810-b175-44747dad8e1e');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // 3. Take initial screenshot
    await page.screenshot({ path: '/tmp/ltr-rtl-1-initial.png', fullPage: false });
    console.log('   Initial state captured');

    // 4. Analyze initial image state
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
            src: img.src?.includes('blob:') ? 'blob:...' : img.src?.substring(0, 60),
            visible: rect.top < 800 && rect.bottom > 0
          };
        });
      });

      console.log(`\n=== ${label} ===`);
      console.log(`Total images: ${result.length}`);
      const visible = result.filter((img: any) => img.visible);
      console.log(`Visible images: ${visible.length}`);
      visible.forEach((img: any) => {
        console.log(`  Image ${img.index}: pos(${img.left}, ${img.top}) size(${img.width}x${img.height})`);
      });

      // Check for overlapping
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i];
          const b = visible[j];
          if (a.left === b.left && Math.abs(a.top - b.top) < 50) {
            console.log(`  WARNING: Images ${a.index} and ${b.index} may be overlapping!`);
          }
        }
      }

      return result;
    };

    await analyzeImages('Initial State');

    // 5. Find and click "이미지 분할" toggle
    console.log('\n3. Looking for image split toggle...');

    // The settings panel should be visible, find the toggle
    const toggles = await page.$$('button[role="switch"], input[type="checkbox"], [class*="toggle"]');
    console.log(`   Found ${toggles.length} toggle elements`);

    // Find the toggle near "이미지 분할" text
    const splitToggle = await page.$('button[role="switch"]');

    if (splitToggle) {
      const isChecked = await splitToggle.getAttribute('aria-checked');
      console.log(`   Split toggle state: ${isChecked}`);

      // Click to enable split
      if (isChecked !== 'true') {
        console.log('   Enabling image split...');
        await splitToggle.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: '/tmp/ltr-rtl-2-split-enabled.png', fullPage: false });
        await analyzeImages('After Enabling Split');
      }
    }

    // 6. Test LTR button
    console.log('\n4. Testing LTR button...');
    const ltrButton = await page.$('button:has-text("LTR")');
    if (ltrButton) {
      await ltrButton.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/ltr-rtl-3-ltr.png', fullPage: false });
      await analyzeImages('After LTR Click');
    }

    // 7. Test RTL button
    console.log('\n5. Testing RTL button...');
    const rtlButton = await page.$('button:has-text("RTL")');
    if (rtlButton) {
      await rtlButton.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/ltr-rtl-4-rtl.png', fullPage: false });
      await analyzeImages('After RTL Click');
    }

    // 8. Toggle split off and on again
    console.log('\n6. Toggling split off and on...');
    if (splitToggle) {
      // Turn off
      await splitToggle.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/ltr-rtl-5-split-off.png', fullPage: false });
      await analyzeImages('After Split OFF');

      // Turn on again
      await splitToggle.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/ltr-rtl-6-split-on-again.png', fullPage: false });
      await analyzeImages('After Split ON again');
    }

    // 9. Check for any console errors
    console.log('\n=== Console Errors ===');
    if (consoleErrors.length > 0) {
      consoleErrors.forEach(err => console.log(`  ${err}`));
    } else {
      console.log('  No console errors');
    }

    // 10. Final DOM analysis
    console.log('\n=== Final DOM Analysis ===');
    const finalAnalysis = await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('div')).filter(div => {
        const style = getComputedStyle(div);
        return style.position === 'absolute' && div.querySelector('img');
      });

      return containers.map(c => ({
        className: c.className?.substring(0, 40),
        transform: getComputedStyle(c).transform,
        top: getComputedStyle(c).top,
        children: c.children.length
      }));
    });

    console.log(`Absolute containers with images: ${finalAnalysis.length}`);
    finalAnalysis.slice(0, 5).forEach((c: any, i: number) => {
      console.log(`  Container ${i}: transform=${c.transform}, top=${c.top}`);
    });

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/ltr-rtl-error.png' });
  } finally {
    await browser.close();
  }
}

testLtrRtl();
