import { describe, it, expect } from 'vitest';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { composeOption, composeWhyDesc, resolveRecord } from './content-template-engine.js';
import { substituteCAFacingBookend } from './r4-bookends.js';
import type { MaturityLevel } from './content-template-schema.js';

// §6.1 S5 — the content-template ↔ runtime slot-grammar contract. Every shipped
// content-template MUST compose into descBase/option text that the runtime slot
// grammar ({R4_OPEN}/{R4_CLOSE}/{R5_INJECT}) can process; a malformed record is
// rejected by the source cascade so the caller falls back to the static D-fallback.

const LEVELS: MaturityLevel[] = [1, 2, 3, 4, 5];
const UNFILLED_SLOT = /\{\{[^}]*\}\}/;                        // a composition slot compose left unfilled
const MALFORMED_R = /\{R(?!4_OPEN\}|4_CLOSE\}|5_INJECT:)/;    // a runtime {R... token that is not well-formed

describe('§6.1 S5 — content-template ↔ runtime contract', () => {
  it('every shipped record × authored level composes clean, runtime-grammar-safe text', () => {
    for (const record of SHIPPED_CONTENT_TEMPLATES) {
      for (const level of LEVELS) {
        const form = record.levelForms[level];
        if (!form) continue; // sparse — only authored levels
        const option = composeOption({ cell: form.cell, slots: record.slots });
        const whyDesc = composeWhyDesc({ cell: form.cell, slots: record.slots });
        expect(option.length, `${record.signalType} L${level} option`).toBeGreaterThan(0);
        expect(whyDesc.length, `${record.signalType} L${level} whyDesc`).toBeGreaterThan(0);
        expect(option, `${record.signalType} L${level} option unfilled slot`).not.toMatch(UNFILLED_SLOT);
        expect(whyDesc, `${record.signalType} L${level} whyDesc unfilled slot`).not.toMatch(UNFILLED_SLOT);
        expect(option, `${record.signalType} L${level} option malformed {R`).not.toMatch(MALFORMED_R);
        expect(whyDesc, `${record.signalType} L${level} whyDesc malformed {R`).not.toMatch(MALFORMED_R);
      }
    }
  });

  it('composed why-desc round-trips through the R4 runtime pass (no stray {R4_...} left)', () => {
    for (const record of SHIPPED_CONTENT_TEMPLATES) {
      const form = record.levelForms[1]!; // level-1 floor is guaranteed
      const injected = substituteCAFacingBookend(composeWhyDesc({ cell: form.cell, slots: record.slots }));
      expect(injected).not.toContain('{R4_OPEN}');
      expect(injected).not.toContain('{R4_CLOSE}');
    }
  });

  it('a malformed record is rejected by the source cascade → resolveRecord null (→ static D-fallback)', () => {
    const bad = { signalType: 'x', source: 'shipped', schemaVersion: 1, slots: [], levelForms: {} }; // no level-1 floor
    expect(resolveRecord((source) => (source === 'shipped' ? bad : undefined))).toBeNull();
  });
});
