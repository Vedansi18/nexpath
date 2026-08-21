/**
 * Stop-driven submit decider (hook milestone H9 — owner ruling 2026-08-13).
 *
 * ── THE RULING ───────────────────────────────────────────────────────────────
 * "ALL the popups — including the Multi-prompt sequence — come AFTER the user
 * submits: old prompt cancelled, popup shown, user modifies/selects, THAT is
 * injected and submitted, and ONLY that runs."
 *
 * The previous submit decider hand-rolled a bare advisory popup (message +
 * options) and left PE at old timing. But Layer C's `nexpath stop` IS the
 * complete popup surface the user knows from the old flow and from Windsurf:
 * PE-first (MPS intake gate → MPS sequence popup → full PE popup), then the
 * Decision-Session advisory popup — with row consumption, delivery lineage,
 * feedback recording and the injected-prompt echo guard all handled inside.
 *
 * So the submit-time decision now RUNS `stop` inside the hook's hold and
 * translates its outcome:
 *
 *   stdout `{"decision":"block","reason":<text>}`  → persist the submit
 *     decision (the extension injects <text> and auto-submits) → 'block'
 *   anything else (skipped / shown / clipboard / crash / timeout) → 'allow'
 *
 * That stdout line is Layer C's own Claude-Code block contract — the SAME line
 * the extension's frozen `ipc.spawnStop` parses — so this module invents no
 * new protocol. `stop` sets `lastInjectedPrompt` itself on every block path,
 * which is exactly what the hooks' echo-skip and `auto`'s echo guard read.
 *
 * ── A1 DEVIATION, OWNER-RULED ────────────────────────────────────────────────
 * Amendment A1 kept LLM work off the submit path; `stop`'s advisory branch may
 * reach the engine. The owner's ruling explicitly relocates the FULL old
 * surface to submit time, accepting `stop`'s runtime inside the hold — the H4
 * budget still bounds the total, and a timeout fails open (A3).
 *
 * ── FAIL-OPEN (A3) ───────────────────────────────────────────────────────────
 * Every failure — spawn error, non-zero exit, malformed stdout, timeout,
 * persist failure — resolves 'allow': the original prompt is released.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { resolve } from 'node:path';
import { writeSubmitDecision } from './submit-decision-store.js';
import { log } from '../../logger.js';
// CONSUME-ONLY store calls (bhavnesh75-owned exports), used exactly as stop.ts
// uses them — no Layer C file is modified.
import { openStore, closeStore } from '../../store/db.js';
import { getPendingAdvisory, markAdvisoryShown } from '../../store/pending-advisories.js';
// RC31: READ-ONLY diagnostic (see the no-block path below). Layer C read, same
// consume-only convention the sweep already uses; nothing here is mutated.
import { getActivePendingPromptSequence } from '../../store/pending-sequences.js';
import {
  getPendingPromptEnhancement,
  markPromptEnhancementShown,
} from '../../store/pending-prompt-enhancements.js';

/** What `stop` prints on a selection — Layer C's Claude-Code block contract. */
export interface StopBlockLine {
  decision: 'block';
  reason: string;
}

/**
 * Parse `stop`'s stdout for the block line. Scans line-by-line (stderr noise
 * never reaches here; stdout may still carry stray writes from popup children)
 * and takes the LAST valid block line, mirroring how a stream consumer would
 * settle. Returns null when no valid block line exists.
 */
export function parseStopBlockOutput(stdout: string): StopBlockLine | null {
  let found: StopBlockLine | null = null;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (t === '' || !t.startsWith('{')) continue;
    try {
      const v = JSON.parse(t) as { decision?: unknown; reason?: unknown };
      if (v.decision === 'block' && typeof v.reason === 'string' && v.reason.trim() !== '') {
        found = { decision: 'block', reason: v.reason };
      }
    } catch { /* not JSON — popup child noise, skip */ }
  }
  return found;
}

/**
 * How to invoke the nexpath CLI — mirrors `windsurf-hook/spawn.ts` exactly:
 * NEXPATH_BIN override, else re-invoke THIS node + cli script (robust under a
 * sanitized hook PATH).
 */
function nexpathCmd(binaryPath?: string): { cmd: string; prefix: string[] } {
  if (binaryPath) return { cmd: binaryPath, prefix: [] };
  if (process.env.NEXPATH_BIN) return { cmd: process.env.NEXPATH_BIN, prefix: [] };
  return { cmd: process.execPath, prefix: [resolve(process.argv[1])] };
}

export interface StopDrivenDeciderPorts {
  /** Which host tag the persisted decision carries. */
  host: 'windsurf' | 'cursor';
  /** Injected for tests; defaults to node:child_process spawn. */
  spawnFn?: typeof spawn;
  /** Override the resolved nexpath binary (test/dev). */
  binaryPath?: string;
  /** Injected for tests; defaults to the real decision-file writer. */
  writeDecision?: typeof writeSubmitDecision;
  now?: () => number;
  logEvent?: typeof log;
  /**
   * Exposes the spawned child so the CALLER (holding the H4 budget) can kill
   * it on hold exhaustion — `stop`'s popups wait on the user with no bound of
   * their own, and Cursor never reaps timed-out hooks (R2).
   */
  onChild?: (child: ChildProcess | null) => void;
  /** RC10 sweep seams — injected for tests; default to the real store. */
  openStoreFn?: (db?: string) => Promise<unknown>;
  closeStoreFn?: (store: unknown) => Promise<void> | void;
}

/**
 * Build a decider with the SAME call shape as `buildDefaultPromptSubmitDecider`
 * so both hooks swap their default without touching their decision plumbing.
 */
export function buildStopDrivenPromptSubmitDecider(
  opts: { project?: string },
  ports: StopDrivenDeciderPorts,
): (event: string, o: { project?: string }, promptText?: string) => Promise<'allow' | 'block'> {
  const spawnFn = ports.spawnFn ?? spawn;
  const writeDecision = ports.writeDecision ?? writeSubmitDecision;
  const now = ports.now ?? (() => Date.now());
  const logEvent: typeof log = (level, name, data) => {
    try { (ports.logEvent ?? log)(level, name, data); } catch { /* never break the hook */ }
  };

  return async (_event, o, promptText) => {
    const projectRoot = o.project ?? opts.project ?? process.cwd();
    // A blank prompt is nothing to refine — release it without any popup.
    if ((promptText ?? '').trim() === '') return 'allow';

    let child: ChildProcess | null = null;
    let stdout = '';
    try {
      const { cmd, prefix } = nexpathCmd(ports.binaryPath);
      const spawnOpts: SpawnOptions = {
        cwd: projectRoot,
        // stdout is PIPED — the block line is the decision channel. stderr is
        // ignored: popup hosts write cues there ("Please select an action…").
        stdio: ['pipe', 'pipe', 'ignore'],
        env: process.env,
      };
      child = spawnFn(cmd, [...prefix, 'stop'], spawnOpts);
      ports.onChild?.(child);
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
      // Same stdin payload the old flow feeds `stop` — the Claude Code Stop
      // hook shape (`spawn.ts` precedent). `stop` scopes PE + advisory rows to
      // the session itself.
      child.stdin?.write(JSON.stringify({ cwd: projectRoot, hook_event_name: 'Stop', stop_hook_active: false }));
      child.stdin?.end();

      const exitCode = await new Promise<number | null>((res) => {
        let settled = false;
        const finish = (code: number | null): void => { if (!settled) { settled = true; res(code); } };
        child!.on('exit', (code) => finish(code));
        child!.on('close', (code) => finish(code));
        child!.on('error', () => finish(null));
      });

      logEvent('info', 'submit_stop_decider_done', {
        exit_code: exitCode,
        stdout_len: stdout.length,
        blocked: parseStopBlockOutput(stdout) !== null,
      });
      if (exitCode !== 0) return 'allow'; // crash ⇒ fail-open (A3)

      const block = parseStopBlockOutput(stdout);
      if (!block) {
        // ── RC31 (2026-08-21): never let an MPS sequence kill the flow SILENTLY ──
        // Upstream's MPS work added a routing rule to `stop` (Layer C, not ours):
        // when an `item_pending` sequence exists for this project+session, `stop`
        // returns `mps_continuation_gated` and renders NOTHING — its own test
        // says so outright ("sequence-continuation Stop suppresses the PE popup
        // and the advisory"), leaving both rows unconsumed. The v1 continuation
        // gate is fail-closed in production by design, so such a sequence cannot
        // advance on its own.
        //
        // For THIS flow that reads as an ordinary no-op turn: no block line, so
        // the prompt is released and no popup ever appears — for every later
        // submit in that session. Diagnosing that from the outside is nearly
        // impossible, which is exactly the class RC19's `explainSubmitFlowGate`
        // exists to prevent. Read-only, best-effort, and it changes NO decision:
        // the return value is `allow` either way.
        void (async () => {
          try {
            const s = await (ports.openStoreFn ?? openStore)(undefined as never);
            try {
              const seq = getActivePendingPromptSequence(s as never, projectRoot);
              if (seq) {
                logEvent('warn', 'submit_stop_decider_suppressed_by_sequence', {
                  status: seq.status,
                  current_item_index: seq.currentItemIndex,
                  item_count: seq.itemCount,
                });
              }
            } finally {
              try { await (ports.closeStoreFn ?? closeStore)(s as never); } catch { /* fail-open */ }
            }
          } catch { /* diagnostics must never affect the decision */ }
        })();
        return 'allow'; // skipped / shown / clipboard — ordinary turn
      }

      // `stop` already consumed the row, recorded lineage and set the
      // lastInjectedPrompt echo guard. Persisting the decision file is the ONLY
      // remaining step; a persist failure must not block with nothing to
      // replace the prompt (A3).
      const blockIssuedAt = now();
      await writeDecision({
        projectRoot,
        blockIssuedAt,
        hookPid: process.pid,
        // RC30: win32 only — Cascade waits on the powershell wrapper,
        // not on this node process. Undefined elsewhere, and
        // JSON.stringify drops it, so POSIX records are unchanged.
        ...(process.platform === 'win32' && process.ppid > 0
          ? { hookShellPid: process.ppid }
          : {}),
        decisionId: `sd-${now()}-${Math.floor(now() % 100000)}`,
        replacementText: block.reason,
        createdAt: now(),
        host: ports.host,
      });
      // ── H3's acceptance rule, extended to the stop-driven path (RC10 flash #2)
      // `stop` consumes only the row its popup HANDLED (PE-first: a PE turn
      // leaves the DS advisory row pending — old-flow semantics where it would
      // simply show next turn). Under submit-time that leftover re-fires a
      // popup on the NEXT leg for a turn the user already handled — measured
      // live as the second flash. A fully-handled (blocked) turn must leave NO
      // pending rows. Consume-only store calls; every failure is non-fatal
      // (the block already succeeded; worst case is today's extra popup).
      try {
        const sweepStore = await (ports.openStoreFn ?? openStore)(undefined as never);
        try {
          for (let i = 0; i < 8; i++) { // bounded — one turn parks at most a couple
            const row = getPendingAdvisory(sweepStore as never, projectRoot);
            if (!row) break;
            markAdvisoryShown(sweepStore as never, row.id);
          }
          const pe = getPendingPromptEnhancement(sweepStore as never, projectRoot);
          if (pe) markPromptEnhancementShown(sweepStore as never, pe.id);
        } finally {
          try { await (ports.closeStoreFn ?? closeStore)(sweepStore as never); } catch { /* fail-open */ }
        }
      } catch (err) {
        logEvent('warn', 'submit_stop_decider_sweep_failed', {
          message: (err as Error)?.message ?? 'unknown',
        });
      }
      return 'block';
    } catch (err) {
      logEvent('warn', 'submit_stop_decider_failed', {
        message: (err as Error)?.message ?? 'unknown',
      });
      return 'allow';
    } finally {
      // Never leave a live child if we are returning without its exit (error
      // paths); a completed child ignores the signal.
      if (child && child.exitCode === null && child.signalCode === null) {
        try { child.kill(); } catch { /* already gone */ }
      }
    }
  };
}
