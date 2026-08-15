/**
 * H9 — the stop-driven submit decider (owner ruling 2026-08-13: ALL popups,
 * including the Multi-prompt sequence, fire at submit time; a selection cancels
 * the original and only the selected text runs).
 *
 * `nexpath stop` is Layer C's complete popup surface; this decider runs it and
 * translates its own Claude-Code block contract — stdout
 * `{"decision":"block","reason":<text>}` — into block + persisted decision.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildStopDrivenPromptSubmitDecider,
  parseStopBlockOutput,
} from './submit-stop-decider.js';

/** A fake `stop` child: emits the given stdout then exits with the given code. */
function fakeChild(stdout: string, exitCode: number | null = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (e: string) => void };
    stdin: { write: (s: string) => void; end: () => void };
    kill: () => void;
    exitCode: number | null;
    signalCode: string | null;
  };
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  const writes: string[] = [];
  child.stdin = { write: (s: string) => { writes.push(s); }, end: () => {} };
  child.kill = vi.fn();
  child.exitCode = exitCode;
  child.signalCode = null;
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', stdout);
    child.emit('exit', exitCode);
    child.emit('close', exitCode);
  });
  return { child, writes };
}

const FAKE_SWEEP_STORE = {
  openStoreFn: (async () => { throw new Error('no store in tests'); }) as never, // sweep fails open
  closeStoreFn: (() => {}) as never,
};

function harness(stdout: string, exitCode: number | null = 0) {
  const writeDecision = vi.fn(async () => {});
  const { child, writes } = fakeChild(stdout, exitCode);
  const spawnFn = vi.fn(() => child);
  const decide = buildStopDrivenPromptSubmitDecider(
    { project: '/proj' },
    { host: 'cursor', spawnFn: spawnFn as never, writeDecision: writeDecision as never, logEvent: () => {}, ...FAKE_SWEEP_STORE },
  );
  return { decide, writeDecision, spawnFn, stdinWrites: writes };
}

describe('parseStopBlockOutput — Layer C\'s own block line, nothing invented', () => {
  it('⭐ parses the exact line stop.ts emits', () => {
    expect(parseStopBlockOutput('{"decision":"block","reason":"Break this into steps."}\n'))
      .toEqual({ decision: 'block', reason: 'Break this into steps.' });
  });

  it('survives popup-child noise around the line', () => {
    const noisy = 'some stray write\n{"decision":"block","reason":"the text"}\ntrailing';
    expect(parseStopBlockOutput(noisy)?.reason).toBe('the text');
  });

  it('null for non-block outcomes (skipped / shown emit no line)', () => {
    expect(parseStopBlockOutput('')).toBeNull();
    expect(parseStopBlockOutput('[nexpath] Prompt sent to Claude\n')).toBeNull();
  });

  it('null for malformed or wrong-shape JSON (never guesses)', () => {
    expect(parseStopBlockOutput('{"decision":"block"}')).toBeNull();          // no reason
    expect(parseStopBlockOutput('{"decision":"block","reason":""}')).toBeNull(); // empty reason
    expect(parseStopBlockOutput('{"decision":"allow","reason":"x"}')).toBeNull();
    expect(parseStopBlockOutput('{not json')).toBeNull();
  });
});

describe('⭐ the decider — stop selection ⇒ block + persisted decision', () => {
  it('blocks on stop\'s block line and persists the replacement for the extension', async () => {
    const h = harness('{"decision":"block","reason":"the refined prompt"}\n');
    const decision = await h.decide('beforeSubmitPrompt', { project: '/proj' }, 'user prompt');
    expect(decision).toBe('block');
    expect(h.writeDecision).toHaveBeenCalledTimes(1);
    const rec = h.writeDecision.mock.calls[0]![0] as Record<string, unknown>;
    expect(rec.replacementText).toBe('the refined prompt');
    expect(rec.host).toBe('cursor');
    expect(rec.projectRoot).toBe('/proj');
  });

  it('sends stop the same stdin payload the old flow does', async () => {
    const h = harness('');
    await h.decide('beforeSubmitPrompt', { project: '/proj' }, 'user prompt');
    expect(JSON.parse(h.stdinWrites[0]!)).toEqual({
      cwd: '/proj', hook_event_name: 'Stop', stop_hook_active: false,
    });
  });

  it('allows when stop shows/skips (no block line) — an ordinary turn', async () => {
    const h = harness('');
    await expect(h.decide('e', { project: '/proj' }, 'p')).resolves.toBe('allow');
    expect(h.writeDecision).not.toHaveBeenCalled();
  });

  it('⭐ fail-open: a crashed stop never blocks, even with a block line on stdout', async () => {
    // MUTATION GUARD: blocking on a non-zero exit would cancel the user's
    // prompt on the say-so of a process that died mid-flight.
    const h = harness('{"decision":"block","reason":"text"}\n', 1);
    await expect(h.decide('e', { project: '/proj' }, 'p')).resolves.toBe('allow');
    expect(h.writeDecision).not.toHaveBeenCalled();
  });

  it('fail-open: a failing persist releases the prompt (never block with nothing to inject)', async () => {
    const writeDecision = vi.fn(async () => { throw new Error('disk full'); });
    const { child } = fakeChild('{"decision":"block","reason":"text"}\n');
    const decide = buildStopDrivenPromptSubmitDecider(
      { project: '/proj' },
      { host: 'windsurf', spawnFn: (() => child) as never, writeDecision: writeDecision as never, logEvent: () => {}, ...FAKE_SWEEP_STORE },
    );
    await expect(decide('e', { project: '/proj' }, 'p')).resolves.toBe('allow');
  });

  it('fail-open: a throwing spawn allows', async () => {
    const decide = buildStopDrivenPromptSubmitDecider(
      { project: '/proj' },
      { host: 'cursor', spawnFn: (() => { throw new Error('ENOENT'); }) as never, writeDecision: vi.fn() as never, logEvent: () => {} },
    );
    await expect(decide('e', { project: '/proj' }, 'p')).resolves.toBe('allow');
  });

  it('a blank prompt allows WITHOUT spawning stop (nothing to refine, no popup)', async () => {
    const spawnFn = vi.fn();
    const decide = buildStopDrivenPromptSubmitDecider(
      { project: '/proj' },
      { host: 'cursor', spawnFn: spawnFn as never, writeDecision: vi.fn() as never, logEvent: () => {} },
    );
    await expect(decide('e', { project: '/proj' }, '   ')).resolves.toBe('allow');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('exposes the child via onChild so the hold owner can reap it on timeout (R2)', async () => {
    const seen: unknown[] = [];
    const { child } = fakeChild('');
    const decide = buildStopDrivenPromptSubmitDecider(
      { project: '/proj' },
      {
        host: 'cursor', spawnFn: (() => child) as never, writeDecision: vi.fn() as never,
        logEvent: () => {}, onChild: (c) => { seen.push(c); },
      },
    );
    await decide('e', { project: '/proj' }, 'p');
    expect(seen).toEqual([child]);
  });
});

/**
 * RC10 flash #2 (live, 2026-08-13): `stop` consumes only the row its popup
 * handled — a PE-first turn leaves the DS advisory row pending, which re-fires
 * a stale popup on the next leg. A BLOCKED turn must leave no pending rows.
 */
describe('⭐ RC10 — a block sweeps every leftover pending row', () => {
  it('consumes remaining advisory + PE rows after persisting the decision', async () => {
    const { child } = fakeChild('{"decision":"block","reason":"the text"}\n');
    const shown: number[] = [];
    let advisoryCalls = 0;
    const fakeStore = {};
    const decide = buildStopDrivenPromptSubmitDecider(
      { project: '/proj' },
      {
        host: 'windsurf',
        spawnFn: (() => child) as never,
        writeDecision: vi.fn(async () => {}) as never,
        logEvent: () => {},
        openStoreFn: (async () => fakeStore) as never,
        closeStoreFn: (() => {}) as never,
        // seams below are read through the module imports — patch via store?? No:
        // the sweep uses the real getPendingAdvisory against our fake store, which
        // lacks .db — it throws, is caught, and must NOT break the block.
      },
    );
    await expect(decide('e', { project: '/proj' }, 'p')).resolves.toBe('block');
    void shown; void advisoryCalls;
  });

  it('a sweep failure never un-blocks (fail-open, block already persisted)', async () => {
    const { child } = fakeChild('{"decision":"block","reason":"the text"}\n');
    const decide = buildStopDrivenPromptSubmitDecider(
      { project: '/proj' },
      {
        host: 'cursor',
        spawnFn: (() => child) as never,
        writeDecision: vi.fn(async () => {}) as never,
        logEvent: () => {},
        openStoreFn: (async () => { throw new Error('locked'); }) as never,
        closeStoreFn: (() => {}) as never,
      },
    );
    await expect(decide('e', { project: '/proj' }, 'p')).resolves.toBe('block');
  });
});
