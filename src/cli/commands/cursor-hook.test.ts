/**
 * H5 — the `cursor-hook` CLI entry.
 *
 * The load-bearing difference from Windsurf: Cursor does NOT read the exit code.
 * It reads a JSON response on stdout and blocks on `continue:false`. Writing the
 * Windsurf exit-2 convention here would silently fail to block.
 */
import { describe, it, expect, vi } from 'vitest';
import { runCursorHookAction, CURSOR_CONTINUE } from './cursor-hook.js';
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
    expect(JSON.parse(h.writes[0])).toEqual({ continue: false });
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
