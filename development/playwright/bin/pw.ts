#!/usr/bin/env node
/**
 * jelly-playwright CLI entry point
 *
 * Usage:
 *   npx tsx bin/pw.ts <command> [options]
 *   npm run pw -- <command> [options]
 *
 * After building:
 *   node dist/bin/pw.js <command> [options]
 */

import { runCLI } from '../src/cli/index.js';

// Get command line arguments (skip node and script path)
const args = process.argv.slice(2);

// Run CLI
runCLI(args).catch((error) => {
  console.error('Fatal error:', error.message || error);
  process.exit(1);
});
