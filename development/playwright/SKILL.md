---
name: playwright
description: Provides Playwright-based browser automation and E2E testing. Supports screenshots, web scraping, and form automation. Use for "브라우저", "스크린샷", "E2E 테스트", "웹 스크래핑" requests.
---

# Playwright Browser Automation

This skill ships its own CLI, `pw`, for E2E testing, screenshots and web
scraping. Prefer it over hand-written scripts: it opens and closes the browser
for you and returns a single result line or JSON.

## Quick Start

The package lives in this skill directory. Install once, then run commands
through `npm run pw`:

```bash
# From this skill directory
npm install
npx playwright install chromium   # download the browser binary

# Run a command (note the `--` before the command)
npm run pw -- screenshot https://example.com --output /tmp/example.png
```

`npm run pw` uses `tsx`, so no build step is required. To run the compiled
entry point instead:

```bash
npm run build
node dist/bin/pw.js screenshot https://example.com
```

## Commands

| Command | Alias | Purpose |
|---------|-------|---------|
| `navigate` | `nav` | Load a URL and report the final page |
| `screenshot` | `ss` | Capture a page to a file |
| `click` | - | Click an element |
| `type` | - | Type text into an element |
| `scrape` | - | Extract text from matching elements |
| `eval` | - | Evaluate JavaScript in the page |

```bash
npm run pw -- navigate https://example.com --wait networkidle
npm run pw -- screenshot https://example.com --output /tmp/example.png --full-page
npm run pw -- click "#submit" --url https://example.com
npm run pw -- type "#email" "user@example.com" --url https://example.com
npm run pw -- scrape https://example.com ".title" --json
npm run pw -- eval "document.title" --url https://example.com
```

`npm run pw -- --help` lists the commands, and `npm run pw -- <command> --help`
prints that command's own options. Add `--json` to any command to get a
machine-readable result instead of the human summary.

See [references/cli-reference.md](references/cli-reference.md) for every option
of every command.

## Using the library directly

For anything the CLI does not cover, import the Playwright API. This package
sets `"type": "module"`, so use `import` — a `require()` call fails here with
`ReferenceError: require is not defined in ES module scope`.

### Screenshot

```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('https://example.com');
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
} finally {
  await browser.close();
}
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

See [references/wait-strategies.md](references/wait-strategies.md).

### Extract Data

```typescript
const items = await page.$$eval('.item', els =>
  els.map(el => ({
    title: el.querySelector('.title')?.textContent,
    price: el.querySelector('.price')?.textContent,
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

See [references/selector-guide.md](references/selector-guide.md) for advanced
selectors.

## Best Practices

- Use `data-testid` attributes for stable selectors
- Always close the browser in a `finally` block
- Use `waitFor*` instead of arbitrary delays
- Run headless in CI, headed for debugging

When a command fails, check
[references/troubleshooting.md](references/troubleshooting.md); it is written
against these same `npm run pw` invocations.
