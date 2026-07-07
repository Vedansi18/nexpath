/**
 * Mood / meta content-template records.
 *
 * A distinct register from the technical signals (classes 1–9 + security/safety): these advise on
 * the user's WORKING STATE, not a code artifact. ABSENCE_FRUSTRATION_SPIRAL fires on a stuck,
 * repeating stretch of prompts — the advice is to pause and break the loop, in an EMPATHETIC tone
 * (step back / a smaller next step), never condescending or clinical, never "you're doing it
 * wrong." No sensitive action → NO L2 safeguard (no l2SafeguardRequired, no option is an L2
 * trigger). No prompt-derived literal reaches the CA-bound why-desc — the record is static and the
 * fire-time grounding runs the secret/PII sanitize gate.
 */

import type { ContentTemplateRecord, LevelForm, ParamAxisTag } from '../content-template-schema.js';
import { FRUSTRATION_SPIRAL_BEGINNER_OVERRIDE } from './class-mood-meta-beginner.js';

function form(option: string, whyDesc: string): LevelForm {
  return { kind: 'slot-variant', cell: { option, whyDesc } };
}

/** The param axes a mood/meta why-desc grounds (the same generic sources as the other classes). */
export const MOOD_META_PARAM_AXES: Readonly<Record<string, ParamAxisTag>> = {
  workflow_pattern: 'extensible',
  decision_making_rhythm: 'closed-ordinal',
  explanation_learning_depth: 'closed-ordinal',
  abstraction_level_orientation: 'closed-ordinal',
  project_framework: 'open',
};

/**
 * ABSENCE_FRUSTRATION_SPIRAL — a stuck, repeating stretch of prompts, keyword "pause". Mood/meta,
 * NOT security: empathetic tone, no L2 safeguard, no sensitive action. The ladder escalates the
 * amount of structure in the reset (a breath → a recap → the real blocker + one small step → a
 * different angle or a break → a written note to return to fresh).
 */
export const ABSENCE_FRUSTRATION_SPIRAL_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_FRUSTRATION_SPIRAL', source: 'shipped', schemaVersion: 1, slots: [],
  question: 'This has been a stuck stretch — want to pause and reset before continuing?',
  registerOverrides: { beginner: FRUSTRATION_SPIRAL_BEGINNER_OVERRIDE },
  paramAxes: MOOD_META_PARAM_AXES,
  levelForms: {
    1: form("Let me pause here — hold off on the next change for a moment; we've been going in circles and a quick pause will reset things.", "The lightest step: a pause to stop going in circles."),
    2: form("Let me pause and reset — recap what we've already tried on this so far and what still isn't working, so we're not repeating the same attempts.", "A light pause: a recap of what's been tried, to stop repeating attempts."),
    3: form("Let me pause and take stock — recap what we've tried, name the one thing that's actually blocking progress, and pick a single small next step instead of pushing on everything at once.", "A fuller pause: the real blocker named and one small next step chosen."),
    4: form("Let me pause and change approach — recap what's been tried, name the real blocker, and either try a genuinely different angle on it or set it down for a short break and come back fresh.", "Beyond a recap: a pause to shift the angle on the blocker, or take a short break."),
    5: form("Let me pause and write down where this stands: what we've tried, the one thing still blocking it, the single next step to try, and a point to step away and return fresh — so I come back to a clear plan instead of the loop.", "A durable pause: a short note of where things stand and the one next step, to return to fresh."),
  },
};

/** All mood/meta records. */
export const CLASS_MOOD_META_RECORDS: readonly ContentTemplateRecord[] = [
  ABSENCE_FRUSTRATION_SPIRAL_RECORD,
];
