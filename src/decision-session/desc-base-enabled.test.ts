import { describe, expect, it } from 'vitest';
import { applyRuntimeSubstitutionsAllLevels } from './runtime-substitutions.js';
import type { DecisionContent } from './options.js';

// The per-set opt-out SOURCE scan (every static DecisionContent set carried
// desc-bases and none set `descBaseEnabled: false`) retired with the B11 cutover:
// the static cascade is gone and the ContentTemplateRecord set carries no
// descBaseEnabled field, so a record cannot silently disable its desc-base. The
// capability itself is still honoured at runtime — pinned by the consumer test below.

// The runtime consumer of the capability flag: the desc-base pipeline skips
// processing when a set declares descBaseEnabled === false, and runs normally
// when it is omitted (default) or true.
describe('descBaseEnabled — runtime consumer (capability-check)', () => {
  function content(descBaseEnabled: boolean | undefined): DecisionContent {
    const base: DecisionContent = {
      signalType:    'TASK_REVIEW',
      question:      'q',
      pinchFallback: 'p',
      L1: [{ option: 'o1', descBase: 'Static desc-base line one.' }],
      L2: [{ option: 'o2', descBase: 'Static desc-base line two.' }],
      L3: [{ option: 'o3', descBase: 'Static desc-base line three.' }],
    };
    return descBaseEnabled === undefined ? base : { ...base, descBaseEnabled };
  }
  const generated = { l1: ['o1'], l2: ['o2'], l3: ['o3'] };

  it('descBaseEnabled === false → pipeline skipped, desc-bases emitted empty (options preserved)', async () => {
    const out = await applyRuntimeSubstitutionsAllLevels(generated, content(false), [], 'TASK_REVIEW', 'casual');
    expect(out.l1[0]).toEqual({ option: 'o1', descBase: '' });
    expect(out.l2[0].descBase).toBe('');
    expect(out.l3[0].descBase).toBe('');
  });

  it('descBaseEnabled omitted (default) → pipeline runs, desc-base is non-empty', async () => {
    const out = await applyRuntimeSubstitutionsAllLevels(generated, content(undefined), [], 'TASK_REVIEW', 'casual');
    expect(out.l1[0].option).toBe('o1');
    expect(out.l1[0].descBase).not.toBe(''); // pipeline produced a desc-base
  });

  it('descBaseEnabled === true → pipeline runs (same as default)', async () => {
    const out = await applyRuntimeSubstitutionsAllLevels(generated, content(true), [], 'TASK_REVIEW', 'casual');
    expect(out.l1[0].descBase).not.toBe('');
  });
});
