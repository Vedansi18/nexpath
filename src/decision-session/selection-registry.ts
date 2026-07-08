/**
 * Single-dispatch param-keyed selection registry for decision-session content.
 *
 * Re-expresses the hand-coded selection cascade in `options.ts` (`selectAbsenceMap`
 * / `selectRoleAbsenceMap` / `isVibe` / `selectNonBeginnerVariant` +
 * `resolveDecisionContent`) as ONE map per axis chained by a single dispatch —
 * every case explicit, no scattered boolean-flag branches. Multi-axis resolution
 * is chained single-axis lookups, not tuple-widened keys.
 *
 * It resolves the SAME `DecisionContent` as `resolveDecisionContent` (kept in
 * lock-step with it) and reuses the existing content maps verbatim — no new
 * content. Not yet wired into the live render path.
 *
 * Register note: this derives the register LOCALLY rather than via
 * `register.ts::profileToRegister`, because the two disagree on `cool_geek`:
 * `profileToRegister` maps `cool_geek → beginner`, but the content cascade treats
 * only `nature === 'beginner'` as beginner/vibe (so `cool_geek → casual`). Matching
 * the existing content output is the binding requirement here; the divergence is a
 * known inconsistency to reconcile later.
 */

import type { Stage, UserProfile } from '../classifier/types.js';
import type { FlagType } from '../classifier/Stage2Trigger.js';
import type { DecisionContent } from './options.js';
import {
  ABSENCE_CONTENT,
  ABSENCE_CONTENT_CASUAL,
  ABSENCE_CONTENT_FOUNDER,
  ABSENCE_CONTENT_INDIE_HACKER,
  ABSENCE_CONTENT_PM,
  ABSENCE_CONTENT_PRO_GEEK_SOUL,
  TRANSITION_CONTENT,
  TASK_REVIEW,
  TASK_REVIEW_CASUAL,
  resolveSkippedTransitionContent,
} from './options.js';
import {
  ABSENCE_CONTENT_BEGINNER,
  TRANSITION_CONTENT_BEGINNER,
  TASK_REVIEW_BEGINNER,
} from './options-beginner.js';

/** The three register variants the content surface supports. */
export type SelectionRegister = 'beginner' | 'formal' | 'casual';

type AbsenceMap = Partial<Record<string, DecisionContent>>;
type TransitionMap = Partial<Record<Stage, DecisionContent>>;
type Role = NonNullable<UserProfile['role']>;

/**
 * Register axis — single dispatch over nature (one switch, every case explicit).
 * Matches the cascade's gate exactly: only `beginner` is beginner/vibe;
 * `hardcore_pro` is formal; everything else (`cool_geek`, `pro_geek_soul`,
 * null/undefined) is casual. NOT `profileToRegister` (see file header).
 */
export function selectionRegister(nature: UserProfile['nature'] | null | undefined): SelectionRegister {
  switch (nature) {
    case 'beginner':     return 'beginner';
    case 'hardcore_pro': return 'formal';
    default:             return 'casual';
  }
}

// ── One map per axis ───────────────────────────────────────────────────────────

/** signalKey → absence content, keyed by register. */
const ABSENCE_BY_REGISTER: Record<SelectionRegister, AbsenceMap> = {
  beginner: ABSENCE_CONTENT_BEGINNER,
  formal:   ABSENCE_CONTENT,
  casual:   ABSENCE_CONTENT_CASUAL,
};

/** stage → transition content, keyed by register (formal + casual share the map). */
const TRANSITION_BY_REGISTER: Record<SelectionRegister, TransitionMap> = {
  beginner: TRANSITION_CONTENT_BEGINNER,
  formal:   TRANSITION_CONTENT,
  casual:   TRANSITION_CONTENT,
};

/** Within-stage / fallback content, keyed by register. */
const TASK_REVIEW_BY_REGISTER: Record<SelectionRegister, DecisionContent> = {
  beginner: TASK_REVIEW_BEGINNER,
  formal:   TASK_REVIEW,
  casual:   TASK_REVIEW_CASUAL,
};

/** signalKey → absence content, keyed by role (roles without an override are absent). */
const ABSENCE_BY_ROLE: Partial<Record<Role, AbsenceMap>> = {
  founder:      ABSENCE_CONTENT_FOUNDER,
  indie_hacker: ABSENCE_CONTENT_INDIE_HACKER,
  pm:           ABSENCE_CONTENT_PM,
};

// ── Single-dispatch resolution ─────────────────────────────────────────────────

/**
 * Resolve the `DecisionContent` for a fire, by chaining single-axis lookups.
 * Behaviourally identical to `resolveDecisionContent`.
 *
 * Order (highest precedence first):
 *   1. absence fire → role override → pro_geek_soul override → register absence map
 *   2. stage-transition skip → nearest intermediate transition content
 *   3. direct transition content for the current stage
 *   4. register fallback (within-stage / ultimate)
 */
export function resolveSelection(
  currentStage: Stage,
  flagType:     FlagType,
  profile?:     UserProfile | null,
  prevStage?:   Stage,
): DecisionContent {
  const register      = selectionRegister(profile?.nature);
  const absenceMap    = ABSENCE_BY_REGISTER[register];
  const transitionMap = TRANSITION_BY_REGISTER[register];
  // Role overrides never apply to the beginner register (the cascade's isVibe gate).
  const roleMap       = register === 'beginner' ? undefined
    : profile?.role ? ABSENCE_BY_ROLE[profile.role] : undefined;

  if (flagType.startsWith('absence:')) {
    const signalKey = flagType.slice('absence:'.length);
    const roleHit = roleMap?.[signalKey];
    if (roleHit) return roleHit;
    if (profile?.nature === 'pro_geek_soul') {
      const pgOverride = ABSENCE_CONTENT_PRO_GEEK_SOUL[signalKey];
      if (pgOverride) return pgOverride;
    }
    const override = absenceMap[signalKey];
    if (override) return override;
  }

  if (flagType === 'stage_transition' && prevStage) {
    const skipped = resolveSkippedTransitionContent(transitionMap, prevStage, currentStage);
    if (skipped) return skipped;
  }

  const direct = transitionMap[currentStage];
  if (direct) return direct;

  return TASK_REVIEW_BY_REGISTER[register];
}

// ── Dual-source resolver + migration marker (§6.1 gate 1 / S2) ──────────────────
//
// Per-signalType content SOURCE. A *migrated* signalType is served from the
// content-template engine; every other signalType is served from the static
// `DecisionContent` set (via `resolveSelection`). Both sources feed the SAME
// runtime — this is the load-bearing Phase-1 ↔ Phase-2 coexistence mechanism:
// while the registry is live, an un-migrated static set and a migrated
// content-template both resolve through the ONE dispatch point (S7).
//
// The marker started EMPTY (ship-dark: every signalType resolved 'static',
// preserving EXACT cascade parity). Migrated signalTypes are added here — the 6
// §4.E2 signals (A12) plus the Group-B classes as they migrate (B3+); every
// un-migrated set stays static. Per-set migration adds a signalType key here, one
// commit each (S8) — flipping only that signal to the engine path.

/** The content SOURCE for a signalType's advisory. */
export type ContentSource = 'static' | 'content-template';

/**
 * SignalTypes served by the content-template engine (else static) — the 6 §4.E2
 * signals (A12) plus the Group-B classes migrated so far (B3+). An EMPTY marker =
 * ship-dark (every signal static, runtime byte-identical). Migration is per-set (S8)
 * — add the signalType key here in its own migration commit, gated by the
 * cascade-parity + contract tests.
 */
export const MIGRATED_SIGNALS: ReadonlySet<string> = new Set<string>([
  // §4.E2 new signals (A12): served by the content-template engine (no static DecisionContent).
  'ABSENCE_SECRET_IN_PROMPT',
  'ABSENCE_NO_VERSION_CONTROL',
  'ABSENCE_NO_BACKUP_SAFETY',
  'ABSENCE_NO_SEPARATE_ENVS',
  'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING',
  'ABSENCE_FRUSTRATION_SPIRAL',
  // B3 — class 2 (verification-quality, 21 signals, 0 sensitive): now engine-served.
  'BEHAVIOUR_TESTING',
  'ABSENCE_TEST_CREATION',
  'ABSENCE_REGRESSION_CHECK',
  'ABSENCE_SECURITY_CHECK',
  'ABSENCE_ERROR_HANDLING',
  'ABSENCE_DOCUMENTATION',
  'ABSENCE_REFACTORING',
  'ABSENCE_CORRECTION_SEEKING',
  'ABSENCE_PROBLEM_CORRECTION',
  'ABSENCE_ACCESSIBILITY',
  'ABSENCE_DATA_VALIDATION',
  'ABSENCE_CODE_DOCUMENTATION_GAP',
  'ABSENCE_TECHNICAL_DEBT_ACKNOWLEDGMENT',
  'ABSENCE_TEST_DEPTH_CHECK',
  'ABSENCE_SECURITY_REVIEW_GAP',
  'ABSENCE_ERROR_HANDLING_COVERAGE',
  'ABSENCE_REFACTORING_CHECKPOINT',
  'ABSENCE_SELF_REVIEW_HABIT',
  'ABSENCE_PERFORMANCE_AWARENESS',
  'ABSENCE_DOCUMENTATION_BEFORE_ASK',
  'ABSENCE_OUTPUT_VERIFICATION',
  // B4 — class 3 (spec/architecture, 11 signals, 0 sensitive): now engine-served.
  'ABSENCE_SPEC_ACCEPTANCE',
  'ABSENCE_CROSS_CONFIRMING',
  'ABSENCE_ALTERNATIVES',
  'ABSENCE_ARCH_CONFLICT',
  'ABSENCE_PROMPT_CONTEXT',
  'ABSENCE_SPEC_CROSS_CONFIRM',
  'ABSENCE_SPEC_REVISION',
  'ABSENCE_API_DESIGN_REVIEW',
  'ABSENCE_ARCHITECTURE_NOTE_ABSENCE',
  'ABSENCE_API_CONTRACT_DEFINITION',
  'ABSENCE_BACKWARDS_COMPATIBILITY_CHECK',
  // B6 — class 5 (session-quality, 8 signals, 0 sensitive): now engine-served.
  // context_loss keeps its static role variant for founder/indie/pm users via stop.ts's
  // role-precedence guard (the register-only engine can't reproduce role-tailored content).
  'ABSENCE_COMPREHENSION',
  'ABSENCE_NO_PUSHBACK',
  'ABSENCE_CONTEXT_LOSS',
  'ABSENCE_DECISION_FATIGUE_PATTERN',
  'ABSENCE_WORK_RHYTHM_CHECK',
  'ABSENCE_FOCUS_DRIFT_DETECTION',
  'ABSENCE_SESSION_LENGTH_CHECKPOINT',
  'ABSENCE_PROGRESS_CONSOLIDATION_GAP',
  // B7 — class 6 (planning/idea/task, 14 signals, 0 sensitive, no role variants): now engine-served.
  'ABSENCE_PHASE_TRANSITION',
  'ABSENCE_IDEA_SCOPING',
  'ABSENCE_IDEA_CONSTRAINT_CHECK',
  'ABSENCE_IDEA_USER_DEFINITION',
  'ABSENCE_TASK_ORDERING',
  'ABSENCE_TASK_SIZING',
  'ABSENCE_TASK_DEFINITION_OF_DONE',
  'ABSENCE_USER_FEEDBACK_REVIEW',
  'ABSENCE_ITERATION_PLANNING',
  'ABSENCE_SCOPE_CREEP',
  'ABSENCE_FEATURE_SCOPE',
  'ABSENCE_IMPLEMENTATION_CHECKPOINT',
  'ABSENCE_SPEC_BEFORE_CODE',
  'ABSENCE_INCREMENTAL_BUILD',
  // B8 — class 7 (cool-geek/vibe-coder, 20 signals): now engine-served. 1 sensitive
  // (ABSENCE_DEPENDENCY_ADVENTURE, l2SafeguardRequired — safeguard confirmed on migration);
  // beginner overrides served via the engine's resolveRegisterForms (register=beginner).
  'ABSENCE_FEATURE_COMPLETION_CHECK',
  'ABSENCE_FINISHING_LINE_AWARENESS',
  'ABSENCE_POLISH_VS_FUNCTION',
  'ABSENCE_MVP_SCOPE_DISCIPLINE',
  'ABSENCE_IDEA_TO_SPEC_BRIDGE',
  'ABSENCE_DEMO_VS_PRODUCT',
  'ABSENCE_USER_JOURNEY_CHECK',
  'ABSENCE_TECHNICAL_SPIKE_TREATMENT',
  'ABSENCE_DEPENDENCY_ADVENTURE',
  'ABSENCE_RESTART_IMPULSE_CHECK',
  'ABSENCE_CREATIVE_VS_CORE_RATIO',
  'ABSENCE_ERROR_UNDERSTANDING',
  'ABSENCE_REQUIREMENT_CLARITY',
  'ABSENCE_COPY_PASTE_AWARENESS',
  'ABSENCE_DEBUGGING_OBSERVATION',
  'ABSENCE_LEARNING_CONSOLIDATION',
  'ABSENCE_SIMPLE_SOLUTION_FIRST',
  'ABSENCE_SINGLE_RESPONSIBILITY_PROMPTING',
  'ABSENCE_ROLLBACK_AWARENESS',
  'ABSENCE_BUILD_VS_UNDERSTAND_RATIO',
  // B2 — class 1 (stage transitions, 7 signals): now engine-served. These fire as flagType
  // 'stage_transition' (not absence:X), so stop.ts derives the record signalType from the
  // resolved static content's signalType (kept in lock-step with the static resolution). 2 sensitive
  // (REVIEW_TO_RELEASE, RELEASE_TO_FEEDBACK, l2SafeguardRequired — safeguard confirmed on migration,
  // preserved through every strength tier via the record-safeguard thread into deriveLadder);
  // 6 carry structurally-divergent beginner overrides (served via the engine's resolveRegisterForms);
  // TASK_REVIEW stays vocab-adaptable (no beginner override — base serves every register).
  'IDEA_TO_PRD',
  'PRD_TO_ARCHITECTURE',
  'ARCHITECTURE_TO_TASKS',
  'TASK_REVIEW',
  'IMPLEMENTATION_TO_REVIEW',
  'REVIEW_TO_RELEASE',
  'RELEASE_TO_FEEDBACK',
]);

/**
 * Resolve the content SOURCE for a signalType: `content-template` iff the signal
 * has been migrated, else `static`. Single dispatch over the migration marker —
 * the ONLY place a signal's source is decided. The marker is injectable for
 * testing the migrated branch while the shipped `MIGRATED_SIGNALS` stays empty.
 */
export function resolveContentSource(
  signalType: string,
  marker: ReadonlySet<string> = MIGRATED_SIGNALS,
): ContentSource {
  return marker.has(signalType) ? 'content-template' : 'static';
}
