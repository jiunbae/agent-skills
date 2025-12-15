/**
 * CLI Command: auth
 *
 * Authentication management commands
 */

import type { CLIOptions, CommandResult } from '../../types.js';
import { loadAPIConfig, loadBrowserConfig, getAppleId } from '../../utils/config.js';
import { createJWTAuthManager } from '../../auth/jwt-auth.js';
import { createBrowserAuthManager } from '../../auth/browser-auth.js';
import { getDefaultSessionStore } from '../../auth/session-store.js';
import { formatError } from '../../utils/errors.js';

/**
 * Test API authentication (JWT)
 */
export async function testAPI(options: CLIOptions): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const jwtAuth = createJWTAuthManager(config);
    const result = await jwtAuth.testConfiguration();

    if (result.success) {
      if (options.json) {
        return { success: true, data: result };
      }

      console.log('\n✅ JWT Authentication Test');
      console.log('─'.repeat(40));
      console.log(`   Issuer ID:  ${result.tokenInfo?.issuerId}`);
      console.log(`   Key ID:     ${result.tokenInfo?.keyId}`);
      console.log(`   Expires:    ${result.tokenInfo?.expiresAt}`);
      console.log(`   Remaining:  ${result.tokenInfo?.remainingSeconds}s`);
      console.log('');

      return { success: true, message: 'JWT configuration is valid' };
    } else {
      return { success: false, error: result.message };
    }
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Perform browser login
 */
export async function login(options: CLIOptions): Promise<CommandResult> {
  try {
    const browserConfig = loadBrowserConfig();

    // Override headless based on CLI option
    if (options.headed) {
      browserConfig.headless = false;
    }

    const browserAuth = createBrowserAuthManager(browserConfig);
    const appleId = getAppleId();

    await browserAuth.performLogin(appleId);

    return { success: true, message: 'Login successful' };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Get session status
 */
export async function status(options: CLIOptions): Promise<CommandResult> {
  try {
    const sessionStore = getDefaultSessionStore();
    const info = sessionStore.getInfo();

    if (options.json) {
      return { success: true, data: info };
    }

    console.log('\n📋 Session Status');
    console.log('─'.repeat(40));

    if (!info.exists) {
      console.log('   Status:     No session found');
      console.log('   Hint:       Run "asc auth login --headed"');
    } else {
      console.log(`   Status:     ${info.valid ? '✅ Valid' : '❌ Invalid/Expired'}`);
      if (info.appleId) {
        console.log(`   Apple ID:   ${info.appleId}`);
      }
      console.log(`   Created:    ${info.age || 'Unknown'}`);
      console.log(`   Cookies:    ${info.cookieCount || 0}`);
    }

    console.log('');

    // Also check JWT config
    try {
      const apiConfig = loadAPIConfig();
      const jwtAuth = createJWTAuthManager(apiConfig);
      const jwtResult = await jwtAuth.testConfiguration();

      console.log('🔑 JWT Status');
      console.log('─'.repeat(40));
      console.log(`   Status:     ${jwtResult.success ? '✅ Configured' : '❌ Not configured'}`);
      if (jwtResult.tokenInfo) {
        console.log(`   Key ID:     ${jwtResult.tokenInfo.keyId}`);
      }
      console.log('');
    } catch {
      console.log('🔑 JWT Status');
      console.log('─'.repeat(40));
      console.log('   Status:     ❌ Not configured');
      console.log('');
    }

    return { success: true, data: info };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Logout (clear session)
 */
export async function logout(options: CLIOptions): Promise<CommandResult> {
  try {
    const browserConfig = loadBrowserConfig();
    const browserAuth = createBrowserAuthManager(browserConfig);

    await browserAuth.logout();

    return { success: true, message: 'Logged out successfully' };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Run auth command
 */
export async function runAuthCommand(
  subcommand: string,
  args: string[],
  options: CLIOptions
): Promise<CommandResult> {
  switch (subcommand) {
    case 'test-api':
      return testAPI(options);
    case 'login':
      return login(options);
    case 'status':
      return status(options);
    case 'logout':
      return logout(options);
    default:
      return {
        success: false,
        error: `Unknown auth command: ${subcommand}`,
        message: 'Available: test-api, login, status, logout',
      };
  }
}
