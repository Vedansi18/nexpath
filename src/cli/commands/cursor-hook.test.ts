/**
 * H5 — the `cursor-hook` CLI entry.
 *
 * The load-bearing difference from Windsurf: Cursor does NOT read the exit code.
 * It reads a JSON response on stdout and blocks on `continue:false`. Writing the
 * Windsurf exit-2 convention here would silently fail to block.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCursorHookAction, CURSOR_CONTINUE, CURSOR_BLOCK_USER_MESSAGE,
  CURSOR_PROMPTSUBMIT_ADVISORY_ENV, isCursorPromptSubmitAdvisoryEnabled,
} from './cursor-hook.js';
import { createHoldBudget } from './submit-hold-budget.js';

const PAYLOAD = JSON.stringify({
  prompt: 'hello',
  workspace_roots: ['/proj'],
  user_email: 'someone@example.com',
  transcript_path: '/tmp/t.jsonl',
});

function harness(over: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const exits: number[] = [];
  return {
    writes, exits,
    deps: {
      // H6: the decider is switch-gated. These tests are about the decision
      // path, so the switch is ON unless a test overrides it.
      env: { [CURSOR_PROMPTSUBMIT_ADVISORY_ENV]: '1' },
      // Hermetic: never touch the real ~/.nexpath/submit-flow.json in tests.
      // The env override above drives the gate; flag-file tests inject their own.
      readFlagFile: () => null,
      readStdin: async () => PAYLOAD,
      write: (t: string) => { writes.push(t); },
      exit: (c: number) => { exits.push(c); },
      ...over,
    },
  };
}

describe('⭐ Cursor blocks via stdout JSON, never the exit code', () => {
  it('always exits 0, even when blocking', async () => {
    const h = harness({ decide: async () => 'block' as const });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(h.exits).toEqual([0]);
  });

  it('emits continue:false to block', async () => {
    const h = harness({ decide: async () => 'block' as const });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toMatchObject({ continue: false });
  });

  it('emits continue:true to allow', async () => {
    const h = harness({ decide: async () => 'allow' as const });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });

  it('always writes exactly one response', async () => {
    // Two responses would be malformed stdout; Cursor reads one JSON document.
    const h = harness({ decide: async () => 'block' as const });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(h.writes).toHaveLength(1);
  });
});

describe('behaviour-neutral by default (H5 alone changes nothing)', () => {
  it('continues when no decider is supplied', async () => {
    const h = harness();
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual(CURSOR_CONTINUE);
  });

  it('continues for an unknown event rather than guessing its contract', async () => {
    const decide = vi.fn();
    const h = harness({ decide });
    await runCursorHookAction('someOtherEvent', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual(CURSOR_CONTINUE);
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('fail-open (A3) — never strand the prompt', () => {
  it('continues when the decider throws', async () => {
    const h = harness({ decide: async () => { throw new Error('boom'); } });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
    expect(h.exits).toEqual([0]);
  });

  it('continues on malformed stdin', async () => {
    const h = harness({ readStdin: async () => '{ not json' });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });

  it('⭐ bounded stdin read — a pipe that never closes must not hold the prompt', async () => {
    const h = harness({
      readStdin: () => new Promise<string>(() => {}),   // never resolves
      stdinTimeoutMs: 10,
      decide: async () => 'allow' as const,
    });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(h.exits).toEqual([0]);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });
});

describe('the decider receives a parsed, PII-free payload', () => {
  it('gets the prompt and project root', async () => {
    let seen: { promptText?: string; projectRoot?: string } | null = null;
    const h = harness({ decide: async (p: never) => { seen = p; return 'allow' as const; } });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(seen!.promptText).toBe('hello');
    expect(seen!.projectRoot).toBe('/proj');
  });

  it('⚠ §4.3 — never receives user_email', async () => {
    let seen: unknown = null;
    const h = harness({ decide: async (p: never) => { seen = p; return 'allow' as const; } });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.stringify(seen)).not.toContain('someone@example.com');
  });
});

describe('⭐ R2 — self-enforced hold: Cursor orphans timed-out hooks, so it will never reap us', () => {
  // Measured: at 60.002s Cursor stopped waiting but the hook process kept
  // running past 90s. A host-enforced bound is therefore no bound at all - the
  // process must terminate itself or it survives as an orphan.
  function fakeBudget(totalMs = 60_000) {
    let t = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const budget = createHoldBudget({
      totalMs,
      now: () => t,
      setTimeoutFn: (fn, ms) => { const e = { at: t + ms, fn }; timers.push(e); return e; },
      clearTimeoutFn: (h) => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); },
    });
    return {
      budget,
      advance(ms: number) {
        t += ms;
        for (const e of [...timers]) if (e.at <= t) { timers.splice(timers.indexOf(e), 1); e.fn(); }
      },
    };
  }

  it('a decider that never answers still exits 0 and continues', async () => {
    // Without the budget this hook would run forever, orphaned by Cursor, while
    // the user's prompt sits blocked.
    const f = fakeBudget();
    const h = harness({
      holdBudget: f.budget,
      decide: () => new Promise(() => { f.advance(60_000); }),   // never settles
    });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(h.exits).toEqual([0]);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });

  it('an expired budget never blocks, even if the decider later says block', async () => {
    // MUTATION GUARD: treating a timed-out run as a real decision would emit
    // continue:false with no replacement, cancelling the turn for nothing.
    const f = fakeBudget();
    const h = harness({
      holdBudget: f.budget,
      decide: () => new Promise((r) => { f.advance(60_000); setTimeout(() => r('block'), 0); }),
    });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });

  it('the budget is SHARED — a slow stdin read leaves less for the decision', async () => {
    // Per-segment timeouts would sum and could exceed the cap.
    const f = fakeBudget(60_000);
    const h = harness({
      holdBudget: f.budget,
      readStdin: async () => { f.advance(60_000); return PAYLOAD; },
      decide: async () => 'block' as const,
    });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    // Budget exhausted by stdin ⇒ the decision segment never runs ⇒ continue.
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
    expect(h.exits).toEqual([0]);
  });
});

describe('⭐ H6 — the Cursor switch is independent and defaults OFF', () => {
  it('pins the env var name', () => {
    // Duplicated from the Windsurf constant on purpose: the two platforms must be
    // switchable INDEPENDENTLY, so one shared var could not serve both.
    expect(CURSOR_PROMPTSUBMIT_ADVISORY_ENV).toBe('NEXPATH_CURSOR_PROMPTSUBMIT_ADVISORY');
  });

  it('is exact-equality: only "1" enables it', () => {
    expect(isCursorPromptSubmitAdvisoryEnabled({})).toBe(false);
    for (const v of ['0', 'true', 'yes', '']) {
      expect(isCursorPromptSubmitAdvisoryEnabled({ [CURSOR_PROMPTSUBMIT_ADVISORY_ENV]: v })).toBe(false);
    }
    expect(isCursorPromptSubmitAdvisoryEnabled({ [CURSOR_PROMPTSUBMIT_ADVISORY_ENV]: '1' })).toBe(true);
  });

  it('does NOT enable on the Windsurf switch — the two are independent', () => {
    expect(isCursorPromptSubmitAdvisoryEnabled({
      NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: '1',
    })).toBe(false);
  });

  it('⭐ switch OFF: the decider is never consulted, even if supplied', async () => {
    // Backward compat: with the switch unset the path is unreachable.
    const decide = vi.fn().mockResolvedValue('block' as const);
    const h = harness({ env: {}, decide });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(decide).not.toHaveBeenCalled();
    expect(JSON.parse(h.writes[0])).toEqual(CURSOR_CONTINUE);
  });
});

describe('⭐ H6 — user_message is the Cursor-only text channel', () => {
  it('a block carries an explanation', async () => {
    // Measured: user_message is rendered inside Cursor's block card. Windsurf has
    // no equivalent - its wording is a fixed vendor string. Omitting it would
    // leave the user staring at a bare "blocked by hook".
    const h = harness({ decide: async () => 'block' as const });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    const res = JSON.parse(h.writes[0]);
    expect(res.continue).toBe(false);
    expect(res.user_message).toBe(CURSOR_BLOCK_USER_MESSAGE);
  });

  it('an ALLOW never carries user_message — nothing to explain', async () => {
    // MUTATION GUARD: attaching it unconditionally would render a "blocked" card
    // message on a turn that was not blocked.
    const h = harness({ decide: async () => 'allow' as const });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });

  it('the message never contains the user prompt', async () => {
    // It is rendered in the host UI; echoing prompt text there would surface
    // content the user may not expect to see repeated.
    expect(CURSOR_BLOCK_USER_MESSAGE).not.toContain('hello');
    const h = harness({ decide: async () => 'block' as const });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(h.writes[0]).not.toContain('hello');
  });

  it('a caller may override the message', async () => {
    const h = harness({ decide: async () => 'block' as const, blockMessage: 'custom text' });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0]).user_message).toBe('custom text');
  });
});

describe('⭐ the DEFAULT decider (production path) — every other test injects one', () => {
  // The default is what actually runs in production: no test above exercises it,
  // which is precisely how submitKeystroke shipped as a no-op and writeCursorHooks
  // shipped unwired. This drives the REAL buildDefaultPromptSubmitDecider.
  const realRoot = mkdtempSync(join(tmpdir(), 'nexpath-h6-default-'));

  function bare(over: Record<string, unknown> = {}) {
    const writes: string[] = [];
    const exits: number[] = [];
    return {
      writes, exits,
      deps: {
        env: { [CURSOR_PROMPTSUBMIT_ADVISORY_ENV]: '1' },
        readStdin: async () => JSON.stringify({
          prompt: 'hello',
          workspace_roots: [realRoot],
        }),
        write: (t: string) => { writes.push(t); },
        exit: (c: number) => { exits.push(c); },
        ...over,
      },
    };
  }

  it('does not throw, hang, or block when no decider is injected', async () => {
    // With no classification present the decider must resolve 'allow', so the
    // user's prompt is released. A throw here would surface as a broken hook.
    const h = bare();
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(h.exits).toEqual([0]);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });

  it('writes no decision file when it allows', async () => {
    // A decision file written on an allow would be picked up by the poller and
    // injected into a turn that was never blocked.
    const h = bare();
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(existsSync(join(realRoot, '.nexpath', 'submit-decision.json'))).toBe(false);
  });

  it('still allows when the payload carries no project root', async () => {
    // workspace_roots absent ⇒ projectRoot undefined ⇒ the decider must degrade
    // to allow rather than throw on an undefined path.
    const h = bare({ readStdin: async () => JSON.stringify({ prompt: 'hello' }) });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(h.exits).toEqual([0]);
    expect(JSON.parse(h.writes[0])).toEqual({ continue: true });
  });

  it('switch OFF: the default decider is not even constructed', async () => {
    const h = bare({ env: {} });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(JSON.parse(h.writes[0])).toEqual(CURSOR_CONTINUE);
  });

  afterAll(() => rmSync(realRoot, { recursive: true, force: true }));
});

describe('⭐ the default decider is the REAL one, pinned structurally', () => {
  // The behavioural tests above cannot distinguish the real decider from a stub:
  // with no classification present BOTH return 'allow'. Mutation confirmed this -
  // replacing the default with `async () => 'allow'` kept all 26 green. So the
  // wiring is pinned against the source, the same technique used for the
  // no-OpenAI and switch-gate guards.
  const src = readFileSync(join(__dirname, 'cursor-hook.ts'), 'utf8');

  it('reuses H3\'s decider rather than a local stub', () => {
    expect(src).toMatch(/deps\.decide\s*\?\?[\s\S]{0,300}?buildDefaultPromptSubmitDecider/);
  });

  it('passes host: \'cursor\' so the record is tagged for the right editor', () => {
    // A windsurf-tagged record would be dropped by the Cursor reader and the
    // prompt would be cancelled with nothing ever injected.
    expect(src).toMatch(/buildDefaultPromptSubmitDecider\([\s\S]{0,200}?host:\s*'cursor'/);
  });

  it('does not hardcode an allow-only default', () => {
    // MUTATION GUARD: this is exactly the mutant that survived the behavioural
    // tests - a default that always allows, leaving the Cursor path inert.
    expect(src).not.toMatch(/deps\.decide\s*\?\?\s*\(async\s*\(\)\s*=>\s*'allow'/);
  });
});

/**
 * OPTION-A ORDERING (2026-08-12) — the Cursor hook must classify THIS prompt
 * (spawn `auto` + await) BEFORE deciding, because `beforeSubmitPrompt` fires
 * before the prompt reaches state.vscdb, so the extension's DB-watcher hasn't
 * classified it. Without this, the decider reads a stale/absent advisory and
 * never blocks the current turn (the gap found live 2026-08-12).
 */
describe('option-A ordering — auto is spawned+awaited before the decision', () => {
  it('⭐ spawns auto with THIS prompt, awaits it, THEN decides (correct order)', async () => {
    const order: string[] = [];
    const fakeChild = { kill: vi.fn() } as unknown as import('node:child_process').ChildProcess;
    const spawnAutoFn = vi.fn((prompt: string) => { order.push(`spawnAuto:${prompt}`); return fakeChild; });
    const waitForChild = vi.fn(async () => { order.push('await'); });
    const decide = vi.fn(async () => { order.push('decide'); return 'block' as const; });
    const h = harness({ spawnAutoFn, waitForChild, decide });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(spawnAutoFn).toHaveBeenCalledWith('hello', expect.objectContaining({ cwd: '/proj' }));
    expect(order).toEqual(['spawnAuto:hello', 'await', 'decide']);
    expect(h.writes[0]).toContain('"continue":false');
  });

  it('switch OFF: auto is NOT spawned and nothing decides (byte-identical old path)', async () => {
    const spawnAutoFn = vi.fn();
    const decide = vi.fn(async () => 'block' as const);
    const h = harness({ env: {}, spawnAutoFn, decide });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(spawnAutoFn).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(h.writes[0]).toBe(JSON.stringify(CURSOR_CONTINUE));
  });

  it('empty prompt: auto is not spawned, still decides (fail-open, no crash)', async () => {
    const spawnAutoFn = vi.fn();
    const h = harness({
      readStdin: async () => JSON.stringify({ prompt: '   ', workspace_roots: ['/proj'] }),
      spawnAutoFn,
      decide: async () => 'allow' as const,
    });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(spawnAutoFn).not.toHaveBeenCalled();
    expect(h.exits).toContain(0);
  });

  it('⭐ hold times out during the auto await: child is KILLED (no orphan, R2) and prompt released', async () => {
    const killed = vi.fn();
    const fakeChild = { kill: killed } as unknown as import('node:child_process').ChildProcess;
    // Fake budget: the stdin read succeeds; the auto-await times out; the
    // decision therefore also times out (exhausted budget refuses to start).
    let call = 0;
    const fakeHold = {
      remaining: () => 0,
      expired: () => call > 1,
      run: async <T>(work: () => Promise<T>) => {
        call += 1;
        if (call === 1) return { timedOut: false as const, value: await work() }; // stdin read
        if (call === 2) return { timedOut: true as const };                        // auto await → timeout
        return { timedOut: true as const };                                        // decision refused
      },
    };
    const h = harness({
      spawnAutoFn: () => fakeChild,
      waitForChild: async () => { /* would block */ },
      holdBudget: fakeHold as never,
      decide: async () => 'block' as const,
    });
    await runCursorHookAction('beforeSubmitPrompt', h.deps as never);
    expect(killed).toHaveBeenCalled();               // no orphan (R2)
    expect(h.writes[0]).toContain('"continue":true'); // fail-open — prompt released
  });
})
