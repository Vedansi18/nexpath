import { openStore, closeStore, DEFAULT_DB_PATH } from '../../store/db.js';
import {
  ACTION_SIGNAL_KINDS,
  SIGNAL_ADVISORY_FIRED,
  SIGNAL_OPTION_SELECTED,
  recordActionSignal,
  recordAdvisoryFired,
  recordOptionSelected,
  type PromptActionSignalKind,
} from '../../store/feedback-signals.js';

/**
 * `nexpath record-signal` — record ONE content-free UI-action feedback signal
 * (kind + timestamp only) in the CLI-owned store.
 *
 * The store is owned exclusively by the CLI; surfaces that cannot write it —
 * notably the VS Code extension, which opens the DB read-only — spawn this
 * command to record the same signals the CLI records for its own popups. The
 * payload is a fixed UI-action enum plus an optional timestamp: NO prompt,
 * body, option, or additional-details text (or any content-derived id) is ever
 * accepted or stored (see feedback-signals.ts).
 */

/** The kinds this command accepts: the per-action enum plus the two standalone
 *  timestamp signals. Every value here already exists in feedback-signals.ts. */
const VALID_KINDS: ReadonlySet<string> = new Set<string>([
  ...ACTION_SIGNAL_KINDS,
  SIGNAL_ADVISORY_FIRED,
  SIGNAL_OPTION_SELECTED,
]);

export interface RecordSignalOptions {
  kind:     string;
  project:  string;
  at?:      string;
  db:       string;
}

/**
 * Validate and record a single signal. Returns the process exit code: 0 on a
 * successful write, 1 on any rejected input or store failure. Never throws, and
 * writes nothing unless the kind is valid.
 */
export async function recordSignalAction(opts: RecordSignalOptions): Promise<number> {
  const kind = opts.kind;
  if (!VALID_KINDS.has(kind)) {
    process.stderr.write(`record-signal: invalid --kind '${kind}'\n`);
    return 1;
  }

  const occurredAt = opts.at !== undefined ? Number(opts.at) : Date.now();
  if (!Number.isFinite(occurredAt) || occurredAt <= 0) {
    process.stderr.write(`record-signal: invalid --at '${opts.at}'\n`);
    return 1;
  }

  let store;
  try {
    store = await openStore(opts.db);
  } catch {
    process.stderr.write('record-signal: could not open store\n');
    return 1;
  }

  try {
    if (kind === SIGNAL_ADVISORY_FIRED) {
      recordAdvisoryFired(store, opts.project, occurredAt);
    } else if (kind === SIGNAL_OPTION_SELECTED) {
      recordOptionSelected(store, opts.project, occurredAt);
    } else {
      recordActionSignal(store, opts.project, kind as PromptActionSignalKind, occurredAt);
    }
  } finally {
    closeStore(store);
  }
  return 0;
}

export function registerRecordSignalCommand(program: import('commander').Command): void {
  program
    .command('record-signal')
    .description('Record a content-free UI-action feedback signal (kind + timestamp only)')
    .requiredOption('--kind <kind>', 'Signal kind (a fixed UI-action enum)')
    .option('-p, --project <path>', 'Project root path', process.cwd())
    .option('--at <epochMs>', 'Occurred-at timestamp in epoch ms (default: now)')
    .option('--db <path>', 'Database path', DEFAULT_DB_PATH)
    .action(async (opts: RecordSignalOptions) => {
      process.exitCode = await recordSignalAction(opts);
    });
}
