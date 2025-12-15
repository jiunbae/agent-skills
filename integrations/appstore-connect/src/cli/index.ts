/**
 * App Store Connect CLI Router
 */

import type { CLIOptions, CommandResult } from '../types.js';
import { runAuthCommand } from './commands/auth.js';
import { runAppsCommand } from './commands/apps.js';
import { runBuildsCommand } from './commands/builds.js';
import { runTestFlightCommand } from './commands/testflight.js';

const VERSION = '1.0.0';

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]): {
  command: string;
  subcommand: string;
  positional: string[];
  options: CLIOptions & Record<string, string | boolean | number>;
} {
  const options: CLIOptions & Record<string, string | boolean | number> = {};
  const positional: string[] = [];
  let command = '';
  let subcommand = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      // Boolean flags
      if (key === 'json' || key === 'quiet' || key === 'verbose' ||
          key === 'dry-run' || key === 'headed' || key === 'expired') {
        options[key.replace(/-/g, '')] = true;
        options[key] = true;
      }
      // Value options
      else if (nextArg && !nextArg.startsWith('-')) {
        options[key] = nextArg;
        i++;
      } else {
        options[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      options[key] = true;
    } else if (!command) {
      command = arg;
    } else if (!subcommand) {
      subcommand = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, subcommand, positional, options };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
App Store Connect CLI v${VERSION}

Usage:
  npm run asc -- <command> <subcommand> [args] [options]

Commands:
  auth        Authentication management
    test-api    Test JWT API authentication
    login       Browser login (--headed required)
    status      Show session status
    logout      Clear session

  apps        App management
    list        List all apps
    info        Get app info <app-id>
    search      Search apps <query>
    versions    List versions <app-id>

  builds      Build management
    list        List builds <app-id>
    info        Get build info <build-id>
    wait        Wait for processing <build-id>
    expire      Expire build <build-id>

  testflight  TestFlight management
    testers list    List testers <app-id>
    testers invite  Invite tester <app-id> <email>
    groups list     List groups <app-id>
    distribute      Distribute build <build-id> --group <group-id>
    submit          Submit for beta review <build-id>

Options:
  --json        Output as JSON
  --quiet       Minimal output
  --verbose     Detailed output
  --dry-run     Simulate without changes
  --headed      Show browser (for login)
  --timeout     Timeout in seconds

Examples:
  npm run asc -- auth status
  npm run asc -- apps list --json
  npm run asc -- builds list 1234567890
  npm run asc -- testflight distribute 9876543210 --group internal-testers
`);
}

/**
 * Print result
 */
function printResult(result: CommandResult, options: CLIOptions): void {
  if (options.json && result.data) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  if (!result.success) {
    console.error(`\n❌ Error: ${result.error}`);
    if (result.message) {
      console.error(`   ${result.message}`);
    }
    console.error('');
  }
}

/**
 * Run CLI
 */
export async function runCLI(args: string[]): Promise<void> {
  const { command, subcommand, positional, options } = parseArgs(args);

  // Handle help and version
  if (!command || command === 'help' || options['help'] || options['h']) {
    printHelp();
    return;
  }

  if (command === 'version' || options['version'] || options['v']) {
    console.log(`v${VERSION}`);
    return;
  }

  // Route to command handler
  let result: CommandResult;

  try {
    switch (command) {
      case 'auth':
        result = await runAuthCommand(subcommand, positional, options);
        break;

      case 'apps':
        result = await runAppsCommand(subcommand, positional, options);
        break;

      case 'builds':
        result = await runBuildsCommand(subcommand, positional, options);
        break;

      case 'testflight':
        result = await runTestFlightCommand(subcommand, positional, options);
        break;

      default:
        result = {
          success: false,
          error: `Unknown command: ${command}`,
          message: 'Run "npm run asc -- help" for usage',
        };
    }

    printResult(result, options);

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  }
}
