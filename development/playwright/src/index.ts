/**
 * jelly-playwright - Browser automation library for Claude Code
 *
 * This library provides Playwright-based browser automation with:
 * - Browser instance management
 * - Navigation and page interactions
 * - Screenshot capture
 * - CLI commands for common operations
 */

// Re-export types
export * from './types.js';

// Core modules
export {
  browserManager,
  withBrowser,
  parseViewport,
  type BrowserType,
} from './core/browser.js';

// Error handling
export {
  BrowserAutomationError,
  TimeoutError,
  ElementNotFoundError,
  NavigationError,
  BrowserLaunchError,
  ScreenshotError,
  InvalidSelectorError,
  FormValidationError,
  wrapError,
  formatError,
} from './utils/errors.js';

// Navigation actions
export {
  navigate,
  reload,
  goBack,
  goForward,
  getPageInfo,
  waitForNavigation,
} from './actions/navigation.js';

// Interaction actions
export {
  click,
  doubleClick,
  rightClick,
  type,
  fill,
  clear,
  selectOption,
  check,
  uncheck,
  hover,
  focus,
  press,
  getText,
  getAttribute,
  isVisible,
  waitForElement,
} from './actions/interaction.js';

// Screenshot actions
export {
  screenshot,
  screenshotElement,
  screenshotViewports,
  screenshotAllViewports,
  pdf,
  VIEWPORT_PRESETS,
} from './actions/screenshot.js';
