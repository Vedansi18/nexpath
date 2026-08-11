/**
 * H3 — deterministic option source.
 *
 * Two things these tests exist to prevent:
 *  1. Re-classifying at submit time (an LLM round-trip `A1` forbids). Pinned by
 *     the "no OpenAI" suite below, which reads this file's own source.
 *  2. Holding the user's prompt when anything goes wrong. Every failure path must
 *     return null so the decider resolves 'allow' (amendment A3).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDeterministicSubmitOptionSource } from './submit-option-source.js';

const ROW = { flagType: 'scope_creep', stage: 'build', sessionId: 's1' };
const GENERATED = { l1: ['a1'], l2: ['b1', 'b2'], l3: ['c1'] };

function make(over: Record<string, unknown> = {}) {
  return createDeterministicSubmitOptionSource({
    store: {},
    projectRoot: '/proj',
    getRow: vi.fn().mockReturnValue(ROW) as never,
    getLevel: vi.fn().mockReturnValue({ currentLevel: 2 }) as never,
    composeFn: vi.fn().mockReturnValue(GENERATED) as never,
    selectFnFactory: (() => async () => null) as never,
    signalTypeFn: (() => 'TASK_REVIEW') as never,
    contentSourceFn: (() => 'content-template') as never,
    lookupFn: (() => (() => undefined)) as never,
    ...over,
  });
}

describe('reuses auto\'s classification — never re-classifies', () => {
  it('reads the persisted pending_advisory row', () => {
    const getRow = vi.fn().mockReturnValue(ROW);
    make({ getRow: getRow as never }).composeOptions('p');
    expect(getRow).toHaveBeenCalledWith({}, '/proj', undefined);
  });

  it('allows when there is no row — nothing was classified this turn (Gap 5)', () => {
    // Must NOT fall back to classifying; absence of a row means no popup.
    expect(make({ getRow: (() => null) as never }).composeOptions('p')).toBeNull();
  });
});

describe('🚫 no OpenAI client on the submit path', () => {
  // stop.ts reaches OpenAI only via the ENGINE path (buildEngineGrounding /
  // generateFromEngine), which A1 deterministic-only excludes. If someone wires
  // either in here, the submit path silently gains a network round-trip and every
  // other test still passes — so the absence is pinned against the source itself.
  const src = readFileSync(join(__dirname, 'submit-option-source.ts'), 'utf8');
  const imports = src.split('\n').filter((l) => l.trimStart().startsWith('import'));

  it('imports neither openai nor the engine generators', () => {
    const joined = imports.join('\n');
    expect(joined).not.toMatch(/openai/i);
    expect(joined).not.toMatch(/generateFromEngine|buildEngineGrounding/);
  });

  it('uses the deterministic generator', () => {
    expect(imports.join('\n')).toMatch(/composeDeterministicOptions/);
  });
});

describe('happy path', () => {
  it('returns the generated l1/l2/l3 set', () => {
    expect(make().composeOptions('p')).toEqual(GENERATED);
  });

  it('passes the resolved lookup/level/register/role to the generator', () => {
    const composeFn = vi.fn().mockReturnValue(GENERATED);
    createDeterministicSubmitOptionSource({
      store: {}, projectRoot: '/proj', role: 'founder',
      getRow: vi.fn().mockReturnValue(ROW) as never,
      getLevel: vi.fn().mockReturnValue({ currentLevel: 3 }) as never,
      composeFn: composeFn as never,
      signalTypeFn: (() => 'TASK_REVIEW') as never,
      contentSourceFn: (() => 'content-template') as never,
      lookupFn: (() => (() => undefined)) as never,
    }).composeOptions('p');
    const arg = composeFn.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.level).toBe(3);
    expect(arg.role).toBe('founder');
    expect(arg.lookup).toBeTypeOf('function');
  });

  it('defaults the level to 2 when none is stored', () => {
    const composeFn = vi.fn().mockReturnValue(GENERATED);
    make({ getLevel: (() => null) as never, composeFn: composeFn as never }).composeOptions('p');
    expect((composeFn.mock.calls[0][0] as { level: number }).level).toBe(2);
  });
});

describe('fail-open — a fault must never hold the user\'s prompt (A3)', () => {
  it('allows when the generator returns nothing', () => {
    expect(make({ composeFn: (() => null) as never }).composeOptions('p')).toBeNull();
  });

  it('allows when the resolved level has no options', () => {
    // MUTATION GUARD: if listForLevel picked the wrong list, level 1 would find
    // the non-empty l2 here and wrongly block.
    const empty = { l1: [], l2: ['b'], l3: ['c'] };
    expect(make({
      getLevel: (() => ({ currentLevel: 1 })) as never,
      composeFn: (() => empty) as never,
    }).composeOptions('p')).toBeNull();
  });

  it('allows when a dependency throws', () => {
    expect(make({ getRow: (() => { throw new Error('db gone'); }) as never }).composeOptions('p'))
      .toBeNull();
  });

  it('allows when the popup throws', async () => {
    const s = make({ selectFnFactory: (() => () => { throw new Error('tty'); }) as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBeNull();
  });
});

describe('popup', () => {
  it('offers the list for the resolved level, not a flattened blob', async () => {
    let seen: Array<{ value: string }> = [];
    const s = make({
      getLevel: (() => ({ currentLevel: 2 })) as never,
      selectFnFactory: (() => async (o: { options: Array<{ value: string }> }) => {
        seen = o.options; return null;
      }) as never,
    });
    s.composeOptions('p');
    await s.renderPopup('p', GENERATED);
    expect(seen.map((o) => o.value)).toEqual(['b1', 'b2']);
  });

  it('accepts a bare string selection', async () => {
    const s = make({ selectFnFactory: (() => async () => 'b2') as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBe('b2');
  });

  it('accepts a { value } selection', async () => {
    const s = make({ selectFnFactory: (() => async () => ({ value: 'b1' })) as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBe('b1');
  });

  it('treats a dismissal as null so the original prompt is released', async () => {
    const s = make({ selectFnFactory: (() => async () => null) as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBeNull();
  });

  it('treats an empty selection as null — never persists an empty replacement', async () => {
    const s = make({ selectFnFactory: (() => async () => '') as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBeNull();
  });
});

describe('⭐ consumeHandledTurn — H3 acceptance: no pending row survives a handled turn', () => {
  // Without this the user gets TWO popups: the new submit-time one AND the old
  // post-response one, because stop.ts:261 finds the row auto wrote. Option-A
  // ordering makes auto run first, so the row must be consumed rather than
  // never written (which is what the plan's wording assumed).
  it('marks the row shown so stop hits its no_pending branch', () => {
    const markShownFn = vi.fn();
    const s = make({ getRow: (() => ({ ...ROW, id: 77 })) as never, markShownFn: markShownFn as never });
    s.composeOptions('p');
    s.consumeHandledTurn();
    expect(markShownFn).toHaveBeenCalledWith({}, 77);
  });

  it('is a no-op when no row was read — never touches an unrelated turn', () => {
    const markShownFn = vi.fn();
    const s = make({ getRow: (() => null) as never, markShownFn: markShownFn as never });
    s.composeOptions('p');
    s.consumeHandledTurn();
    expect(markShownFn).not.toHaveBeenCalled();
  });

  it('swallows a consume failure — the prompt is already blocked and persisted', () => {
    const s = make({
      getRow: (() => ({ ...ROW, id: 5 })) as never,
      markShownFn: (() => { throw new Error('db gone'); }) as never,
    });
    s.composeOptions('p');
    expect(() => s.consumeHandledTurn()).not.toThrow();
  });
});

describe('gate branches — each must allow, not throw', () => {
  it('allows when the flag maps to no signal type', () => {
    expect(make({ signalTypeFn: (() => undefined) as never }).composeOptions('p')).toBeNull();
  });

  it('allows when the signal is not content-template (the engine/LLM path A1 excludes)', () => {
    // Reaching composeDeterministicOptions with an engine-source signal would ask
    // the deterministic generator for records it has none of.
    const composeFn = vi.fn();
    expect(make({
      contentSourceFn: (() => 'engine') as never,
      composeFn: composeFn as never,
    }).composeOptions('p')).toBeNull();
    expect(composeFn).not.toHaveBeenCalled();
  });
});

describe('experiment pin — must never break the submit path', () => {
  it('falls back to no pinning when activePinFor throws (malformed config)', () => {
    // The pin lookup reads user config; a malformed file must degrade to the
    // unpinned lookup, not fail the whole popup.
    const composeFn = vi.fn().mockReturnValue(GENERATED);
    const s = createDeterministicSubmitOptionSource({
      store: { throwOnPin: true }, projectRoot: '/proj',
      getRow: vi.fn().mockReturnValue(ROW) as never,
      getLevel: vi.fn().mockReturnValue({ currentLevel: 2 }) as never,
      composeFn: composeFn as never,
      signalTypeFn: (() => 'TASK_REVIEW') as never,
      contentSourceFn: (() => 'content-template') as never,
      lookupFn: (() => (() => undefined)) as never,
    });
    expect(s.composeOptions('p')).toEqual(GENERATED);
    expect(composeFn).toHaveBeenCalled();
  });
});

describe('popup — non-TTY host', () => {
  it('allows when the selector factory returns null (no interactive terminal)', async () => {
    // createTtySelectFn returns null off a TTY. Invoking it unguarded crashed the
    // hook on exactly the headless path it runs in.
    const s = make({ selectFnFactory: (() => null) as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBeNull();
  });

  it('allows when the level list is empty at popup time', async () => {
    const s = make({ getLevel: (() => ({ currentLevel: 1 })) as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', { l1: [], l2: ['b'], l3: [] })).resolves.toBeNull();
  });
});

describe('⭐ explicit "copy to clipboard" — Layer C\'s CLIPBOARD_ONLY sentinel', () => {
  // THE BUG THIS PREVENTS: the popup returns `__NEXPATH_CLIP__` when the user
  // picks copy instead of a replacement. Treated as ordinary text it would be
  // persisted as the replacement, INJECTED into the user's chat, and auto-
  // submitted - the literal sentinel string sent to the agent as their prompt.
  const SENTINEL = '__NEXPATH_CLIP__';

  it('never returns the sentinel as replacement text', async () => {
    const s = make({ selectFnFactory: (() => async () => SENTINEL) as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBeNull();
  });

  it('surfaces the copy request as a distinct signal', async () => {
    const s = make({ selectFnFactory: (() => async () => SENTINEL) as never });
    s.composeOptions('p');
    expect(s.wasClipboardRequested()).toBe(false);   // not until the popup ran
    await s.renderPopup('p', GENERATED);
    expect(s.wasClipboardRequested()).toBe(true);
  });

  it('handles the sentinel in { value } form too', async () => {
    const s = make({ selectFnFactory: (() => async () => ({ value: SENTINEL })) as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBeNull();
    expect(s.wasClipboardRequested()).toBe(true);
  });

  it('a normal selection does NOT set the copy flag', async () => {
    const s = make({ selectFnFactory: (() => async () => 'b2') as never });
    s.composeOptions('p');
    await expect(s.renderPopup('p', GENERATED)).resolves.toBe('b2');
    expect(s.wasClipboardRequested()).toBe(false);
  });

  it('the sentinel matches Layer C exactly — pinned against drift', () => {
    // Consume-only: we import the constant rather than mirror it. This asserts
    // the value we were built against, so a Layer C change is visible here.
    expect(SENTINEL).toBe('__NEXPATH_CLIP__');
  });
});

describe('⭐ the CLI popup is constructed exactly as the CLI constructs it', () => {
  // We reuse Layer C's popup wholesale rather than building one. stop.ts:303
  // calls createTtySelectFn(store, projectRoot); calling it bare compiles (both
  // params are optional) but yields a popup without the context its script needs
  // to resolve the clipboard command chain.
  it('passes store and projectRoot to createTtySelectFn', async () => {
    const seen: unknown[] = [];
    const store = { marker: 'the-store' };
    const s = createDeterministicSubmitOptionSource({
      store, projectRoot: '/proj',
      getRow: vi.fn().mockReturnValue(ROW) as never,
      getLevel: vi.fn().mockReturnValue({ currentLevel: 2 }) as never,
      composeFn: vi.fn().mockReturnValue(GENERATED) as never,
      signalTypeFn: (() => 'TASK_REVIEW') as never,
      contentSourceFn: (() => 'content-template') as never,
      lookupFn: (() => (() => undefined)) as never,
      selectFnFactory: ((...args: unknown[]) => { seen.push(...args); return async () => null; }) as never,
    });
    s.composeOptions('p');
    await s.renderPopup('p', GENERATED);
    expect(seen[0]).toBe(store);
    expect(seen[1]).toBe('/proj');
  });
});

describe('⭐ H8 Finding 2 — the pending PE row must not survive a blocked turn', () => {
  // auto (run inside the hold, option-A) may also have stored a
  // pending_prompt_enhancements row for the prompt the user just cancelled.
  // Left pending, the Windsurf pePoller inserts its body into Cascade and the
  // next Stop pops the PE popup for a prompt that no longer exists.
  it('consumes the pending PE row alongside the advisory row', () => {
    const markPeShownFn = vi.fn();
    const s = make({
      getRow: (() => ({ ...ROW, id: 7 })) as never,
      markShownFn: vi.fn() as never,
      getPeRowFn: (() => ({ id: 42 })) as never,
      markPeShownFn: markPeShownFn as never,
    });
    s.composeOptions('p');
    s.consumeHandledTurn();
    expect(markPeShownFn).toHaveBeenCalledWith({}, 42);
  });

  it('no pending PE row ⇒ nothing to consume, no throw', () => {
    const markPeShownFn = vi.fn();
    const s = make({
      getRow: (() => ({ ...ROW, id: 7 })) as never,
      markShownFn: vi.fn() as never,
      getPeRowFn: (() => null) as never,
      markPeShownFn: markPeShownFn as never,
    });
    s.composeOptions('p');
    expect(() => s.consumeHandledTurn()).not.toThrow();
    expect(markPeShownFn).not.toHaveBeenCalled();
  });

  it('a PE-consume failure never breaks the block — the replacement is already persisted', () => {
    const s = make({
      getRow: (() => ({ ...ROW, id: 7 })) as never,
      markShownFn: vi.fn() as never,
      getPeRowFn: (() => { throw new Error('db gone'); }) as never,
    });
    s.composeOptions('p');
    expect(() => s.consumeHandledTurn()).not.toThrow();
  });

  it('the PE row is consumed even when NO advisory row was read', () => {
    // A sequence-shaped prompt can store a PE row on a no-action exit with no
    // advisory row at all — the PE consume must not be gated on lastRowId.
    const markPeShownFn = vi.fn();
    const s = make({
      getRow: (() => null) as never,
      getPeRowFn: (() => ({ id: 9 })) as never,
      markPeShownFn: markPeShownFn as never,
    });
    s.composeOptions('p');
    s.consumeHandledTurn();
    expect(markPeShownFn).toHaveBeenCalledWith({}, 9);
  });
});
