/**
 * Google Search Console Configuration
 * Handles environment variable detection and credential loading
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GoogleSearchConsoleConfig, ServiceAccountKey } from './types';

// ============================================================================
// Environment Variable Patterns
// ============================================================================

const ENV_PATTERNS = {
  serviceAccountKeyFile: [
    'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GSC_SERVICE_ACCOUNT_FILE',
    'SEARCH_CONSOLE_KEY_FILE',
  ],
  serviceAccountKeyJson: [
    'GOOGLE_SERVICE_ACCOUNT_KEY_JSON',
    'GOOGLE_SERVICE_ACCOUNT_KEY',
    'GSC_SERVICE_ACCOUNT_JSON',
    'GOOGLE_CREDENTIALS_JSON',
  ],
  clientId: [
    'GOOGLE_CLIENT_ID',
    'GSC_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_ID',
  ],
  clientSecret: [
    'GOOGLE_CLIENT_SECRET',
    'GSC_CLIENT_SECRET',
    'GOOGLE_OAUTH_CLIENT_SECRET',
  ],
  refreshToken: [
    'GOOGLE_REFRESH_TOKEN',
    'GSC_REFRESH_TOKEN',
    'GOOGLE_OAUTH_REFRESH_TOKEN',
  ],
  siteUrl: [
    'GOOGLE_SEARCH_CONSOLE_SITE_URL',
    'GSC_SITE_URL',
    'SEARCH_CONSOLE_SITE',
    'GSC_SITE',
  ],
};

// ============================================================================
// Configuration Detection
// ============================================================================

/**
 * Find environment variable value using pattern matching
 */
function findEnvValue(patterns: string[]): string | undefined {
  // Try exact matches first
  for (const pattern of patterns) {
    const value = process.env[pattern];
    if (value) return value;
  }

  // Try wildcard patterns
  const envKeys = Object.keys(process.env);
  for (const pattern of patterns) {
    const wildcardPattern = pattern.replace(/_/g, '.*');
    const regex = new RegExp(`^${wildcardPattern}$`, 'i');
    for (const key of envKeys) {
      if (regex.test(key) && process.env[key]) {
        return process.env[key];
      }
    }
  }

  return undefined;
}

/**
 * Load service account key from file
 */
function loadServiceAccountKeyFile(filePath: string): ServiceAccountKey | null {
  try {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      console.warn(`Service account key file not found: ${resolvedPath}`);
      return null;
    }
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(content) as ServiceAccountKey;
  } catch (error) {
    console.error(`Failed to load service account key file: ${error}`);
    return null;
  }
}

/**
 * Parse service account key from JSON string
 */
function parseServiceAccountKeyJson(json: string): ServiceAccountKey | null {
  try {
    return JSON.parse(json) as ServiceAccountKey;
  } catch (error) {
    console.error(`Failed to parse service account key JSON: ${error}`);
    return null;
  }
}

// ============================================================================
// Configuration Resolver
// ============================================================================

export class ConfigResolver {
  /**
   * Resolve configuration from environment variables
   */
  static resolveFromEnv(): GoogleSearchConsoleConfig {
    return {
      serviceAccountKeyFile: findEnvValue(ENV_PATTERNS.serviceAccountKeyFile),
      serviceAccountKeyJson: findEnvValue(ENV_PATTERNS.serviceAccountKeyJson),
      clientId: findEnvValue(ENV_PATTERNS.clientId),
      clientSecret: findEnvValue(ENV_PATTERNS.clientSecret),
      refreshToken: findEnvValue(ENV_PATTERNS.refreshToken),
      siteUrl: findEnvValue(ENV_PATTERNS.siteUrl),
      timeout: parseInt(process.env.GSC_TIMEOUT || '30000', 10),
    };
  }

  /**
   * Get service account key from config
   */
  static getServiceAccountKey(config: GoogleSearchConsoleConfig): ServiceAccountKey | null {
    // Try inline JSON first
    if (config.serviceAccountKeyJson) {
      const key = parseServiceAccountKeyJson(config.serviceAccountKeyJson);
      if (key) return key;
    }

    // Try file path
    if (config.serviceAccountKeyFile) {
      const key = loadServiceAccountKeyFile(config.serviceAccountKeyFile);
      if (key) return key;
    }

    return null;
  }

  /**
   * Validate configuration
   */
  static validateConfig(config: GoogleSearchConsoleConfig): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    authMethod: 'service_account' | 'oauth' | 'none';
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let authMethod: 'service_account' | 'oauth' | 'none' = 'none';

    // Check service account
    const serviceAccountKey = this.getServiceAccountKey(config);
    if (serviceAccountKey) {
      authMethod = 'service_account';
      if (!serviceAccountKey.client_email) {
        errors.push('Service account key missing client_email');
      }
      if (!serviceAccountKey.private_key) {
        errors.push('Service account key missing private_key');
      }
    }
    // Check OAuth
    else if (config.clientId && config.clientSecret && config.refreshToken) {
      authMethod = 'oauth';
    }
    // No credentials
    else {
      errors.push('No Google credentials found. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or OAuth credentials.');
    }

    // Check site URL
    if (!config.siteUrl) {
      warnings.push('No default site URL configured. Site URL must be provided per request.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      authMethod,
    };
  }

  /**
   * Get safe summary for logging (redacts sensitive data)
   */
  static getSafeSummary(config: GoogleSearchConsoleConfig): Record<string, unknown> {
    return {
      hasServiceAccountKeyFile: !!config.serviceAccountKeyFile,
      hasServiceAccountKeyJson: !!config.serviceAccountKeyJson,
      hasOAuthCredentials: !!(config.clientId && config.clientSecret && config.refreshToken),
      siteUrl: config.siteUrl || '(not set)',
      timeout: config.timeout,
    };
  }

  /**
   * Redact config for safe logging
   */
  static redactConfig(config: GoogleSearchConsoleConfig): Partial<GoogleSearchConsoleConfig> {
    return {
      serviceAccountKeyFile: config.serviceAccountKeyFile ? '***FILE_PATH***' : undefined,
      serviceAccountKeyJson: config.serviceAccountKeyJson ? '***REDACTED***' : undefined,
      clientId: config.clientId ? `${config.clientId.substring(0, 20)}...` : undefined,
      clientSecret: config.clientSecret ? '***REDACTED***' : undefined,
      refreshToken: config.refreshToken ? '***REDACTED***' : undefined,
      siteUrl: config.siteUrl,
      timeout: config.timeout,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Get Google Search Console configuration
 */
export function getGoogleSearchConsoleConfig(): GoogleSearchConsoleConfig {
  const config = ConfigResolver.resolveFromEnv();
  const validation = ConfigResolver.validateConfig(config);

  if (!validation.valid) {
    throw new Error(`Configuration error: ${validation.errors.join(', ')}`);
  }

  if (validation.warnings.length > 0) {
    console.warn(`Configuration warnings: ${validation.warnings.join(', ')}`);
  }

  return config;
}

/**
 * Create configuration with custom overrides
 */
export function createConfig(overrides?: Partial<GoogleSearchConsoleConfig>): GoogleSearchConsoleConfig {
  const baseConfig = ConfigResolver.resolveFromEnv();
  return {
    ...baseConfig,
    ...overrides,
  };
}
