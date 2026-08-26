// The WORK half of the no-invention rule — the MID band's supply side.
//
// 🔴 MEASURED, Session A (`2026-08-26_00-42-22_Pc1_sim-s12.log`, 8 bodies, 36 labelled lines).
// Invented NAMES collapsed over this milestone — 1.3 → 0.125 violations per body — but the middle
// band rose, 0.7 → 0.75/0.875, and it was the only number that moved the wrong way. Every line in it
// obeyed the noun rule perfectly and still enlarged the job:
//
//   · "Gather feedback from the classmate … to ensure satisfaction"  (prompt: a button overlaps)
//   · "the system logs these actions appropriately"                  (prompt: where are uploads kept)
//   · "Document the results to showcase the deployment's success"    (prompt: how do I deploy)
//
// Hiren's ruling is the shape of the fix: *"never the harmful things … but some of those things that
// fall in between of harmful → natural craft … those middle things can sometime irritate users."*
// Adding work is the middle. Sequencing and verifying the developer's OWN ask is the craft.
//
// ⛔ Rollback and recovery stay allowed on purpose. They are the risk section's own job, and a rule
// that silenced them would trade an irritation for a safety gap.
import { describe, it, expect } from 'vitest';
import { SLOT_OBLIGATION_DIRECTIVES_V1 } from './section-obligation-directives.js';

const directive = SLOT_OBLIGATION_DIRECTIVES_V1.no_invention_state;

describe('no_invention_state covers work, not only names', () => {
  it('still carries the NAME half unchanged', () => {
    // The half that was already working stays exactly as it was — this addition is additive.
    expect(directive).toContain('name only tools, libraries, services, files, APIs or project facts');
    expect(directive).toContain('never supply an example name');
  });

  it('names the added-work classes the measurement actually found', () => {
    // Each of these was a real MID line's shape, not a hypothetical.
    for (const banned of ['feedback rounds', 'user testing', 'documentation', 'logging', 'approvals', 'sign-offs']) {
      expect(directive, `missing: ${banned}`).toContain(banned);
    }
    expect(directive).toContain('never add tasks they did not ask for');
  });

  it('does NOT suppress rollback, recovery, sequencing or verification', () => {
    // The carve-out is the point: three of Hiren's ruled-welcome classes must survive the rule.
    // A regression here would be worse than the irritation it was written to remove.
    expect(directive).toContain('rollback or recovery');
    expect(directive).toContain('Sequencing, verifying');
    for (const allowed of ['rollback', 'recovery', 'Sequencing', 'verifying']) {
      expect(directive).not.toContain(`no extra ${allowed}`);
    }
  });
});
