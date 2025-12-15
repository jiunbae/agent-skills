/**
 * App Store Connect Skill - Configuration Management
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AppStoreConnectConfig, BrowserConfig } from '../types.js';
import { ConfigurationError } from './errors.js';

// Default configuration values
const DEFAULT_API_BASE_URL = 'https://api.appstoreconnect.apple.com/v1';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_2FA_TIMEOUT = 120000;
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

/**
 * Get the data directory path for session storage
 */
export function getDataDir(): string {
  const skillDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../..'
  );
  return path.join(skillDir, 'data');
}

/**
 * Ensure data directory exists
 */
export function ensureDataDir(): void {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Load environment variables (with jelly-dotenv fallback pattern)
 */
function getEnv(key: string): string | undefined {
  return process.env[key];
}

/**
 * Load API configuration from environment variables
 */
export function loadAPIConfig(): AppStoreConnectConfig {
  const issuerId = getEnv('APPSTORE_ISSUER_ID');
  const keyId = getEnv('APPSTORE_KEY_ID');
  const privateKeyPath = getEnv('APPSTORE_PRIVATE_KEY_PATH');
  const privateKey = getEnv('APPSTORE_PRIVATE_KEY');

  const errors: string[] = [];

  if (!issuerId) {
    errors.push('APPSTORE_ISSUER_ID is required');
  }

  if (!keyId) {
    errors.push('APPSTORE_KEY_ID is required');
  }

  if (!privateKeyPath && !privateKey) {
    errors.push('Either APPSTORE_PRIVATE_KEY_PATH or APPSTORE_PRIVATE_KEY is required');
  }

  if (errors.length > 0) {
    throw new ConfigurationError(
      `Missing required environment variables:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      { missingVars: errors }
    );
  }

  // Validate private key path if provided
  if (privateKeyPath && !fs.existsSync(privateKeyPath)) {
    throw new ConfigurationError(
      `Private key file not found: ${privateKeyPath}`,
      { path: privateKeyPath }
    );
  }

  return {
    apiBaseUrl: getEnv('APPSTORE_API_BASE_URL') || DEFAULT_API_BASE_URL,
    issuerId: issuerId!,
    keyId: keyId!,
    privateKeyPath,
    privateKey,
    timeout: parseInt(getEnv('APPSTORE_TIMEOUT') || String(DEFAULT_TIMEOUT), 10),
    verbose: getEnv('APPSTORE_VERBOSE') === 'true',
  };
}

/**
 * Load browser configuration from environment variables
 */
export function loadBrowserConfig(): BrowserConfig {
  const dataDir = getDataDir();
  ensureDataDir();

  return {
    headless: getEnv('PLAYWRIGHT_HEADLESS') !== 'false',
    slowMo: getEnv('PLAYWRIGHT_SLOW_MO')
      ? parseInt(getEnv('PLAYWRIGHT_SLOW_MO')!, 10)
      : undefined,
    viewport: DEFAULT_VIEWPORT,
    sessionStoragePath: path.join(dataDir, 'browser-state.json'),
    twoFactorTimeout: parseInt(
      getEnv('APPSTORE_2FA_TIMEOUT') || String(DEFAULT_2FA_TIMEOUT),
      10
    ),
  };
}

/**
 * Get Apple ID from environment
 */
export function getAppleId(): string | undefined {
  return getEnv('APPLE_ID');
}

/**
 * Get TestFlight configuration
 */
export function getTestFlightConfig(): {
  defaultGroupId?: string;
  autoDistribute: boolean;
} {
  return {
    defaultGroupId: getEnv('TESTFLIGHT_DEFAULT_GROUP_ID'),
    autoDistribute: getEnv('AUTO_TESTFLIGHT_DISTRIBUTE') === 'true',
  };
}

/**
 * Validate configuration completeness
 */
export function validateConfig(config: Partial<AppStoreConnectConfig>): void {
  const required: (keyof AppStoreConnectConfig)[] = ['issuerId', 'keyId'];

  for (const key of required) {
    if (!config[key]) {
      throw new ConfigurationError(`Missing required config: ${key}`);
    }
  }

  if (!config.privateKey && !config.privateKeyPath) {
    throw new ConfigurationError('Either privateKey or privateKeyPath is required');
  }
}

/**
 * Read private key from file
 */
export function readPrivateKey(keyPath: string): string {
  try {
    return fs.readFileSync(keyPath, 'utf-8');
  } catch (error) {
    throw new ConfigurationError(
      `Failed to read private key file: ${keyPath}`,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Get safe config summary (for logging, without sensitive data)
 */
export function getSafeConfigSummary(
  config: AppStoreConnectConfig
): Record<string, unknown> {
  return {
    apiBaseUrl: config.apiBaseUrl,
    issuerId: config.issuerId.substring(0, 8) + '...',
    keyId: config.keyId,
    privateKeySource: config.privateKeyPath ? 'file' : 'env',
    timeout: config.timeout,
    verbose: config.verbose,
  };
}

/**
 * Merge partial config with defaults
 */
export function mergeConfig(
  partial: Partial<AppStoreConnectConfig>
): AppStoreConnectConfig {
  const base = loadAPIConfig();
  return {
    ...base,
    ...partial,
    // Don't override base URL unless explicitly provided
    apiBaseUrl: partial.apiBaseUrl || base.apiBaseUrl,
  };
}
