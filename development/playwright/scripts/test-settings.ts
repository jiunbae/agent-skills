import { chromium } from 'playwright';

async function testSettings() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[CONSOLE ERROR]', msg.text());
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

    // 2. Go directly to viewer
    console.log('2. Going to viewer...');
    await page.goto('https://webtoon.<YOUR_DOMAIN>/viewer/3024e2fe-62f0-4810-b175-44747dad8e1e');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: '/tmp/test-viewer-initial.png', fullPage: true });
    console.log('   Initial viewer screenshot saved');

    // 3. Analyze DOM structure
    console.log('\n3. Analyzing DOM structure...');
    const domInfo = await page.evaluate(() => {
      const result: any = {
        images: [],
        containers: [],
        settingsPanel: null
      };

      // Find all images
      document.querySelectorAll('img').forEach((img, i) => {
        const rect = img.getBoundingClientRect();
        const style = getComputedStyle(img);
        result.images.push({
          index: i,
          src: img.src?.substring(0, 80),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          display: style.display,
          position: style.position,
          transform: style.transform,
          visibility: style.visibility,
          opacity: style.opacity
        });
      });

      // Find containers with absolute positioning (potential overlap issues)
      document.querySelectorAll('div').forEach((div, i) => {
        const style = getComputedStyle(div);
        if (style.position === 'absolute' && div.children.length > 0) {
          result.containers.push({
            className: div.className?.substring(0, 50),
            position: style.position,
            transform: style.transform,
            top: style.top,
            left: style.left,
            childCount: div.children.length
          });
        }
      });

      // Check for settings panel
      const settingsPanel = document.querySelector('[class*="settings"], [class*="Settings"], [class*="panel"], [class*="Panel"]');
      if (settingsPanel) {
        result.settingsPanel = {
          className: settingsPanel.className,
          visible: getComputedStyle(settingsPanel).display !== 'none'
        };
      }

      return result;
    });

    console.log(`   Found ${domInfo.images.length} images`);
    domInfo.images.forEach((img: any, i: number) => {
      console.log(`   Image ${i}: top=${img.rect.top.toFixed(0)}, height=${img.rect.height.toFixed(0)}, display=${img.display}`);
    });

    console.log(`\n   Found ${domInfo.containers.length} absolute positioned containers`);

    // 4. Look for settings controls
    console.log('\n4. Looking for settings controls...');

    // Click on screen to toggle UI
    await page.click('body', { position: { x: 640, y: 400 } });
    await page.waitForTimeout(500);

    await page.screenshot({ path: '/tmp/test-viewer-clicked.png', fullPage: true });

    // Find settings-related elements
    const settingsElements = await page.evaluate(() => {
      const elements: any[] = [];

      // Look for text content related to settings
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.includes('LTR') || text.includes('RTL') ||
            text.includes('분할') || text.includes('자르기') ||
            text.includes('설정') || text.includes('방향')) {
          elements.push({
            tag: el.tagName,
            text: text.substring(0, 50),
            className: (el as HTMLElement).className?.substring(0, 30)
          });
        }
      });

      // Look for toggle/switch elements
      document.querySelectorAll('input[type="checkbox"], button, [role="switch"]').forEach(el => {
        elements.push({
          tag: el.tagName,
          type: (el as HTMLInputElement).type,
          className: (el as HTMLElement).className?.substring(0, 30),
          checked: (el as HTMLInputElement).checked
        });
      });

      return elements;
    });

    console.log('   Settings-related elements:');
    settingsElements.slice(0, 20).forEach((el: any) => {
      console.log(`   - ${el.tag}: ${el.text || el.type || ''} [${el.className}]`);
    });

    // 5. Try to find and click settings button
    console.log('\n5. Trying to open settings panel...');

    // Look for gear/settings icon button
    const settingsButton = await page.$('button svg, [class*="settings"] button, button:has-text("설정")');
    if (settingsButton) {
      await settingsButton.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: '/tmp/test-settings-open.png', fullPage: true });
      console.log('   Settings panel opened');
    }

    // Check for ViewerSettingsPanel content
    const panelContent = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label, span, div'))
        .map(el => el.textContent?.trim())
        .filter(t => t && t.length < 30 && t.length > 1);
      return [...new Set(labels)].slice(0, 30);
    });

    console.log('\n   Panel labels found:');
    panelContent.forEach((label: string) => {
      if (label.includes('분할') || label.includes('LTR') || label.includes('RTL') ||
          label.includes('방향') || label.includes('너비') || label.includes('스크롤')) {
        console.log(`   - ${label}`);
      }
    });

    // 6. Test toggling double page split
    console.log('\n6. Testing double page split toggle...');

    // Find checkbox or toggle for split
    const splitToggle = await page.$('input[type="checkbox"]');
    if (splitToggle) {
      const beforeState = await splitToggle.isChecked();
      console.log(`   Split toggle before: ${beforeState}`);

      await splitToggle.click();
      await page.waitForTimeout(2000);

      const afterState = await splitToggle.isChecked();
      console.log(`   Split toggle after: ${afterState}`);

      await page.screenshot({ path: '/tmp/test-after-toggle.png', fullPage: true });

      // Check images after toggle
      const imagesAfterToggle = await page.$$eval('img', (imgs) => {
        return imgs.map((img, i) => ({
          index: i,
          rect: img.getBoundingClientRect(),
          display: getComputedStyle(img).display,
          src: img.src?.substring(0, 50)
        }));
      });

      console.log(`\n   Images after toggle: ${imagesAfterToggle.length}`);
      imagesAfterToggle.forEach((img: any, i: number) => {
        console.log(`   Image ${i}: top=${img.rect.top.toFixed(0)}, height=${img.rect.height.toFixed(0)}`);
      });
    }

    // 7. Check for any error states
    console.log('\n7. Checking for errors...');
    const errors = await page.$$eval('*', (elements) => {
      return elements
        .filter(el => {
          const text = el.textContent || '';
          return text.includes('불러올 수 없') || text.includes('오류') || text.includes('Error');
        })
        .map(el => ({
          tag: el.tagName,
          text: el.textContent?.substring(0, 100)
        }));
    });

    if (errors.length > 0) {
      console.log('   Errors found:');
      errors.slice(0, 5).forEach((err: any) => console.log(`   - ${err.text}`));
    } else {
      console.log('   No error messages found');
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/test-error.png' });
  } finally {
    await browser.close();
  }
}

testSettings();
