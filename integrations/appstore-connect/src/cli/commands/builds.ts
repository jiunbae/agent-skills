/**
 * CLI Command: builds
 *
 * Build management commands
 */

import type { CLIOptions, CommandResult, Build } from '../../types.js';
import { loadAPIConfig } from '../../utils/config.js';
import { createAPIClient } from '../../api/client.js';
import { BuildsAPI } from '../../api/builds.js';
import { formatError } from '../../utils/errors.js';

/**
 * Format build for display
 */
function formatBuild(build: Build): string {
  const attrs = build.attributes;
  const expiredTag = attrs.expired ? ' [EXPIRED]' : '';
  const stateEmoji = {
    VALID: '✅',
    PROCESSING: '⏳',
    FAILED: '❌',
    INVALID: '⚠️',
  }[attrs.processingState] || '❓';

  return [
    `  ID:          ${build.id}`,
    `  Version:     ${attrs.version}${expiredTag}`,
    `  State:       ${stateEmoji} ${attrs.processingState}`,
    `  Min OS:      ${attrs.minOsVersion}`,
    `  Uploaded:    ${attrs.uploadedDate}`,
    `  Expires:     ${attrs.expirationDate}`,
  ].join('\n');
}

/**
 * List builds for an app
 */
export async function list(
  appId: string,
  options: CLIOptions & { expired?: boolean }
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const buildsAPI = new BuildsAPI(client);

    const builds = await buildsAPI.list(appId, {
      expired: options.expired,
    });

    if (options.json) {
      return { success: true, data: builds };
    }

    if (builds.length === 0) {
      console.log('\nNo builds found.');
      return { success: true, data: [] };
    }

    console.log(`\n🔨 Builds (${builds.length})`);
    console.log('═'.repeat(50));

    for (const build of builds) {
      console.log('');
      console.log(formatBuild(build));
    }

    console.log('');

    return { success: true, data: builds };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Get build info
 */
export async function info(
  buildId: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const buildsAPI = new BuildsAPI(client);

    const build = await buildsAPI.get(buildId);

    if (options.json) {
      return { success: true, data: build };
    }

    console.log('\n🔨 Build Details');
    console.log('═'.repeat(50));
    console.log('');
    console.log(formatBuild(build));
    console.log('');

    return { success: true, data: build };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Wait for build processing
 */
export async function wait(
  buildId: string,
  options: CLIOptions & { timeout?: number }
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const buildsAPI = new BuildsAPI(client);

    const timeoutMs = (options.timeout || 600) * 1000;

    console.log(`\n⏳ Waiting for build ${buildId} to process...`);
    console.log(`   Timeout: ${timeoutMs / 1000}s`);
    console.log('');

    const build = await buildsAPI.waitForProcessing(buildId, {
      timeoutMs,
      onProgress: (state) => {
        process.stdout.write(`\r   State: ${state}   `);
      },
    });

    console.log('\n');

    if (options.json) {
      return { success: true, data: build };
    }

    console.log('✅ Build processing complete!');
    console.log('');
    console.log(formatBuild(build));
    console.log('');

    return { success: true, data: build };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Expire a build
 */
export async function expire(
  buildId: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    if (options.dryRun) {
      console.log(`[DRY RUN] Would expire build ${buildId}`);
      return { success: true, message: 'Dry run complete' };
    }

    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const buildsAPI = new BuildsAPI(client);

    await buildsAPI.expire(buildId);

    console.log(`\n✅ Build ${buildId} has been expired.`);
    console.log('');

    return { success: true, message: 'Build expired' };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Run builds command
 */
export async function runBuildsCommand(
  subcommand: string,
  args: string[],
  options: CLIOptions & { expired?: boolean; timeout?: number }
): Promise<CommandResult> {
  switch (subcommand) {
    case 'list':
      if (!args[0]) {
        return { success: false, error: 'App ID required' };
      }
      return list(args[0], options);

    case 'info':
      if (!args[0]) {
        return { success: false, error: 'Build ID required' };
      }
      return info(args[0], options);

    case 'wait':
      if (!args[0]) {
        return { success: false, error: 'Build ID required' };
      }
      return wait(args[0], options);

    case 'expire':
      if (!args[0]) {
        return { success: false, error: 'Build ID required' };
      }
      return expire(args[0], options);

    default:
      return {
        success: false,
        error: `Unknown builds command: ${subcommand}`,
        message: 'Available: list, info, wait, expire',
      };
  }
}
