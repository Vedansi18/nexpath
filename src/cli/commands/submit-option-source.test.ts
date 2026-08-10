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
