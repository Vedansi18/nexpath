/**
 * `nexpath cursor-hook <event>` — the shim Cursor invokes (hook milestone H5).
 *
 * Mirrors `windsurf-hook.ts`'s structure: read the JSON payload on stdin, remap
 * it to the nexpath Layer-C CLI contract, and dispatch. Kept as a separate
 * command because the two platforms' payloads and exit contracts differ.
 *
 * ── EXIT CONTRACT — DIFFERENT FROM WINDSURF ──────────────────────────────────
 * Windsurf blocks a prompt via **exit code 2**. Cursor does **not** use the exit
 * code: it reads a **JSON response on stdout**, and blocks when that response
 * carries `continue: false` (measured — Cursor renders a *"Submission blocked by
 * hook"* card and produces no agent response).
 *
 * So this command **always exits 0** and communicates through stdout instead.
 * Writing the Windsurf convention here would simply fail to block, silently.
 *
 * ── FAIL-OPEN (`A3`) ─────────────────────────────────────────────────────────
 * Any failure emits nothing (or an explicit continue) and exits 0, releasing the
 * user's original prompt unmodified. A failure while holding the prompt is
 * strictly worse than no advisory at all.
 *
 * ── PII (§4.3) ───────────────────────────────────────────────────────────────
 * The payload carries `user_email`. It is never parsed (see `payload.ts`) and
 * never logged; only `describeCursorPayloadSafely` output is loggable.
 */
import type { Command } from 'commander';
import { parseCursorHookPayload, type CursorHookPayload } from '../../cursor-hook/payload.js';
import { defaultReadStdin } from './windsurf-hook.js';
import { createHoldBudget, type HoldBudget } from './submit-hold-budget.js';
import { buildDefaultPromptSubmitDecider } from './windsurf-hook.js';

/**
 * Backward-compatibility switch for the Cursor submit-time advisory (H6).
 *
 * Mirrors `NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY` exactly, including the
 * exact-equality `=== '1'` read: internal, never persisted, never surfaced by
 * `nexpath status` or `nexpath config`. Unset / `'0'` / `'true'` all fall through
 * to today's behaviour.
 *
 * Duplicated rather than shared with the Windsurf constant on purpose: the two
 * platforms must be switchable INDEPENDENTLY, so one env var could not serve
 * both. A test pins the exact name.
 */
export const CURSOR_PROMPTSUBMIT_ADVISORY_ENV = 'NEXPATH_CURSOR_PROMPTSUBMIT_ADVISORY';

/** True only when the switch is explicitly `'1'`. Default OFF — never `!== '0'`. */
export function isCursorPromptSubmitAdvisoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CURSOR_PROMPTSUBMIT_ADVISORY_ENV] === '1';
}

/**
 * What we write to stdout. `continue:false` is what actually blocks Cursor.
 *
 * `user_message` is a **Cursor-only capability**: it is rendered inside the
 * "Submission blocked by hook" card (measured — analysis §4.1). Windsurf has no
 * equivalent; its block wording is a fixed vendor string we cannot influence.
 * So on Cursor we can explain WHY the prompt was held, and we should.
 */
export interface CursorHookResponse {
  continue: boolean;
  user_message?: string;
}

/** Shown in Cursor's block card when we hold a prompt for refinement. */
export const CURSOR_BLOCK_USER_MESSAGE =
  'nexpath: this prompt was held so you could refine it. Your refined version is being sent instead.';

/** The response that lets the prompt through unchanged — the fail-open default. */
export const CURSOR_CONTINUE: CursorHookResponse = { continue: true };

export interface CursorHookActionDeps {
  readStdin?: () => Promise<string>;
  /** Decides whether to block. Defaults to "never" so H5 alone is inert. */
  decide?: (payload: CursorHookPayload) => Promise<'allow' | 'block'>;
  /** Overrides the block card text; defaults to CURSOR_BLOCK_USER_MESSAGE. */
  blockMessage?: string;
  /** Env for the switch read. Injected for tests. */
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
  exit?: (code: number) => void;
  /** Bound on the stdin read; a hang here would hold the user's prompt. */
  stdinTimeoutMs?: number;
  /**
   * H4's shared hold budget, applied to the Cursor path (inherited acceptance).
   *
   * `R2`: Cursor **orphans** timed-out hooks — it stops waiting but does NOT kill
   * the process, measured still running past 90 s. So the host will never reap
   * us and the bound must be **self-enforced**, exactly as on Windsurf. Every
   * segment draws from ONE budget; per-segment timeouts would sum.
   */
  holdBudget?: HoldBudget;
}

/**
 * The command body, free of `process.exit` so it is unit-testable.
 *
 * **Behaviour-neutral by default:** with no `decide` supplied this always
 * continues, so registering the command changes nothing observable. H6 supplies
 * the real decision, exactly as H2 did for Windsurf.
 */
export async function runCursorHookAction(
  event: string,
  deps: CursorHookActionDeps = {},
): Promise<void> {
  const readStdin = deps.readStdin ?? defaultReadStdin;
  const write = deps.write ?? ((t: string) => process.stdout.write(t));
  const exit = deps.exit ?? ((c: number) => process.exit(c));
  const stdinTimeoutMs = deps.stdinTimeoutMs ?? 2_000;

  try {
    if (event !== 'beforeSubmitPrompt') {
      // Unknown event: continue rather than guess at its contract.
      write(JSON.stringify(CURSOR_CONTINUE));
      exit(0);
      return;
    }

    // ── Self-enforced hold (R2): Cursor will never reap us ────────────────
    const hold = deps.holdBudget ?? createHoldBudget();

    // BOUNDED: `defaultReadStdin` resolves only on stdin 'end'. An unbounded
    // await would hang the hook while holding the user's prompt (A3).
    const stdinRes = await hold.run(() => Promise.race([
      readStdin(),
      new Promise<string>((r) => {
        const t = setTimeout(() => r(''), stdinTimeoutMs);
        if (typeof t.unref === 'function') t.unref();
      }),
    ]));
    const raw = stdinRes.value ?? '';

    const payload = parseCursorHookPayload(raw);

    let decision: 'allow' | 'block' = 'allow';
    // Gated exactly like Windsurf's: with the switch off the decider is never
    // consulted, so the path is unreachable and behaviour is unchanged.
    //
    // The DEFAULT decider is H3's, with `host: 'cursor'` — the block/persist/
    // consume logic is identical across platforms and only the record's host tag
    // differs, so this reuses it rather than growing a parallel implementation.
    // Without this default the Cursor path was inert even with the switch on.
    const decide = deps.decide ?? (async (pl: CursorHookPayload) => {
      const d = buildDefaultPromptSubmitDecider(
        { project: pl.projectRoot },
        { host: 'cursor' },
      );
      return d('beforeSubmitPrompt', { project: pl.projectRoot }, pl.promptText ?? '');
    });
    if (isCursorPromptSubmitAdvisoryEnabled(deps.env ?? process.env)) {
      // Draws from what the stdin read left. A timeout is never a decision: it
      // continues, so the original prompt is released (A3).
      const decided = await hold.run(() => decide(payload));
      if (!decided.timedOut && decided.value === 'block') decision = 'block';
    }

    // `continue:false` is the ONLY thing that blocks Cursor — not the exit code.
    // On a block we also send `user_message`, the text channel Cursor renders in
    // its card. Omitting it would leave the user staring at a bare "blocked by
    // hook" with no explanation of what happened to their prompt.
    write(JSON.stringify(
      decision === 'block'
        ? { continue: false, user_message: deps.blockMessage ?? CURSOR_BLOCK_USER_MESSAGE }
        : CURSOR_CONTINUE,
    ));
  } catch {
    // Never break the host: emit a continue and fall through to exit 0.
    try { write(JSON.stringify(CURSOR_CONTINUE)); } catch { /* stdout gone */ }
  }
  exit(0);
}

export function registerCursorHookCommand(program: Command): void {
  program
    .command('cursor-hook <event>')
    .description('Internal: bridge a Cursor hook to nexpath (configured by `nexpath install`).')
    .action(async (event: string) => {
      await runCursorHookAction(event);
    });
}
