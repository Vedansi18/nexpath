// Voice-rule invariant test for option text content.
//
// Scope: every served option + why-desc string across all content-template
// records — base, every register variant (formal / casual / beginner), and
// every role variant (founder / indie_hacker / pm) — plus each record's
// l2SafeguardLine (it is appended to the CA-bound why-desc).
// Excluded: the popup question / pinchFallback (user-facing pinch-UI labels,
// not sent to the agent as user messages) — they live outside the record cells.
//
// After the B11 cutover the content lives in the ContentTemplateRecord set, not
// the retired static DecisionContent cascade, so the invariant scans the records
// directly (a stronger check than the old source-text scan: it exercises the
// resolver across every register × role the engine can serve). The per-record
// checkVoice gate covers most phrases; this file enforces the FULL 12-phrase
// banned-pattern list in one place, catching regressions regardless of which
// record or variant is modified.

import { describe, expect, it } from 'vitest';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { resolveRegisterForms } from './content-template-engine.js';

// 12 unambiguous literal banned-pattern phrases. Each is a case-insensitive
// substring match.
//
// Two patterns from the source banned-list (`it says` / `it finds`) are
// explicitly marked context-sensitive ("where 'it' = AI") and are NOT
// included as bare literals — they can legitimately appear with a clear
// non-AI referent. Semantic audits catch the AI-referent forms; the literal
// CI invariant covers the 12 phrases that have no reasonable non-AI reading.
const BANNED_PATTERNS: ReadonlyArray<{ pattern: string; desc: string }> = [
  { pattern: 'the AI',           desc: 'third-person AI reference' },
  { pattern: 'Ask the AI',       desc: 'third-person directive to AI' },
  { pattern: 'Have the AI',      desc: 'third-person directive to AI' },
  { pattern: 'Get the AI',       desc: 'third-person directive to AI' },
  { pattern: 'Instruct the AI',  desc: 'third-person directive to AI' },
  { pattern: 'Claude',           desc: 'third-person AI reference (model name)' },
  { pattern: 'the assistant',    desc: 'third-person AI reference' },
  { pattern: 'its answer',       desc: 'third-person possessive for AI output' },
  { pattern: 'its output',       desc: 'third-person possessive for AI output' },
  { pattern: 'this option',      desc: 'third-person self-reference (prompt-as-object)' },
  { pattern: 'the action below', desc: 'third-person self-reference' },
  { pattern: 'the prompt above', desc: 'third-person self-reference' },
];

const REGISTERS = [undefined, 'formal', 'casual', 'beginner'] as const;
const ROLES     = [undefined, 'founder', 'indie_hacker', 'pm'] as const;

// Every served option + why-desc string, tagged with where it came from.
function collectStrings(): { setName: string; where: string; text: string }[] {
  const out: { setName: string; where: string; text: string }[] = [];
  for (const rec of SHIPPED_CONTENT_TEMPLATES) {
    for (const register of REGISTERS) {
      for (const role of ROLES) {
        const forms = resolveRegisterForms(rec, register, role);
        for (const lvl of [1, 2, 3, 4, 5] as const) {
          const cell = forms[lvl]?.cell;
          if (!cell) continue;
          const tag = `${register ?? 'base'}/${role ?? 'norole'}/L${lvl}`;
          out.push({ setName: rec.signalType, where: `${tag}.option`,  text: cell.option });
          out.push({ setName: rec.signalType, where: `${tag}.whyDesc`, text: cell.whyDesc });
        }
      }
    }
    if (rec.l2SafeguardLine) {
      out.push({ setName: rec.signalType, where: 'l2SafeguardLine', text: rec.l2SafeguardLine });
    }
  }
  return out;
}

describe('Voice-rule invariant — 12 literal banned-pattern phrases (all served record content)', () => {
  const entries = collectStrings();

  it('collects a reasonable number of served strings (guard against a vacuous pass)', () => {
    expect(entries.length).toBeGreaterThan(500);
  });

  for (const { pattern, desc } of BANNED_PATTERNS) {
    it(`no served option / why-desc contains "${pattern}" (${desc})`, () => {
      const violations = entries.filter(({ text }) => text.toLowerCase().includes(pattern.toLowerCase()));
      if (violations.length > 0) {
        const detail = violations
          .slice(0, 8)
          .map((v) => `  ${v.setName} ${v.where}: ${v.text.slice(0, 120)}${v.text.length > 120 ? '...' : ''}`)
          .join('\n');
        const more = violations.length > 8 ? `\n  (${violations.length - 8} more not shown)` : '';
        throw new Error(`Found "${pattern}" in ${violations.length} served string(s):\n${detail}${more}`);
      }
    });
  }
});
