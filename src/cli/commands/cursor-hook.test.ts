/**
 * H5 — the `cursor-hook` CLI entry.
 *
 * The load-bearing difference from Windsurf: Cursor does NOT read the exit code.
 * It reads a JSON response on stdout and blocks on `continue:false`. Writing the
 * Windsurf exit-2 convention here would silently fail to block.
 */
import { describe, it, expect, vi } from 'vitest';
import { runCursorHookAction, CURSOR_CONTINUE } from './cursor-hook.js';

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
