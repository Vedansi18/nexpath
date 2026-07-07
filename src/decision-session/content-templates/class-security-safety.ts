/**
 * Security / safety content-template records.
 *
 * A new cluster of security/safety signals from the mistake-category registry (§3.F),
 * distinct from the CTA-C1 classes 1–9. Each is a NEW signal with no legacy shipped
 * headline, so ALL five maturity columns are authored fresh — there is no frozen col-3
 * anchor, and col-3 is subject to the same authoring gates as the other columns. Sensitive
 * records are marked `l2SafeguardRequired` and carry an action-specific `l2SafeguardLine`;
 * the engine appends it as the last line of whichever column is served.
 *
 * No record echoes a literal sensitive value — the content is static (never carries prompt
 * text), and the fire-time grounding runs the secret/PII sanitize gate.
 */

import type { ContentTemplateRecord, LevelForm, ParamAxisTag } from '../content-template-schema.js';
import {
  SECRET_IN_PROMPT_BEGINNER_OVERRIDE,
  NO_VERSION_CONTROL_BEGINNER_OVERRIDE,
} from './class-security-safety-beginner.js';

function form(option: string, whyDesc: string): LevelForm {
  return { kind: 'slot-variant', cell: { option, whyDesc } };
}

/** The param axes a security/safety why-desc grounds (the same generic sources as the other classes). */
export const SECURITY_SAFETY_PARAM_AXES: Readonly<Record<string, ParamAxisTag>> = {
  workflow_pattern: 'extensible',
  decision_making_rhythm: 'closed-ordinal',
  explanation_learning_depth: 'closed-ordinal',
  abstraction_level_orientation: 'closed-ordinal',
  project_framework: 'open',
};

/**
 * ABSENCE_SECRET_IN_PROMPT — a real secret/credential was pasted into a prompt (a LEAKAGE
 * EVENT), keyword "secret". Sensitive: the response rotates the exposed secret and scrubs it
 * from history → `l2SafeguardRequired` + a rotation/history-rewrite safeguard line. This is
 * the REACTIVE "treat the exposed secret as compromised" response — deliberately distinct
 * from ABSENCE_ENV_AND_SECRETS (proactive secrets-storage hygiene: don't hardcode, use env
 * vars, `.env.example`, rotation policy), which it never restates.
 */
export const ABSENCE_SECRET_IN_PROMPT_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_SECRET_IN_PROMPT', source: 'shipped', schemaVersion: 1, slots: [],
  registerOverrides: { beginner: SECRET_IN_PROMPT_BEGINNER_OVERRIDE },
  paramAxes: SECURITY_SAFETY_PARAM_AXES, l2SafeguardRequired: true,
  l2SafeguardLine: 'Ask me for go-ahead before you rotate any keys or rewrite git history.',
  levelForms: {
    1: form("Rotate the secret that was just pasted into a prompt — treat it as compromised and replace it with a fresh one before continuing.", "The lightest step: the just-exposed secret rotated."),
    2: form("Rotate the exposed secret and clear it from the prompt and chat history — a pasted secret should be treated as leaked.", "A light pass: the secret rotated and cleared from the prompt."),
    3: form("Rotate the secret that was pasted, clear it from the prompt and history, and confirm it was not committed to source or written to a log — treat the exposure as a real leak.", "The pasted secret hasn't been rotated and cleared."),
    4: form("Rotate the exposed secret, scrub it from the prompt and history and anywhere else it may have landed (commits, logs), and move it into a proper store so it is never pasted again.", "Beyond rotating: the secret scrubbed from every place it may have leaked and moved out of reach."),
    5: form("Write a short incident note for the exposed secret: what it was for, that it was rotated, where it was scrubbed from, and the one change that prevents a secret being pasted again — kept out of source.", "A durable incident note of the leaked secret, its rotation, and the fix."),
  },
};

/**
 * ABSENCE_NO_VERSION_CONTROL — the project is not under version control, keyword "version".
 * MILD sensitivity: establishing version control (initialize, commit, ignore-list, remote,
 * workflow note) is non-destructive, so the record carries NO record-level safeguard — the
 * base advice never proposes a history-rewrite or force-push. Per the locked design, the L2
 * safeguard would attach ONLY to an option that touched history-rewrite/force-push; the ladder
 * here deliberately contains none, so no option is an L2 trigger and the record is unflagged
 * (verified by the A4 no-destructive-action test).
 */
export const ABSENCE_NO_VERSION_CONTROL_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_NO_VERSION_CONTROL', source: 'shipped', schemaVersion: 1, slots: [],
  registerOverrides: { beginner: NO_VERSION_CONTROL_BEGINNER_OVERRIDE },
  paramAxes: SECURITY_SAFETY_PARAM_AXES,
  levelForms: {
    1: form("Set up version control for this project — initialize a git repository so the work is tracked from here on.", "The lightest step: the project put under version control."),
    2: form("Put the project under version control and make the first commit, so a known-good version is saved and the work can be brought back to it.", "A light pass: version control started and the first version committed."),
    3: form("Put the project under version control properly: initialize the repository, make a first commit, and add a .gitignore so generated files and local-only config stay out of the tracked version.", "The project isn't under version control with a clean ignore list yet."),
    4: form("Put the project under version control with a working rhythm: initialize the repo, commit in small logical steps, keep a .gitignore current, and connect a remote so every version lives off this machine too.", "Beyond a local repo: a commit rhythm and an off-machine copy of every version."),
    5: form("Write a short version-control note for the project: how to commit, the branch and commit-message convention, and what stays out of the tracked version — kept with the project so the rhythm is repeatable.", "A durable version-control note of the commit rhythm and conventions."),
  },
};

/** All security/safety records (grows as A5–A7 add NO_BACKUP_SAFETY / NO_SEPARATE_ENVS / NO_AUTOMATED_SECURITY_SCANNING). */
export const CLASS_SECURITY_SAFETY_RECORDS: readonly ContentTemplateRecord[] = [
  ABSENCE_SECRET_IN_PROMPT_RECORD,
  ABSENCE_NO_VERSION_CONTROL_RECORD,
];
