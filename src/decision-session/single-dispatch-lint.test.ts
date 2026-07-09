import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// §6.1 S7 — single-dispatch selection invariant. After the B11 cutover the static
// DecisionContent cascade is gone: content selection happens in ONE place, the
// selection registry (`selection-registry.ts`), and the ContentTemplateRecord set +
// engine ARE the content layer. This lint pins that end-state — the register/source
// dispatch lives only in the registry, the legacy cascade selectors + resolvers no
// longer exist anywhere, and no new selection-dispatch helper has crept in. It
// resolves the routing-standard violation (isVibe + selectAbsenceMap split) and the
// Routing-Refactor reminder.

const DIR = dirname(fileURLToPath(import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const read = (f: string) => readFileSync(join(DIR, f), 'utf-8');
const definers = (id: string) =>
  SOURCES.filter((f) => new RegExp(`(?:export\\s+)?(?:function|const)\\s+${id}\\b`).test(read(f)));

describe('§6.1 S7 — single-dispatch selection invariant', () => {
  it('the register/source selection dispatch is defined ONLY in the selection registry', () => {
    for (const id of ['selectionRegister', 'resolveContentSource']) {
      expect(definers(id), `${id} definers`).toEqual(['selection-registry.ts']);
    }
  });

  it('the legacy static cascade selectors + resolvers are fully removed by the migration', () => {
    // The B11 cutover deleted the static DecisionContent layer and its dispatch.
    // NONE of these symbols may be defined anywhere any more — the record set + engine
    // are the sole content source, resolved through the registry.
    for (const id of [
      'resolveSelection', 'resolveDecisionContent', 'selectAbsenceMap',
      'selectRoleAbsenceMap', 'selectNonBeginnerVariant', 'resolveSkippedTransitionContent',
    ]) {
      expect(definers(id), `${id} must no longer be defined`).toEqual([]);
    }
  });

  it('no content-selection dispatch helper is defined outside the selection registry', () => {
    // Content-selection naming family (register/role/nature/absence/transition dispatch) —
    // NOT generic utilities like selectRankCapFacts (grounding-fact ranking, not selection).
    const SELECTION_DISPATCH = /(?:export\s+)?function\s+(select(?:ion)?(?:Absence|Role|Register|NonBeginner|Beginner|Content|Vibe|Nature|Transition|Map)\w*)/g;
    const allowed = new Set(['selection-registry.ts']);
    const offenders: string[] = [];
    for (const f of SOURCES) {
      if (allowed.has(f)) continue;
      const m = read(f).match(SELECTION_DISPATCH);
      if (m) offenders.push(`${f}: ${m.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
