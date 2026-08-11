/**
 * `nexpath windsurf-hook <event>` — the shim invoked by Windsurf's Cascade hooks
 * (configured in ~/.codeium/windsurf/hooks.json by `nexpath install`).
 *
 * Reads the hook JSON on stdin, remaps it to the nexpath Layer-C CLI contract, and
 * fires `nexpath auto` / `nexpath stop`. `<event>` ∈ { pre_user_prompt,
 * post_cascade_response }. `--project <dir>` overrides the project root (defaults
 * to process.cwd(), which Windsurf sets to the active workspace folder).
 *
 * **Exits 0 in every shipped configuration — a hook must never block or break
 * Cascade.** Amended 2026-08-10 (hook milestone H2): there is now exactly ONE
 * path that exits non-zero, and it is off by default.
 *
 * When `NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY=1` (internal switch, never
 * persisted, never user-facing) **and** the prompt-submit decider explicitly
 * returns `'block'`, a `pre_user_prompt` exits **2** — Windsurf's documented
 * signal to cancel the prompt before Cascade sees it. This is the deliberate
 * inversion of the original always-exit-0 contract that the prompt-submit-time
 * advisory requires; it is stated here rather than left to contradict the code.
 *
 * Everything else still exits 0, including every failure path: a thrown decider,
 * an unexpected value, or any error at all falls through to exit 0 (fail-open,
 * amendment A3). With the switch unset — the default — the gated block is skipped
 * entirely and behaviour is byte-identical to before.
 */
import type { Command } from 'commander';
import type { ChildProcess } from 'node:child_process';
import { runWindsurfHook, parsePayload, type RunResult } from '../../windsurf-hook/handler.js';
import { decideSubmitPrompt, type DeciderOptionSet, type DeciderSelection } from './submit-prompt-decider.js';
import {
  createDeterministicSubmitOptionSource,
  type SubmitOptionSource,
} from './submit-option-source.js';
import { openStore, closeStore } from '../../store/db.js';
import { writeSubmitDecision } from './submit-decision-store.js';
// CONSUME-ONLY. `SessionStateManager` is not Vedansi-owned (`hi0001234d` 15 /
// `harshil480` 15) — it is called here, never modified.
import { SessionStateManager } from '../../classifier/SessionStateManager.js';
import { bringPopupToFront } from '../../windsurf-hook/foreground.js';

/**
 * Resolve once the spawned `auto`/`stop` child exits (so the hook has finished its
 * work — `auto` has persisted the advisory, `stop` has shown the popup + got the
 * selection — before we return). Resolves immediately if there is no child, and
 * is bounded by `timeoutMs` so a hook can never hang forever.
 */
export function awaitChild(child: ChildProcess | null | undefined, timeoutMs = 600_000): Promise<void> {
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.on('exit', finish);
    child.on('close', finish);
    child.on('error', finish);
  });
}

/** Read all of stdin (returns '' immediately when attached to a TTY / no pipe). */
export function defaultReadStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

export interface WindsurfHookCliDeps {
  readStdin?: () => Promise<string>;
  run?: typeof runWindsurfHook;
  cwd?: string;
}

/**
 * Testable core: read stdin, resolve the project root, dispatch to the handler.
 * Kept free of `process.exit` so unit tests can call it directly.
 */
export async function handleWindsurfHookCli(
  event: string,
  opts: { project?: string },
  deps: WindsurfHookCliDeps = {},
): Promise<RunResult> {
  const readStdin = deps.readStdin ?? defaultReadStdin;
  const run = deps.run ?? runWindsurfHook;
  const cwd = opts.project ?? deps.cwd ?? process.cwd();
  const raw = await readStdin();
  return run(event, raw, { cwd });
}

/**
 * Backward-compatibility switch for the prompt-submit-time advisory flow
 * (hook milestone, H2). **Internal and non-user-facing by design**: read straight
 * from `process.env`, never persisted, never surfaced by `nexpath status` or
 * `nexpath config`. A `nexpath config set` key was explicitly rejected for this —
 * it would appear in the public config dump and be settable by any user, failing
 * the "invisible to end users" requirement.
 *
 * Matches the existing `NEXPATH_*` convention (`NEXPATH_DEBUG`, `NEXPATH_SIM`,
 * `NEXPATH_LOG_LEVEL`) including the exact-equality `=== '1'` read: unset, `'0'`,
 * `'true'`, or anything else all fall through to **today's exact behaviour**.
 */
export const WINDSURF_PROMPTSUBMIT_ADVISORY_ENV = 'NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY';

/** True only when the switch is explicitly `'1'`. Default OFF — never `!== '0'`. */
export function isWindsurfPromptSubmitAdvisoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WINDSURF_PROMPTSUBMIT_ADVISORY_ENV] === '1';
}

/**
 * What the gated `pre_user_prompt` path decided. Kept deliberately small: H2 only
 * builds the switch and the exit-2 wiring; H3 supplies the real decision (popup →
 * user picks → block). Until then the default decider always returns
 * `'allow'`, so switching the env var on changes nothing observable on its own.
 */
export type WindsurfPromptSubmitDecision = 'allow' | 'block';


/**
 * Build the default `pre_user_prompt` decider (H3 Gap 2b).
 *
 * **Ports, with a real default.** `composeOptions`/`renderPopup` remain injectable
 * seams, but they now default to `createDeterministicSubmitOptionSource` — so the
 * switched-on path produces real options instead of being inert. Passing
 * `ports.composeOptions` overrides that and skips opening a Store entirely.
 *
 * **Ownership is still intact.** Hiren's `composeDeterministicOptions` and
 * Bhavnesh's `createTtySelectFn` are CONSUME-ONLY (dev plan §1.3) and are reached
 * only through `submit-option-source.ts`, the adapter. Neither is imported here,
 * and `submit-prompt-decider.ts` still has zero imports of any kind.
 *
 * **The Store is opened per invocation and always closed** (`finally`). This runs
 * in a short-lived hook subprocess alongside the `auto` child of the same turn, so
 * a leaked handle would hold the SQLite lock against it.
 *
 * Every failure — store open, option source, popup — falls through to `'allow'`
 * (fail-open, amendment A3): the original prompt is released unmodified rather
 * than cancelled with nothing to replace it.
 */
export function buildDefaultPromptSubmitDecider(
  opts: { project?: string },
  ports: {
    composeOptions?: (promptText: string) => DeciderOptionSet | null;
    renderPopup?: (promptText: string, options: DeciderOptionSet) => Promise<DeciderSelection>;
    now?: () => number;
    /** Pre-built option source. Bypasses store opening; lets the block-only
     *  consume rule be observed directly in tests. */
    optionSource?: SubmitOptionSource;
    openStore?: (db?: string) => Promise<unknown>;
    closeStore?: (store: unknown) => Promise<void> | void;
  } = {},
): (event: string, o: { project?: string }, promptText?: string) => Promise<WindsurfPromptSubmitDecision> {
  const now = ports.now ?? (() => Date.now());
  const openStoreFn = ports.openStore ?? openStore;
  const closeStoreFn = ports.closeStore ?? closeStore;

  return async (_event, o, promptText) => {
    const projectRoot = o.project ?? opts.project ?? process.cwd();

    // The option source needs a Store. Opened per invocation and ALWAYS closed —
    // this runs inside a short-lived hook subprocess, so a leaked handle would
    // hold the SQLite lock against the `auto` child running in the same turn.
    let store: unknown = null;
    let source: SubmitOptionSource | null = ports.optionSource ?? null;
    if (!ports.composeOptions && !source) {
      try {
        store = await openStoreFn(undefined as never);
        source = createDeterministicSubmitOptionSource({ store, projectRoot });
      } catch {
        // Fail-open (A3): no store ⇒ no options ⇒ the prompt is released.
        store = null;
        source = null;
      }
    }

    try {
      const decision = await decideSubmitPrompt(promptText ?? promptTextForHook(), {
        composeOptions: ports.composeOptions
          ?? source?.composeOptions
          ?? ((): DeciderOptionSet | null => null),
        renderPopup: ports.renderPopup
          ?? source?.renderPopup
          ?? (async (): Promise<DeciderSelection> => null),
        persistDecision: async (replacementText) => {
          // Stamped here: the decision to block is made the instant the user
          // picks an option, immediately before persistence.
          const blockIssuedAt = now();

          // ── VED-PE-10: the injected body must NOT re-enter as a new prompt ──
          // A generated body re-entering `UserPromptSubmit` must not trigger fresh
          // classification, cadence, language updates, memory learning, or another
          // popup. Our replacement is exactly that: the extension injects it and
          // auto-submits, firing a fresh `pre_user_prompt`.
          //
          // The guard already ships — `auto.ts:706` reads `lastInjectedPrompt`,
          // clears it, and returns `no_action` on an echo match, before
          // `recordActivity` (`:722`). This feeds it rather than adding a second
          // guard, and closes the promptCount double-count by the same gate.
          if (store) {
            try {
              const mgr = SessionStateManager.load(store as never, projectRoot);
              mgr.setInjectedPrompt(store as never, replacementText);
            } catch {
              // Non-fatal: worst case the replacement is re-classified, which is
              // today's behaviour — never a reason to strand the user's prompt.
            }
          }

          await writeSubmitDecision({
            projectRoot,
            blockIssuedAt,
            hookPid: process.pid,
            decisionId: `sd-${now()}-${Math.floor(now() % 100000)}`,
            replacementText,
            createdAt: now(),
            host: 'windsurf',
          });
        },
      });

      // H3 acceptance: no pending advisory may survive a turn this path fully
      // handled, or `post_cascade_response` shows the OLD popup as well and the
      // user gets two. Option-A ordering means `auto` already wrote the row, so
      // it is consumed here. Only on 'block' — an allowed prompt is an ordinary
      // turn and must keep today's behaviour exactly.
      if (decision === 'block') source?.consumeHandledTurn();
      return decision;
    } finally {
      if (store) { try { await closeStoreFn(store as never); } catch { /* fail-open */ } }
    }
  };
}

/**
 * The prompt text the hook received. Windsurf delivers it on stdin, which
 * `handleWindsurfHookCli` already consumes, so it is not re-read here — the
 * option source is what needs it, and that adapter is supplied by the wiring
 * site. Returns an empty string until then, which the decider treats as `'allow'`.
 */
function promptTextForHook(): string {
  return '';
}

export interface WindsurfHookActionDeps {
  handle?: (event: string, opts: { project?: string }, deps?: WindsurfHookCliDeps) => Promise<RunResult>;
  readStdin?: () => Promise<string>;
  /** Bound on the gated stdin read. A hang here would hold the user's prompt. */
  stdinTimeoutMs?: number;
  raisePopup?: () => void;
  waitForChild?: (child: ChildProcess | null | undefined) => Promise<void>;
  exit?: (code: number) => void;
  env?: NodeJS.ProcessEnv;
  /**
   * Decides whether a `pre_user_prompt` should be blocked. Only consulted when the
   * switch is on. Defaults to `'allow'` so H2 alone is behaviour-neutral; H3
   * replaces it with the real popup-backed decision.
   */
  decidePromptSubmit?: (event: string, opts: { project?: string }, promptText: string) => Promise<WindsurfPromptSubmitDecision>;
}

/**
 * The `windsurf-hook` command body.
 *
 * Extracted from the command action purely so it can be tested. The action
 * resolves its own stdin and ends in `process.exit`, so calling it from a test
 * blocks on real stdin and then tears down the runner — which is why the
 * popup-raise gate below had no coverage. Every dependency defaults to exactly
 * what the action already used, so shipped behaviour is byte-identical.
 */
export async function runWindsurfHookAction(
  event: string,
  opts: { project?: string },
  deps: WindsurfHookActionDeps = {},
): Promise<void> {
  const handle = deps.handle ?? handleWindsurfHookCli;
  const raisePopup = deps.raisePopup ?? bringPopupToFront;
  const waitForChild = deps.waitForChild ?? awaitChild;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const env = deps.env ?? process.env;
  const readStdin = deps.readStdin ?? defaultReadStdin;
  const stdinTimeoutMs = deps.stdinTimeoutMs ?? 2_000;
  // Holds the stdin buffer when the gated path consumed it, so `handle` can replay
  // it instead of reading an already-drained pipe. Null ⇒ nothing was read.
  let preReadRaw: string | null = null;
  // Set by the gated pre_user_prompt path; the decision runs after `auto` has
  // classified THIS turn (option A). Never set when the switch is off.
  let decideAfterAuto = false;
  let pendingPromptText = '';
  // Default decider (H3). Constructed unconditionally, but this only BUILDS a
  // closure — `openStore` lives inside it and runs solely on the gated call below
  // (`isWindsurfPromptSubmitAdvisoryEnabled`). So with the switch off no Store is
  // opened, no lock is taken, and nothing here is reachable: the backward-compat
  // guarantee is enforced by control flow, not by comment.
  //
  // The default decider now DOES have a real option source, but still resolves
  // `'allow'` for every prompt because `promptTextForHook()` is a stub (see it
  // below) — pinned by `windsurf-hook-option-wiring.test.ts`.
  const decidePromptSubmit = deps.decidePromptSubmit ?? buildDefaultPromptSubmitDecider(opts);

  try {
    // ── Prompt-submit-time advisory (hook milestone H2) ────────────────────
    // Gated behind NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY=1, default OFF. When
    // off, this block is skipped entirely and everything below is byte-identical
    // to the shipped behaviour — that is the milestone's core guarantee.
    //
    // Windsurf's `pre_user_prompt` contract is exit-code only: exit 2 blocks the
    // prompt before Cascade ever sees it (empirically confirmed — Cascade renders
    // "1 hook(s) blocked this action" and produces no response). Any other exit
    // code lets it through.
    //
    // FAIL-OPEN (amendment A3) is mandatory here: today a failure means no
    // advisory appears and the user loses nothing, but under this flow a failure
    // while the prompt is held would mean the prompt never sends — strictly
    // worse. So only an explicit 'block' decision exits 2; a thrown decider, an
    // unknown value, or anything unexpected falls through to the normal exit-0
    // path below.
    if (event === 'pre_user_prompt' && isWindsurfPromptSubmitAdvisoryEnabled(env)) {
      // ── stdin is single-read, so it is consumed HERE and handed onward ────
      // `handleWindsurfHookCli` normally reads stdin itself. The decider needs the
      // same bytes (it must see the user's prompt text), and a pipe cannot be read
      // twice — so with the switch ON we read once here and replay the buffer into
      // `handle` below via `readStdin`. With the switch OFF we never read, and
      // `handle` consumes stdin exactly as it always has.
      // BOUNDED (amendment A3). `defaultReadStdin` resolves only on stdin 'end';
      // if the caller never closes the pipe, an unbounded await would hang the
      // hook WHILE HOLDING THE USER'S PROMPT — strictly worse than no advisory.
      // On timeout we fall through with '' , which the decider treats as 'allow'.
      preReadRaw = await Promise.race([
        readStdin(),
        new Promise<string>((r) => {
          const t = setTimeout(() => r(''), stdinTimeoutMs);
          if (typeof t.unref === 'function') t.unref();
        }),
      ]);
      // ── ORDERING (owner ruling: option A) ────────────────────────────────
      // The decision is DEFERRED to after `handle` + the child await below.
      // The option source reads the `pending_advisory` row that `nexpath auto`
      // writes, and `auto` is spawned by `handle`. Deciding here would read the
      // PREVIOUS turn's classification and advise on the wrong prompt.
      // Cost, accepted deliberately: `auto`'s runtime (including its LLM
      // classification) now sits inside the blocking window.
      pendingPromptText = parsePayload(preReadRaw)?.tool_info?.user_prompt ?? '';
      decideAfterAuto = true;
    }

    // Name this surface for Layer C's popup "Send to …" label. The spawned
    // `nexpath stop` child inherits process.env (see windsurf-hook/spawn.ts
    // baseOpts), so setting it here makes the Windsurf popup say "Windsurf".
    env.NEXPATH_AGENT = 'windsurf';
    // Call shape is IDENTICAL to before when nothing was pre-read, so the
    // switch-off path passes exactly two arguments as it always has. Only the
    // gated path adds the replay dep.
    const result = preReadRaw === null
      ? await handle(event, opts)
      : await handle(event, opts, { readStdin: async () => preReadRaw as string });
    // The stop event opens Layer C's popup window (advisory, feedback, or
    // prompt-enhancement). On Linux, GNOME opens it behind Windsurf — raise it
    // to the front. The extension's popup-foreground never runs here (Windsurf
    // spawns `stop` via this hook, not via ipc). Fire-and-forget; unref'd so it
    // never keeps the hook process alive.
    if (event === 'post_cascade_response' && result.child) {
      raisePopup();
    }
    // Await the Layer-C child so the prompt is fully written + auto has
    // persisted the advisory (and stop has rendered the popup) before we exit.
    await waitForChild(result.child);

    // ── Deferred submit decision (option A) ────────────────────────────────
    // `auto` has now persisted this turn's classification, so the option source
    // reads the CURRENT signal. Fail-open (A3) is unchanged: only an explicit
    // 'block' exits 2; a throw or any other value falls through to exit 0.
    if (decideAfterAuto) {
      let decision: WindsurfPromptSubmitDecision = 'allow';
      try {
        decision = await decidePromptSubmit(event, opts, pendingPromptText);
      } catch {
        decision = 'allow'; // never strand the user's prompt
      }
      if (decision === 'block') {
        exit(2);
        return;
      }
    }
  } catch {
    // Never break Cascade — swallow any error and exit cleanly.
  }
  exit(0);
}

export function registerWindsurfHookCommand(program: Command): void {
  program
    .command('windsurf-hook <event>')
    .description('Internal: bridge a Windsurf Cascade hook to nexpath auto/stop (configured by `nexpath install`).')
    .option('-p, --project <dir>', 'Project root (defaults to the current working directory)')
    .action(async (event: string, opts: { project?: string }) => {
      await runWindsurfHookAction(event, opts);
    });
}
