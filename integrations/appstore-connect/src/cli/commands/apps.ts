/**
 * CLI Command: apps
 *
 * App management commands
 */

import type { CLIOptions, CommandResult, App, AppVersion } from '../../types.js';
import { loadAPIConfig } from '../../utils/config.js';
import { createAPIClient } from '../../api/client.js';
import { AppsAPI } from '../../api/apps.js';
import { formatError } from '../../utils/errors.js';

/**
 * Format app for display
 */
function formatApp(app: App): string {
  return [
    `  ID:        ${app.id}`,
    `  Name:      ${app.attributes.name}`,
    `  Bundle ID: ${app.attributes.bundleId}`,
    `  SKU:       ${app.attributes.sku}`,
    `  Locale:    ${app.attributes.primaryLocale}`,
  ].join('\n');
}

/**
 * Format version for display
 */
function formatVersion(version: AppVersion): string {
  return [
    `  ID:        ${version.id}`,
    `  Version:   ${version.attributes.versionString}`,
    `  Platform:  ${version.attributes.platform}`,
    `  State:     ${version.attributes.appStoreState}`,
    `  Created:   ${version.attributes.createdDate}`,
  ].join('\n');
}

/**
 * List all apps
 */
export async function list(options: CLIOptions): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const appsAPI = new AppsAPI(client);

    const apps = await appsAPI.list();

    if (options.json) {
      return { success: true, data: apps };
    }

    if (apps.length === 0) {
      console.log('\nNo apps found.');
      return { success: true, data: [] };
    }

    console.log(`\n📱 Apps (${apps.length})`);
    console.log('═'.repeat(50));

    for (const app of apps) {
      console.log('');
      console.log(formatApp(app));
    }

    console.log('');

    return { success: true, data: apps };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Get app info
 */
export async function info(
  appId: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const appsAPI = new AppsAPI(client);

    const app = await appsAPI.get(appId);

    if (options.json) {
      return { success: true, data: app };
    }

    console.log('\n📱 App Details');
    console.log('═'.repeat(50));
    console.log('');
    console.log(formatApp(app));
    console.log('');

    return { success: true, data: app };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Search apps
 */
export async function search(
  query: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const appsAPI = new AppsAPI(client);

    const apps = await appsAPI.search(query);

    if (options.json) {
      return { success: true, data: apps };
    }

    if (apps.length === 0) {
      console.log(`\nNo apps found matching "${query}".`);
      return { success: true, data: [] };
    }

    console.log(`\n🔍 Search Results for "${query}" (${apps.length})`);
    console.log('═'.repeat(50));

    for (const app of apps) {
      console.log('');
      console.log(formatApp(app));
    }

    console.log('');

    return { success: true, data: apps };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Get app versions
 */
export async function versions(
  appId: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const appsAPI = new AppsAPI(client);

    const versionList = await appsAPI.getVersions(appId);

    if (options.json) {
      return { success: true, data: versionList };
    }

    if (versionList.length === 0) {
      console.log('\nNo versions found.');
      return { success: true, data: [] };
    }

    console.log(`\n📦 Versions (${versionList.length})`);
    console.log('═'.repeat(50));

    for (const version of versionList) {
      console.log('');
      console.log(formatVersion(version));
    }

    console.log('');

    return { success: true, data: versionList };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Run apps command
 */
export async function runAppsCommand(
  subcommand: string,
  args: string[],
  options: CLIOptions
): Promise<CommandResult> {
  switch (subcommand) {
    case 'list':
      return list(options);

    case 'info':
      if (!args[0]) {
        return { success: false, error: 'App ID required' };
      }
      return info(args[0], options);

    case 'search':
      if (!args[0]) {
        return { success: false, error: 'Search query required' };
      }
      return search(args[0], options);

    case 'versions':
      if (!args[0]) {
        return { success: false, error: 'App ID required' };
      }
      return versions(args[0], options);

    default:
      return {
        success: false,
        error: `Unknown apps command: ${subcommand}`,
        message: 'Available: list, info, search, versions',
      };
  }
}
