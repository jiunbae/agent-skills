#!/usr/bin/env node
/**
 * jelly-appstore-connect CLI entry point
 *
 * Usage:
 *   npx tsx bin/asc.ts <command> [options]
 *   npm run asc -- <command> [options]
 *
 * After building:
 *   node dist/bin/asc.js <command> [options]
 */

import { runCLI } from '../src/cli/index.js';

// Get command line arguments (skip node and script path)
const args = process.argv.slice(2);

// Run CLI
runCLI(args).catch((error) => {
  console.error('Fatal error:', error.message || error);
  process.exit(1);
});
