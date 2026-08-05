import { appendFileSync, chmodSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { closeStore, openStore, DEFAULT_DB_PATH, type Store } from '../../store/db.js';
import {
  validatePromptEnhancementPrepareRequestV1,
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
} from '../../prompt-enhancement/contracts.js';
import {
  runPromptEnhancementCliSubmitPopupV1,
  type PromptEnhancementCliPopupResultV1,
} from '../../prompt-enhancement/cli-submit-popup.js';
import type { PromptEnhancementPopupEventV1 } from '../../prompt-enhancement/popup-session.js';
import { recordPromptEnhancementCliFeedbackV1 } from './auto.js';

const POPUP_HOST_PROTOCOL_VERSION_V1 = 1;

export interface PromptEnhancementPopupHostInputV1 {
  protocolVersion: typeof POPUP_HOST_PROTOCOL_VERSION_V1;
  request: unknown;
  result: unknown;
}

export interface PromptEnhancementPopupHostOutputV1 {
  protocolVersion: typeof POPUP_HOST_PROTOCOL_VERSION_V1;
  result: PromptEnhancementCliPopupResultV1;
}

export interface PromptEnhancementPopupHostCommandOptionsV1 {
  inputFile: string;
  resultFile: string;
  readinessFile?: string;
  db?: string;
}

export interface PromptEnhancementPopupHostDependenciesV1 {
  readInputFile: (path: string) => string;
  writeResultAtomically: (path: string, output: PromptEnhancementPopupHostOutputV1) => void;
  openStore: (path: string) => Promise<Store>;
  closeStore: (store: Store) => void;
  runPopup: typeof runPromptEnhancementCliSubmitPopupV1;
  recordFeedback: typeof recordPromptEnhancementCliFeedbackV1;
  markReady: (path: string) => void;
}

const SAFE_NON_DELIVERY_RESULT_V1: PromptEnhancementCliPopupResultV1 = {
  state: 'closed_no_send',
};

function defaultDependencies(): PromptEnhancementPopupHostDependenciesV1 {
  return {
    readInputFile: (path) => readFileSync(path, 'utf8'),
    writeResultAtomically: writePromptEnhancementPopupHostResultAtomicallyV1,
    openStore,
    closeStore,
    runPopup: runPromptEnhancementCliSubmitPopupV1,
    recordFeedback: recordPromptEnhancementCliFeedbackV1,
    markReady: writePromptEnhancementPopupHostReadyMarkerV1,
  };
}

function asInput(value: unknown): PromptEnhancementPopupHostInputV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (input.protocolVersion !== POPUP_HOST_PROTOCOL_VERSION_V1) return undefined;
  if (!('request' in input) || !('result' in input)) return undefined;
  return {
    protocolVersion: POPUP_HOST_PROTOCOL_VERSION_V1,
    request: input.request,
    result: input.result,
  };
}

function validatedInput(value: unknown): {
  request: PromptEnhancementPrepareRequestV1;
  result: PromptEnhancementPrepareResultV1;
} | undefined {
  const input = asInput(value);
  if (!input) return undefined;
  if (!validatePromptEnhancementPrepareRequestV1(input.request).ok) return undefined;
  if (!validatePromptEnhancementPrepareResultV1(input.result).ok) return undefined;

  const request = input.request as PromptEnhancementPrepareRequestV1;
  const result = input.result as PromptEnhancementPrepareResultV1;
  if (request.requestId !== result.requestId || request.projectRoot !== result.projectRoot) return undefined;
  return { request, result };
}

/**
 * PE1.2 hidden child-command boundary. Invalid, missing, stale, or failed
 * input always resolves to an explicit no-send result. It never prints prompt
 * text/body text to stdout or stderr.
 */
export async function runPromptEnhancementPopupHostCommandV1(
  options: PromptEnhancementPopupHostCommandOptionsV1,
  overrides: Partial<PromptEnhancementPopupHostDependenciesV1> = {},
): Promise<PromptEnhancementPopupHostOutputV1> {
  const dependencies = { ...defaultDependencies(), ...overrides };
  let popupResult: PromptEnhancementCliPopupResultV1 = SAFE_NON_DELIVERY_RESULT_V1;
  let diagnosticError = 'none';

  try {
    const parsed = JSON.parse(dependencies.readInputFile(options.inputFile)) as unknown;
    const input = validatedInput(parsed);
    if (input) {
      let store: Store | undefined;
      try {
        store = await dependencies.openStore(options.db ?? DEFAULT_DB_PATH);
        popupResult = await dependencies.runPopup({
          request: input.request,
          result: input.result,
          onFirstRender: options.readinessFile
            ? () => dependencies.markReady(options.readinessFile!)
            : undefined,
          feedbackSink: (event: PromptEnhancementPopupEventV1) => dependencies.recordFeedback(
            store!,
            input.request.projectRoot,
            event,
          ),
        });
      } finally {
        if (store) dependencies.closeStore(store);
      }
    } else {
      diagnosticError = 'input_invalid_or_stale';
    }
  } catch (error) {
    diagnosticError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    popupResult = SAFE_NON_DELIVERY_RESULT_V1;
  }

  // NEXPATH_DEBUG diagnostics → a persistent file (temp dir is cleaned up, and the window may vanish),
  // so a render-then-close can be diagnosed with a simple `cat`. No prompt/body text — only TTY state,
  // the resolved result state, and any caught error class/message.
  if (process.env.NEXPATH_DEBUG) {
    try {
      const debugDir = join(homedir(), '.nexpath');
      mkdirSync(debugDir, { recursive: true });
      appendFileSync(
        join(debugDir, 'pe-popup-child-debug.log'),
        `[${new Date().toISOString()}] stdin.isTTY=${Boolean(process.stdin.isTTY)} stdout.isTTY=${Boolean(process.stdout.isTTY)} platform=${process.platform} result=${popupResult.state} error=${diagnosticError}\n`,
      );
    } catch { /* diagnostics are best-effort */ }
  }

  const output: PromptEnhancementPopupHostOutputV1 = {
    protocolVersion: POPUP_HOST_PROTOCOL_VERSION_V1,
    result: popupResult,
  };
  try {
    dependencies.writeResultAtomically(options.resultFile, output);
  } catch {
    // The parent launcher treats a missing result file as a safe failed launch.
  }
  return output;
}

export function writePromptEnhancementPopupHostResultAtomicallyV1(
  resultFile: string,
  output: PromptEnhancementPopupHostOutputV1,
): void {
  const temporaryFile = `${resultFile}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryFile, JSON.stringify(output), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryFile, resultFile);
    chmodSync(resultFile, 0o600);
  } catch (error) {
    try { unlinkSync(temporaryFile); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

export function writePromptEnhancementPopupHostReadyMarkerV1(readinessFile: string): void {
  const fd = openSync(readinessFile, 'wx', 0o600);
  try {
    writeFileSync(fd, 'ready', 'utf8');
    chmodSync(readinessFile, 0o600);
  } finally {
    closeSync(fd);
  }
}

export function registerPromptEnhancementPopupHostCommand(program: Command): void {
  program
    .command('prompt-enhancement-popup-host', { hidden: true })
    .description('Internal PE popup child-process host')
    .requiredOption('--input-file <path>', 'Private validated PE request/result file')
    .requiredOption('--result-file <path>', 'Private typed popup-result file')
    .option('--readiness-file <path>', 'Private first-render readiness marker')
    .option('--db <path>', 'Path to the SQLite database file')
    .action(async (opts: PromptEnhancementPopupHostCommandOptionsV1) => {
      await runPromptEnhancementPopupHostCommandV1(opts);
    });
}
