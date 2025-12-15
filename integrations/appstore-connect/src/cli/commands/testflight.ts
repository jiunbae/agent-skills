/**
 * CLI Command: testflight
 *
 * TestFlight management commands
 */

import type { CLIOptions, CommandResult, BetaTester, BetaGroup } from '../../types.js';
import { loadAPIConfig } from '../../utils/config.js';
import { createAPIClient } from '../../api/client.js';
import { TestFlightAPI } from '../../api/testflight.js';
import { formatError } from '../../utils/errors.js';

/**
 * Format beta tester for display
 */
function formatTester(tester: BetaTester): string {
  const name = [tester.attributes.firstName, tester.attributes.lastName]
    .filter(Boolean)
    .join(' ') || '(No name)';

  return [
    `  ID:     ${tester.id}`,
    `  Name:   ${name}`,
    `  Email:  ${tester.attributes.email}`,
    `  State:  ${tester.attributes.state}`,
    `  Type:   ${tester.attributes.inviteType}`,
  ].join('\n');
}

/**
 * Format beta group for display
 */
function formatGroup(group: BetaGroup): string {
  const attrs = group.attributes;
  const publicInfo = attrs.publicLinkEnabled
    ? `\n  Link:   ${attrs.publicLink || '(pending)'}`
    : '';

  return [
    `  ID:       ${group.id}`,
    `  Name:     ${attrs.name}`,
    `  Type:     ${attrs.isInternalGroup ? 'Internal' : 'External'}`,
    `  Created:  ${attrs.createdDate}`,
    `  Feedback: ${attrs.feedbackEnabled ? 'Enabled' : 'Disabled'}${publicInfo}`,
  ].join('\n');
}

// ============================================
// Testers Commands
// ============================================

/**
 * List testers
 */
async function listTesters(
  appId: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const testflightAPI = new TestFlightAPI(client);

    const testers = await testflightAPI.listTesters(appId);

    if (options.json) {
      return { success: true, data: testers };
    }

    if (testers.length === 0) {
      console.log('\nNo testers found.');
      return { success: true, data: [] };
    }

    console.log(`\n👥 Beta Testers (${testers.length})`);
    console.log('═'.repeat(50));

    for (const tester of testers) {
      console.log('');
      console.log(formatTester(tester));
    }

    console.log('');

    return { success: true, data: testers };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Invite tester
 */
async function inviteTester(
  appId: string,
  email: string,
  options: CLIOptions & { group?: string; firstName?: string; lastName?: string }
): Promise<CommandResult> {
  try {
    if (options.dryRun) {
      console.log(`[DRY RUN] Would invite ${email} to app ${appId}`);
      return { success: true, message: 'Dry run complete' };
    }

    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const testflightAPI = new TestFlightAPI(client);

    const groupIds = options.group ? [options.group] : undefined;

    const tester = await testflightAPI.inviteTester(
      appId,
      email,
      options.firstName,
      options.lastName,
      groupIds
    );

    if (options.json) {
      return { success: true, data: tester };
    }

    console.log('\n✅ Tester invited successfully!');
    console.log('');
    console.log(formatTester(tester));
    console.log('');

    return { success: true, data: tester };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

// ============================================
// Groups Commands
// ============================================

/**
 * List groups
 */
async function listGroups(
  appId: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const testflightAPI = new TestFlightAPI(client);

    const groups = await testflightAPI.listGroups(appId);

    if (options.json) {
      return { success: true, data: groups };
    }

    if (groups.length === 0) {
      console.log('\nNo beta groups found.');
      return { success: true, data: [] };
    }

    console.log(`\n📋 Beta Groups (${groups.length})`);
    console.log('═'.repeat(50));

    for (const group of groups) {
      console.log('');
      console.log(formatGroup(group));
    }

    console.log('');

    return { success: true, data: groups };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

// ============================================
// Distribution Commands
// ============================================

/**
 * Distribute build to group
 */
async function distribute(
  buildId: string,
  options: CLIOptions & { group?: string }
): Promise<CommandResult> {
  try {
    if (!options.group) {
      return { success: false, error: 'Group ID required (--group)' };
    }

    if (options.dryRun) {
      console.log(`[DRY RUN] Would distribute build ${buildId} to group ${options.group}`);
      return { success: true, message: 'Dry run complete' };
    }

    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const testflightAPI = new TestFlightAPI(client);

    await testflightAPI.distributeToGroup(buildId, options.group);

    console.log(`\n✅ Build ${buildId} distributed to group ${options.group}`);
    console.log('');

    return { success: true, message: 'Build distributed' };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Submit for beta review
 */
async function submit(
  buildId: string,
  options: CLIOptions
): Promise<CommandResult> {
  try {
    if (options.dryRun) {
      console.log(`[DRY RUN] Would submit build ${buildId} for beta review`);
      return { success: true, message: 'Dry run complete' };
    }

    const config = loadAPIConfig();
    const client = createAPIClient(config);
    const testflightAPI = new TestFlightAPI(client);

    await testflightAPI.submitForBetaReview(buildId);

    console.log(`\n✅ Build ${buildId} submitted for beta app review`);
    console.log('');

    return { success: true, message: 'Build submitted for review' };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

// ============================================
// Main Router
// ============================================

/**
 * Run testflight command
 */
export async function runTestFlightCommand(
  subcommand: string,
  args: string[],
  options: CLIOptions & { group?: string; firstName?: string; lastName?: string }
): Promise<CommandResult> {
  // Handle nested commands: testers, groups
  if (subcommand === 'testers') {
    const action = args[0];
    const remaining = args.slice(1);

    switch (action) {
      case 'list':
        if (!remaining[0]) {
          return { success: false, error: 'App ID required' };
        }
        return listTesters(remaining[0], options);

      case 'invite':
        if (!remaining[0] || !remaining[1]) {
          return { success: false, error: 'App ID and email required' };
        }
        return inviteTester(remaining[0], remaining[1], options);

      default:
        return {
          success: false,
          error: `Unknown testers command: ${action}`,
          message: 'Available: list, invite',
        };
    }
  }

  if (subcommand === 'groups') {
    const action = args[0];
    const remaining = args.slice(1);

    switch (action) {
      case 'list':
        if (!remaining[0]) {
          return { success: false, error: 'App ID required' };
        }
        return listGroups(remaining[0], options);

      default:
        return {
          success: false,
          error: `Unknown groups command: ${action}`,
          message: 'Available: list',
        };
    }
  }

  // Direct commands
  switch (subcommand) {
    case 'distribute':
      if (!args[0]) {
        return { success: false, error: 'Build ID required' };
      }
      return distribute(args[0], options);

    case 'submit':
      if (!args[0]) {
        return { success: false, error: 'Build ID required' };
      }
      return submit(args[0], options);

    default:
      return {
        success: false,
        error: `Unknown testflight command: ${subcommand}`,
        message: 'Available: testers, groups, distribute, submit',
      };
  }
}
