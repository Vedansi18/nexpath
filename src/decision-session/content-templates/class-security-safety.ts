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
  NO_BACKUP_SAFETY_BEGINNER_OVERRIDE,
  NO_SEPARATE_ENVS_BEGINNER_OVERRIDE,
  NO_AUTOMATED_SECURITY_SCANNING_BEGINNER_OVERRIDE,
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
  question: 'A secret was just pasted into a prompt — treat it as leaked and rotate it?',
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
  question: "This project isn't under version control yet — set that up?",
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

/**
 * ABSENCE_NO_BACKUP_SAFETY — the project has no backup / safety net, keyword "backup".
 * MILD data-sensitivity with a PER-OPTION safeguard. Standing up + scheduling a backup (cols
 * 1–2) is non-destructive → unguarded. Proving recovery means actually restoring, and a real
 * restore OVERWRITES the current data — the destructive-adjacent case the locked design says
 * MUST carry the L2 safeguard. So cols 3–5 propose the restore AND carry an action-named
 * confirm-seek; cols 1–2 (base "set up a backup" advice) do not.
 *
 * Placement note: the confirm-seek lives in BOTH channels of cols 3–5. The OPTION text is the
 * reliably-served copy — composeOption serves it verbatim, so the agent always sees it. The
 * why-desc carries it too, as the sensitive-action desc-base rule requires (the agent reads the
 * why-desc as the detailed explanation); that copy is best-effort served, since the LLM weave
 * can reword the why-desc — only a RECORD-level l2SafeguardLine survives the weave verbatim, and
 * a record-level line would wrongly guard the base cols 1–2 too, so it is not used here.
 */
export const ABSENCE_NO_BACKUP_SAFETY_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_NO_BACKUP_SAFETY', source: 'shipped', schemaVersion: 1, slots: [],
  question: "There's no backup or safety net for this project's data — add one?",
  registerOverrides: { beginner: NO_BACKUP_SAFETY_BEGINNER_OVERRIDE },
  paramAxes: SECURITY_SAFETY_PARAM_AXES,
  levelForms: {
    1: form("Set up a backup for this project's important data, so a copy exists if the original is ever lost.", "The lightest step: a backup of the important data exists."),
    2: form("Set up a backup and schedule it to run on its own regularly, so the saved copy stays current instead of going stale.", "A light pass: a backup that runs on a schedule."),
    3: form("Set up a scheduled backup, then prove recovery by restoring from it — a real restore overwrites the current data with the backed-up copy, so ask me for go-ahead before you run one.", "The backup hasn't been proven by a real restore, which overwrites existing data — ask me for go-ahead before running one."),
    4: form("Set up an automated backup with sensible retention, and prove recovery on a schedule with a periodic restore drill — a restore overwrites what's there now, so ask me for go-ahead before running it against live data.", "Beyond one backup: a scheduled restore drill. A restore overwrites the current data, so ask me for go-ahead before running it against live data."),
    5: form("Write a short backup-and-recovery runbook and rehearse a full restore from it: what is backed up, how often, and the recovery steps — and since a real recovery overwrites the current data, ask me for go-ahead before you run the restore.", "A durable backup-and-recovery runbook proven by a rehearsed restore — and since recovery overwrites the current data, ask me for go-ahead before running the restore."),
  },
};

/**
 * ABSENCE_NO_SEPARATE_ENVS — the project has no dev/staging/production separation, keyword
 * "environment". HIGH-RISK: standing up separate environments touches production and moves
 * environment credentials → RECORD-LEVEL `l2SafeguardRequired` + an action-named safeguard line
 * (the engine appends it to every served column). Deliberately about environment SEPARATION only
 * (stand up distinct environments with a promotion path) — never restating ABSENCE_ENV_AND_SECRETS'
 * secrets-storage hygiene (don't hardcode, use env vars, `.env.example`, rotation). No literal
 * environment or credential value is echoed — the record is static and the grounding runs the
 * secret/PII sanitize gate at fire time.
 */
export const ABSENCE_NO_SEPARATE_ENVS_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_NO_SEPARATE_ENVS', source: 'shipped', schemaVersion: 1, slots: [],
  question: "Dev, staging, and production aren't separated — stand up separate environments?",
  registerOverrides: { beginner: NO_SEPARATE_ENVS_BEGINNER_OVERRIDE },
  paramAxes: SECURITY_SAFETY_PARAM_AXES, l2SafeguardRequired: true,
  l2SafeguardLine: 'Ask me for go-ahead before you touch production or move any environment credentials.',
  levelForms: {
    1: form("Set up a separate environment for this project so changes can be tried before they reach the live one — today there is a single environment and every change goes straight to where users are.", "The lightest step: a second environment, kept apart from the live one."),
    2: form("Stand up a staging environment separate from production, and run changes there first — so a broken change is caught in staging instead of hitting production.", "A light pass: a staging environment that changes pass through before production."),
    3: form("Separate this project into distinct development, staging, and production environments, each with its own configuration, so work in one never disturbs another.", "Development, staging, and production aren't separated into their own environments yet."),
    4: form("Give the project a full environment separation with a promotion path — development to staging to production — where each environment is isolated and a change is promoted forward only after it holds up.", "Beyond a staging step: isolated environments with a promotion path from development to production."),
    5: form("Write a short environments note for the project: what development, staging, and production are each for, how a change is promoted between them, and what keeps them isolated — kept with the project.", "A durable environments note of the separation and the promotion path."),
  },
};

/**
 * ABSENCE_NO_AUTOMATED_SECURITY_SCANNING — the project has no automated security scanning,
 * keyword "scan". HIGH-RISK: acting on scan results means installing/upgrading dependencies and
 * changing the CI/deploy config → RECORD-LEVEL `l2SafeguardRequired` + an action-named safeguard
 * line (the engine appends it to every served column). Heavily de-jargoned: the plain action
 * leads ("scan the dependencies for known problems"), and SAST/CVE/CI appear ONLY as an optional
 * trailing parenthetical. No literal dependency/credential value is echoed — static record + the
 * fire-time secret/PII sanitize gate.
 */
export const ABSENCE_NO_AUTOMATED_SECURITY_SCANNING_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING', source: 'shipped', schemaVersion: 1, slots: [],
  question: 'No automated security scanning is set up — add a dependency/code scan?',
  registerOverrides: { beginner: NO_AUTOMATED_SECURITY_SCANNING_BEGINNER_OVERRIDE },
  paramAxes: SECURITY_SAFETY_PARAM_AXES, l2SafeguardRequired: true,
  l2SafeguardLine: 'Ask me for go-ahead before you install or upgrade dependencies or change the CI/deploy config.',
  levelForms: {
    1: form("Set up an automatic scan that flags known security problems in this project's dependencies, so a risky package is caught early.", "The lightest step: a scan that flags known-vulnerable dependencies."),
    2: form("Add a security scan that runs on its own and reports known problems in the dependencies, and review what the scan finds before shipping.", "A light pass: a scan of the dependencies for known security problems."),
    3: form("Set up automatic security scanning for this project: a scan of the dependencies for known problems (a SAST or dependency-vulnerability scan), run on every change, with a plan to upgrade anything the scan flags.", "Automatic security scanning of the dependencies isn't running on each change yet."),
    4: form("Wire security scanning into the project's automatic checks so a dependency scan and a code scan run on every change, and make a serious finding block the change until the finding is resolved.", "Beyond a manual scan: scanning wired into the automatic checks, blocking serious findings."),
    5: form("Write a short security-scanning note for the project: what is scanned (dependencies and code), how often the scan runs, and how a serious finding is handled — kept with the project.", "A durable security-scanning note of what is scanned and how findings are handled."),
  },
};

/** All security/safety records (A3, A4, A5, A6, A7 authored; A8 FRUSTRATION_SPIRAL → class-mood-meta.ts). */
export const CLASS_SECURITY_SAFETY_RECORDS: readonly ContentTemplateRecord[] = [
  ABSENCE_SECRET_IN_PROMPT_RECORD,
  ABSENCE_NO_VERSION_CONTROL_RECORD,
  ABSENCE_NO_BACKUP_SAFETY_RECORD,
  ABSENCE_NO_SEPARATE_ENVS_RECORD,
  ABSENCE_NO_AUTOMATED_SECURITY_SCANNING_RECORD,
];
