/**
 * H2 — the prompt-submit-time advisory switch, and Windsurf's gated exit-2 path.
 *
 * The milestone's core promise is that today's flow stays 100% intact and is
 * instantly revertible. The switch IS that mechanism, so these tests treat
 * "switch off ⇒ byte-identical behaviour" as the primary contract, not an
 * afterthought — this is the exact class of regression that was caught (and
 * reverted) in H1b when an un-gated change reached the shipping path.
 *
 * Windsurf's `pre_user_prompt` is exit-code only: exit 2 blocks the prompt before
 * Cascade sees it; anything else lets it through. Fail-open (amendment A3) is
 * mandatory: a failure while the prompt is held would mean the prompt never
 * sends, which is strictly worse than today's "no advisory appears".
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runWindsurfHookAction,
  isWindsurfPromptSubmitAdvisoryEnabled,
  WINDSURF_PROMPTSUBMIT_ADVISORY_ENV,
} from './windsurf-hook.js';

/** Minimal deps so the action never touches real stdin, spawns, or process.exit. */
function harness(over: Record<string, unknown> = {}) {
  const exit = vi.fn();
  const handle = vi.fn().mockResolvedValue({ child: null });
  const waitForChild = vi.fn().mockResolvedValue(undefined);
  const raisePopup = vi.fn();
  return { exit, handle, waitForChild, raisePopup, deps: { exit, handle, waitForChild, raisePopup, ...over } };
}

describe('H2 — switch read semantics (default OFF)', () => {
  it('is enabled ONLY for the exact string "1"', () => {
    expect(isWindsurfPromptSubmitAdvisoryEnabled({ [WINDSURF_PROMPTSUBMIT_ADVISORY_ENV]: '1' })).toBe(true);
  });

  it.each(['0', 'true', 'TRUE', 'yes', '', 'on', ' 1'])(
    'is disabled for %o — never a loose truthy read',
    (value) => {
      expect(isWindsurfPromptSubmitAdvisoryEnabled({ [WINDSURF_PROMPTSUBMIT_ADVISORY_ENV]: value })).toBe(false);
    },
  );

  it('is disabled when unset — the shipped default', () => {
    expect(isWindsurfPromptSubmitAdvisoryEnabled({})).toBe(false);
  });
});

describe('H2 — the PRODUCTION default read (no injected env)', () => {
  // Every other test injects `env` explicitly, which leaves the real production
  // path — the `= process.env` default parameter and the `deps.env ?? process.env`
  // fallback — completely uncovered. That is exactly the shape of bug this
  // milestone already had to verify empirically: a switch that works in tests but
  // is silently dead in production. These two tests pin the real read.
  const KEY = WINDSURF_PROMPTSUBMIT_ADVISORY_ENV;

  it('isWindsurfPromptSubmitAdvisoryEnabled() with no argument reads the real process.env', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, KEY);
    const prev = process.env[KEY];
    try {
      delete process.env[KEY];
      expect(isWindsurfPromptSubmitAdvisoryEnabled()).toBe(false);
      process.env[KEY] = '1';
      expect(isWindsurfPromptSubmitAdvisoryEnabled()).toBe(true);
      process.env[KEY] = '0';
      expect(isWindsurfPromptSubmitAdvisoryEnabled()).toBe(false);
    } finally {
      if (had) process.env[KEY] = prev as string;
      else delete process.env[KEY];
    }
  });

  it('runWindsurfHookAction falls back to process.env when deps.env is omitted', async () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, KEY);
    const prev = process.env[KEY];
    try {
      process.env[KEY] = '1';
      const decide = vi.fn().mockResolvedValue('block');
      // NOTE: no `env` key in deps — this is the production wiring.
      const h = harness({ decidePromptSubmit: decide });
      delete (h.deps as Record<string, unknown>).env;
      await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
      expect(decide).toHaveBeenCalled();
      expect(h.exit).toHaveBeenCalledWith(2);
    } finally {
      if (had) process.env[KEY] = prev as string;
      else delete process.env[KEY];
    }
  });
});

describe('H2 — BACKWARD COMPATIBILITY: switch off ⇒ byte-identical behaviour', () => {
  it('never consults the decider when the switch is unset', async () => {
    const decide = vi.fn();
    const h = harness({ decidePromptSubmit: decide, env: {} });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(decide).not.toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('exits 0 with the switch off even if a decider would have said block', async () => {
    const decide = vi.fn().mockResolvedValue('block');
    const h = harness({ decidePromptSubmit: decide, env: {} });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(decide).not.toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.exit).not.toHaveBeenCalledWith(2);
  });

  it('still runs the normal handler + child await with the switch off', async () => {
    const h = harness({ env: {} });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.handle).toHaveBeenCalledWith('pre_user_prompt', {});
    expect(h.waitForChild).toHaveBeenCalled();
  });
});

describe('H2 — switch ON: only an explicit block exits 2', () => {
  const ON = { [WINDSURF_PROMPTSUBMIT_ADVISORY_ENV]: '1' };

  it('exits 2 when the decider returns "block"', async () => {
    const h = harness({ decidePromptSubmit: vi.fn().mockResolvedValue('block'), env: { ...ON } });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.exit).toHaveBeenCalledWith(2);
  });

  it('DOES run the normal handler before blocking — option A ordering (H3)', async () => {
    // SEMANTIC CHANGE, deliberate. H2 asserted the opposite: blocking skipped the
    // handler entirely. Under the owner's option-A ruling the handler must run
    // FIRST, because it spawns `nexpath auto`, and `auto` writes the
    // pending_advisory row the option source classifies from. Deciding before it
    // would advise on the PREVIOUS turn's prompt.
    //
    // ⚠ KNOWN CONSEQUENCE: `auto` therefore runs for a prompt that is then
    // cancelled, so its advisory row + promptCount are written for a turn Cascade
    // never saw. The injected replacement fires a fresh pre_user_prompt, running
    // `auto` a second time — a promptCount double-count. Tracked for H4.
    const h = harness({ decidePromptSubmit: vi.fn().mockResolvedValue('block'), env: { ...ON } });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.handle).toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledWith(2);
  });

  it('exits 0 when the decider returns "allow"', async () => {
    const h = harness({ decidePromptSubmit: vi.fn().mockResolvedValue('allow'), env: { ...ON } });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.exit).not.toHaveBeenCalledWith(2);
  });

  it('defaults to allow (exit 0) when no decider is injected — H2 alone is behaviour-neutral', async () => {
    const h = harness({ env: { ...ON } });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('never gates post_cascade_response — the switch is prompt-submit only', async () => {
    const decide = vi.fn().mockResolvedValue('block');
    const h = harness({ decidePromptSubmit: decide, env: { ...ON } });
    await runWindsurfHookAction('post_cascade_response', {}, h.deps);
    expect(decide).not.toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledWith(0);
  });
});

describe('H2 — FAIL-OPEN (amendment A3): a failure must never strand the prompt', () => {
  const ON = { [WINDSURF_PROMPTSUBMIT_ADVISORY_ENV]: '1' };

  it('exits 0 when the decider throws', async () => {
    const h = harness({
      decidePromptSubmit: vi.fn().mockRejectedValue(new Error('popup crashed')),
      env: { ...ON },
    });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.exit).not.toHaveBeenCalledWith(2);
  });

  it('exits 0 for an unexpected decision value rather than guessing', async () => {
    const h = harness({
      // Simulates a future/garbled value: anything that is not exactly 'block'
      // must fall through to the allow path.
      decidePromptSubmit: vi.fn().mockResolvedValue('maybe' as unknown as 'allow'),
      env: { ...ON },
    });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('exits 0 when the downstream handler itself throws', async () => {
    const h = harness({
      decidePromptSubmit: vi.fn().mockResolvedValue('allow'),
      handle: vi.fn().mockRejectedValue(new Error('spawn failed')),
      env: { ...ON },
    });
    await runWindsurfHookAction('pre_user_prompt', {}, h.deps);
    expect(h.exit).toHaveBeenCalledWith(0);
  });
});
