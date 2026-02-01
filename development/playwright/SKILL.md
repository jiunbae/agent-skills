---
name: automating-browser
description: Provides Playwright-based browser automation and E2E testing. Supports screenshots, web scraping, and form automation. Use for "브라우저", "스크린샷", "E2E 테스트", "웹 스크래핑" requests.
---

# Playwright Browser Automation

E2E testing, screenshots, and web scraping.

## Quick Start

```bash
# Install
npm init playwright@latest

# Run tests
npx playwright test

# Debug mode
npx playwright test --debug
```

## Common Patterns

### Screenshot

```typescript
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://example.com');
await page.screenshot({ path: 'screenshot.png', fullPage: true });
await browser.close();
```

### Fill Form

```typescript
await page.fill('#email', 'user@example.com');
await page.fill('#password', 'secret');
await page.click('button[type="submit"]');
await page.waitForNavigation();
```

### Wait Strategies

```typescript
// Wait for element
await page.waitForSelector('.result');

// Wait for network idle
await page.waitForLoadState('networkidle');

// Wait for specific response
await page.waitForResponse(resp => resp.url().includes('/api'));
```

### Extract Data

```typescript
const items = await page.$$eval('.item', els =>
  els.map(el => ({
    title: el.querySelector('.title').textContent,
    price: el.querySelector('.price').textContent,
  }))
);
```

## Selectors

| Type | Example |
|------|---------|
| CSS | `page.click('.btn')` |
| Text | `page.click('text=Submit')` |
| Role | `page.click('role=button[name="Submit"]')` |
| XPath | `page.click('//button')` |

## Best Practices

- Use `data-testid` attributes for stable selectors
- Always close browser in finally block
- Use `waitFor*` instead of arbitrary delays
- Run headless in CI, headed for debugging

See [references/selector-guide.md](references/selector-guide.md) for advanced selectors.
