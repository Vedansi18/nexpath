/**
 * Hidden dev command: `nexpath feedback-test`.
 *
 * Primes the global feedback cadence so the popup becomes eligible on the next
 * Stop hook (within the next prompt or two), without waiting for the real usage
 * window. Intended for manual/e2e verification only — it is not advertised in
 * `--help`.
 */

import type { Command } from 'commander';
import { openStore, closeStore, DEFAULT_DB_PATH } from '../../store/db.js';
import { primeFeedbackEligible } from '../../store/feedback-cadence.js';

export function registerFeedbackTestCommand(program: Command): void {
  program
    .command('feedback-test', { hidden: true })
    .description('Dev: prime the feedback cadence so the popup fires on the next Stop')
    .option('--db <path>', 'Path to the SQLite database file')
    .action(async (opts: { db?: string }) => {
      const store = await openStore(opts.db ?? DEFAULT_DB_PATH);
      primeFeedbackEligible(store);
      closeStore(store);
      process.stdout.write(
        'nexpath: feedback popup primed — it will appear on the next Stop (send a prompt or two).\n',
      );
    });
}
