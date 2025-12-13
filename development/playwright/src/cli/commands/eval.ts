/**
 * Eval command - Execute JavaScript on a web page
 */

import type { Command, CommandResult, WaitStrategy } from '../../types.js';
import { withBrowser } from '../../core/browser.js';
import { readFileSync } from 'fs';

export const evalCommand: Command = {
  name: 'eval',
  description: 'Execute JavaScript code on a web page',
  usage: 'pw eval <script> [options]',
  options: [
    { flag: '--url <url>', description: 'URL to navigate to before executing (required)' },
    { flag: '--file <path>', description: 'Read script from file instead of argument' },
    { flag: '--wait <strategy>', description: 'Wait strategy: load, domcontentloaded, networkidle' },
    { flag: '--timeout <ms>', description: 'Timeout in milliseconds (default: 30000)' },
    { flag: '--json', description: 'Output result as JSON' },
  ],

  async execute(args: string[], options: Record<string, unknown>): Promise<CommandResult> {
    let script = args[0];
    const filePath = options.file as string | undefined;

    // Read script from file if specified
    if (filePath) {
      try {
        script = readFileSync(filePath, 'utf-8');
      } catch (error) {
        return {
          success: false,
          error: `Failed to read script file: ${filePath}`,
        };
      }
    }

    if (!script) {
      return {
        success: false,
        error: 'Script is required. Usage: pw eval <script> --url <url>',
      };
    }

    const url = options.url as string | undefined;
    if (!url) {
      return {
        success: false,
        error: 'URL is required. Usage: pw eval <script> --url <url>',
      };
    }

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const waitStrategy = (options.wait as WaitStrategy) || 'load';
    const timeout = options.timeout ? parseInt(String(options.timeout), 10) : 30000;

    const result = await withBrowser(
      async (page) => {
        const startTime = Date.now();

        // Navigate first
        await page.goto(fullUrl, { waitUntil: waitStrategy, timeout });

        // Execute the script
        // Wrap in an async IIFE to support await
        const wrappedScript = script.includes('await')
          ? `(async () => { ${script} })()`
          : script;

        const evalResult = await page.evaluate(wrappedScript);

        return {
          url: fullUrl,
          script: script.length > 100 ? script.substring(0, 100) + '...' : script,
          result: evalResult,
          duration: Date.now() - startTime,
        };
      },
      { config: { headless: true } }
    );

    // Print result directly for non-JSON output
    if (!options.json && result.result !== undefined) {
      if (typeof result.result === 'object') {
        console.log(JSON.stringify(result.result, null, 2));
      } else {
        console.log(result.result);
      }
    }

    return {
      success: true,
      data: result,
    };
  },
};
