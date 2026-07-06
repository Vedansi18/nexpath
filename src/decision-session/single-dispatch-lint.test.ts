import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// §6.1 S7 — single-dispatch selection invariant. Content selection happens in ONE
// place: the selection registry (`selection-registry.ts`). The legacy cascade
// selectors are grandfathered in `options.ts` (the migration removes them). No NEW
// selection-dispatch helper may appear anywhere else — this resolves the routing-
// standard violation (isVibe + selectAbsenceMap split) and the Routing-Refactor reminder.

const DIR = dirname(fileURLToPath(import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const read = (f: string) => readFileSync(join(DIR, f), 'utf-8');
const definers = (id: string) =>
  SOURCES.filter((f) => new RegExp(`(?:export\\s+)?(?:function|const)\\s+${id}\\b`).test(read(f)));

describe('§6.1 S7 — single-dispatch selection invariant', () => {
  it('the register/source selection dispatch is defined ONLY in the selection registry', () => {
    for (const id of ['selectionRegister', 'resolveSelection', 'resolveContentSource']) {
      expect(definers(id), `${id} definers`).toEqual(['selection-registry.ts']);
    }
  });

  it('the legacy cascade selectors live ONLY in options.ts (grandfathered; migration removes them)', () => {
    for (const id of ['selectAbsenceMap', 'selectRoleAbsenceMap', 'selectNonBeginnerVariant']) {
      expect(definers(id), `${id} definers`).toEqual(['options.ts']);
    }
  });

  it('no NEW content-selection dispatch helper is defined outside the registry + the grandfathered cascade', () => {
    // Content-selection naming family (register/role/nature/absence/transition dispatch) —
    // NOT generic utilities like selectRankCapFacts (grounding-fact ranking, not selection).
    const SELECTION_DISPATCH = /(?:export\s+)?function\s+(select(?:ion)?(?:Absence|Role|Register|NonBeginner|Beginner|Content|Vibe|Nature|Transition|Map)\w*)/g;
    const allowed = new Set(['selection-registry.ts', 'options.ts']);
    const offenders: string[] = [];
    for (const f of SOURCES) {
      if (allowed.has(f)) continue;
      const m = read(f).match(SELECTION_DISPATCH);
      if (m) offenders.push(`${f}: ${m.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
