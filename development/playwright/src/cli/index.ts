/**
 * CLI Router - Routes commands to their handlers
 */

import { navigateCommand } from './commands/navigate.js';
import { screenshotCommand } from './commands/screenshot.js';
import { clickCommand } from './commands/click.js';
import { typeCommand } from './commands/type.js';
import { scrapeCommand } from './commands/scrape.js';
import { evalCommand } from './commands/eval.js';
import { formatError } from '../utils/errors.js';
import type { Command, CommandResult } from '../types.js';

/**
 * Available commands
 */
const commands: Record<string, Command> = {
  navigate: navigateCommand,
  nav: navigateCommand, // alias
  screenshot: screenshotCommand,
  ss: screenshotCommand, // alias
  click: clickCommand,
  type: typeCommand,
  scrape: scrapeCommand,
  eval: evalCommand,
};

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
jelly-playwright - Browser automation CLI for Claude Code

USAGE:
  pw <command> [options]
  npx tsx bin/pw.ts <command> [options]

COMMANDS:
  navigate, nav    Navigate to a URL
  screenshot, ss   Take a screenshot of a page
  click            Click an element on the page
  type             Type text into an element
  scrape           Extract data from a page
  eval             Execute JavaScript on a page

OPTIONS:
  --help, -h       Show help message
  --version, -v    Show version

EXAMPLES:
  pw screenshot https://example.com
  pw screenshot https://example.com --output /tmp/example.png --full-page
  pw navigate https://example.com --wait networkidle
  pw click "#submit" --url https://example.com
  pw type "#email" "user@example.com" --url https://example.com
  pw scrape https://example.com ".title" --json
  pw eval "document.title" --url https://example.com

For command-specific help:
  pw <command> --help
`);
}

/**
 * Print version
 */
function printVersion(): void {
  console.log('jelly-playwright v1.0.0');
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  command?: string;
  positional: string[];
  options: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  let command: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
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
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, options };
}

/**
 * Main CLI entry point
 */
export async function runCLI(args: string[]): Promise<void> {
  const { command, positional, options } = parseArgs(args);

  // Handle global flags
  if (options.help || options.h) {
    if (command && commands[command]) {
      console.log(`\n${commands[command].name} - ${commands[command].description}\n`);
      console.log(`Usage: ${commands[command].usage}\n`);
      if (commands[command].options) {
        console.log('Options:');
        for (const opt of commands[command].options!) {
          console.log(`  ${opt.flag.padEnd(25)} ${opt.description}`);
        }
      }
      return;
    }
    printHelp();
    return;
  }

  if (options.version || options.v) {
    printVersion();
    return;
  }

  // No command specified
  if (!command) {
    printHelp();
    return;
  }

  // Find and execute command
  const cmd = commands[command];

  if (!cmd) {
    console.error(`Unknown command: ${command}`);
    console.error('Run "pw --help" for usage information.');
    process.exit(1);
  }

  try {
    const result = await cmd.execute(positional, options);

    if (result.success) {
      if (result.data) {
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('Success!');
          if (typeof result.data === 'object') {
            for (const [key, value] of Object.entries(result.data)) {
              console.log(`  ${key}: ${value}`);
            }
          } else {
            console.log(result.data);
          }
        }
      }
      if (result.duration) {
        console.log(`Duration: ${result.duration}ms`);
      }
    } else {
      console.error('Failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error(formatError(error));
    process.exit(1);
  }
}
