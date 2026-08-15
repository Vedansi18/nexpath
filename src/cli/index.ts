#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

// Silence console.log BEFORE any modules load — third-party modules (e.g.
// natural's storage) call dotenv.config() at import time, and dotenv v17 prints
// promotional "◇ injected env … // tip:" lines via console.log. Claude Code
// parses stdout as JSON, and those lines also clutter the live popup terminal.
// Force dotenv quiet, and drop any tip line that still slips through; forward
// all other console.log output to stderr.
process.env['DOTENV_CONFIG_QUIET'] = 'true';
console.log = (...args: unknown[]) => {
  const line = args.join(' ');
  if (line.includes('injected env') || line.includes('// tip:') || line.trimStart().startsWith('◇')) return;
  process.stderr.write(line + '\n');
};

const { run, createProgram, program } = await import('./main.js');
export { createProgram, program };

const thisFile = fileURLToPath(import.meta.url);
const mainFile = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()
  : '';

if (thisFile === mainFile) {
  await run();
}
