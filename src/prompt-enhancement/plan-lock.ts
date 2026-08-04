import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIGNAL_MAP } from '../classifier/signals.js';
import { SHIPPED_CONTENT_TEMPLATES } from '../decision-session/content-template-tooling.js';
import {
  getPromptStartStopSourceSnapshot,
  getStoreSourceSnapshot,
  type PromptStartStopSourceSnapshot,
  type StoreSourceSnapshot,
} from './source-reality.js';

export const PLAN_LOCK_SOURCE_BASIS = {
  branch: 'scaffolding-architecture',
  currentHead: '3d7dac549a31b01c9323a72389feb0e10d6c660f',
  sourceImpactRange: '4dc2ac1..6114317',
  containedUpstreamCommit: '6114317c6fa453048cd6773e0fdd06403a144494',
  ignoredPromptEnhancementPath: 'src/prompt-enhancement/',
  ignoredExtVscodePrebuildsPath: 'src/ext-vscode/prebuilds/',
  shippedContentTemplateCount: 144,
  sharedSignalCount: 137,
  promptStartBoundary: 'UserPromptSubmit -> runAuto',
  deliveryBoundary: 'Stop -> runStop',
} as const;

export const NON_NEGOTIABLE_PLAN_LOCKS = [
  'local_first_cli',
  'no_backend_service',
  'no_multi_user_system',
  'minimal_ui_actual_useful_surface',
  'prompt_enhancement_visible_feature',
  'enhancement_popup_terminology',
  'prompt_enhancement_templates_identity',
  'prompt_enhancement_templates_separate_from_ds_content_templates',
  'no_old_static_ds_content_routing',
  'shared_source_foundation_no_pe_only_detector',
  'existing_ds_advisory_backward_compatible',
  'event_triggered_not_periodic',
  'prompt_start_preparation_stop_delivery_boundary',
  'one_body_v1_popup',
  'fixed_v1_controls',
  'baseline_safety_not_style_option',
  'original_prompt_visible_editable',
  'bounded_v1_multi_prompt_handoff',
  'public_launch_gated',
] as const;

export type NonNegotiablePlanLock = (typeof NON_NEGOTIABLE_PLAN_LOCKS)[number];

export const STALE_ACTIVE_INSTRUCTION_TERMS = [
  'partial content-template',
  'dark engine',
  '142 count',
  '129 count',
  'pre-send same-turn replacement',
  'old static DS maps',
  'PE-only classifier',
  'public tracked PE source',
] as const;

export interface SourceSyncFacts {
  branch: string;
  currentHead: string;
  sourceImpactRange: string;
  containedCommits: readonly string[];
  gitignoreText: string;
  trackedFiles: readonly string[];
  promptEnhancementPathExists: boolean;
  promptEnhancementNestedGitExists: boolean;
  activeInstructionTexts: readonly string[];
  unreconciledActiveRows: readonly string[];
  nonNegotiableLocks: readonly NonNegotiablePlanLock[];
}

export interface SourceSyncFileFactsInput {
  projectRoot: string;
  branch: string;
  currentHead: string;
  sourceImpactRange: string;
  containedCommits: readonly string[];
  trackedFiles: readonly string[];
  activeInstructionTexts?: readonly string[];
  unreconciledActiveRows?: readonly string[];
  nonNegotiableLocks?: readonly NonNegotiablePlanLock[];
}

export function readSourceSyncFileFacts(input: SourceSyncFileFactsInput): SourceSyncFacts {
  return {
    branch: input.branch,
    currentHead: input.currentHead,
    sourceImpactRange: input.sourceImpactRange,
    containedCommits: input.containedCommits,
    gitignoreText: readTextIfPresent(join(input.projectRoot, '.gitignore')),
    trackedFiles: input.trackedFiles,
    promptEnhancementPathExists: existsSync(join(input.projectRoot, 'src/prompt-enhancement')),
    promptEnhancementNestedGitExists: existsSync(join(input.projectRoot, 'src/prompt-enhancement/.git')),
    activeInstructionTexts: input.activeInstructionTexts ?? [],
    unreconciledActiveRows: input.unreconciledActiveRows ?? [],
    nonNegotiableLocks: input.nonNegotiableLocks ?? NON_NEGOTIABLE_PLAN_LOCKS,
  };
}

function readTextIfPresent(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export type PlanLockCheckId =
  | 'branch'
  | 'head'
  | 'source-impact-range'
  | 'contained-upstream'
  | 'gitignore-prompt-enhancement'
  | 'gitignore-ext-vscode-prebuilds'
  | 'public-tracked-prompt-enhancement'
  | 'public-tracked-ext-vscode-prebuilds'
  | 'prompt-enhancement-path'
  | 'prompt-enhancement-nested-git'
  | 'content-template-count'
  | 'shared-signal-count'
  | 'prompt-start-boundary'
  | 'stop-delivery-boundary'
  | 'store-source-reality'
  | 'non-negotiable-locks'
  | 'g0-active-row-reconciliation'
  | 'stale-active-instructions';

export interface PlanLockCheck {
  id: PlanLockCheckId;
  ok: boolean;
  expected: string;
  actual: string;
  detail: string;
}

export interface PlanLockEvaluation {
  locked: boolean;
  checks: readonly PlanLockCheck[];
  promptStartStop: PromptStartStopSourceSnapshot;
  store: StoreSourceSnapshot;
}

export function evaluateSourceSyncAndPlanLock(facts: SourceSyncFacts): PlanLockEvaluation {
  const promptStartStop = getPromptStartStopSourceSnapshot();
  const store = getStoreSourceSnapshot();
  const trackedPromptEnhancementFiles = filesWithPrefix(facts.trackedFiles, PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath);
  const trackedPrebuildFiles = filesWithPrefix(facts.trackedFiles, PLAN_LOCK_SOURCE_BASIS.ignoredExtVscodePrebuildsPath);
  const missingLocks = NON_NEGOTIABLE_PLAN_LOCKS.filter((lock) => !facts.nonNegotiableLocks.includes(lock));
  const staleTerms = findStaleActiveTerms(facts.activeInstructionTexts);

  const checks: PlanLockCheck[] = [
    check('branch', PLAN_LOCK_SOURCE_BASIS.branch, facts.branch),
    check('head', PLAN_LOCK_SOURCE_BASIS.currentHead, facts.currentHead),
    check('source-impact-range', PLAN_LOCK_SOURCE_BASIS.sourceImpactRange, facts.sourceImpactRange),
    check(
      'contained-upstream',
      PLAN_LOCK_SOURCE_BASIS.containedUpstreamCommit,
      facts.containedCommits.includes(PLAN_LOCK_SOURCE_BASIS.containedUpstreamCommit)
        ? PLAN_LOCK_SOURCE_BASIS.containedUpstreamCommit
        : facts.containedCommits.join(','),
      'Requested upstream commit must be recorded as contained in the current source basis.',
    ),
    checkIncludes(
      'gitignore-prompt-enhancement',
      PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath,
      facts.gitignoreText,
    ),
    checkIncludes(
      'gitignore-ext-vscode-prebuilds',
      PLAN_LOCK_SOURCE_BASIS.ignoredExtVscodePrebuildsPath,
      facts.gitignoreText,
    ),
    check(
      'public-tracked-prompt-enhancement',
      '0 public tracked files before PE-CR-5 launch recheck',
      String(trackedPromptEnhancementFiles.length),
      'Phase 0 must preserve that public Nexpath does not yet track PE implementation files.',
      trackedPromptEnhancementFiles.length === 0,
    ),
    check(
      'public-tracked-ext-vscode-prebuilds',
      '0 tracked generated prebuild files',
      String(trackedPrebuildFiles.length),
      'Extension native prebuilds are generated output, not PE source.',
      trackedPrebuildFiles.length === 0,
    ),
    check(
      'prompt-enhancement-path',
      'exists as private/ignored implementation path',
      facts.promptEnhancementPathExists ? 'exists' : 'missing',
      'Path existence is source reality only, not public launch readiness.',
      facts.promptEnhancementPathExists,
    ),
    check(
      'prompt-enhancement-nested-git',
      'present until PE-CR-5 remove-only launch gate',
      facts.promptEnhancementNestedGitExists ? 'present' : 'absent',
      'Nested private git metadata is a launch-boundary fact and must not be silently removed in Phase 0.',
      facts.promptEnhancementNestedGitExists,
    ),
    check(
      'content-template-count',
      String(PLAN_LOCK_SOURCE_BASIS.shippedContentTemplateCount),
      String(SHIPPED_CONTENT_TEMPLATES.length),
    ),
    check(
      'shared-signal-count',
      String(PLAN_LOCK_SOURCE_BASIS.sharedSignalCount),
      String(SIGNAL_MAP.size),
    ),
    check(
      'prompt-start-boundary',
      PLAN_LOCK_SOURCE_BASIS.promptStartBoundary,
      promptStartStop.hookBoundary,
    ),
    check(
      'stop-delivery-boundary',
      PLAN_LOCK_SOURCE_BASIS.deliveryBoundary,
      promptStartStop.deliveryBoundary,
    ),
    check(
      'store-source-reality',
      'schema v1 with current PE-owned tables and future gated PE tables still explicit',
      `schema v${store.schemaVersion}; PE-owned ${store.promptEnhancementOwnedTables.length}; missing future ${store.missingPromptEnhancementTables.length}`,
      'Phase 0 records the current store reality; implemented PE storage must be explicit and future-gated PE rows must stay non-runtime until their phases.',
      store.schemaVersion === 1
        && store.promptEnhancementOwnedTables.length === 5
        && store.missingPromptEnhancementTables.length > 0,
    ),
    check(
      'non-negotiable-locks',
      'all non-negotiable locks present',
      missingLocks.length === 0 ? 'all present' : missingLocks.join(','),
      'Every Phase 3 non-negotiable product and architecture lock must be active before coding.',
      missingLocks.length === 0,
    ),
    check(
      'g0-active-row-reconciliation',
      '0 unreconciled active pending rows',
      String(facts.unreconciledActiveRows.length),
      'G0 requires stale pending rows to be updated, marked historical, or converted into current stage gates before coding.',
      facts.unreconciledActiveRows.length === 0,
    ),
    check(
      'stale-active-instructions',
      'no stale active terms',
      staleTerms.length === 0 ? 'none' : staleTerms.join(','),
      'Stale terms may appear only as marked historical/superseded discussion, not active implementation instructions.',
      staleTerms.length === 0,
    ),
  ];

  return {
    locked: checks.every((item) => item.ok),
    checks,
    promptStartStop,
    store,
  };
}

function filesWithPrefix(files: readonly string[], prefix: string): string[] {
  return files.filter((file) => file.startsWith(prefix));
}

function findStaleActiveTerms(texts: readonly string[]): string[] {
  const joined = texts.join('\n').toLowerCase();
  return STALE_ACTIVE_INSTRUCTION_TERMS.filter((term) => joined.includes(term.toLowerCase()));
}

function check(
  id: PlanLockCheckId,
  expected: string,
  actual: string,
  detail = `${id} must match the locked source basis.`,
  ok = actual === expected,
): PlanLockCheck {
  return { id, ok, expected, actual, detail };
}

function checkIncludes(id: PlanLockCheckId, expectedLine: string, text: string): PlanLockCheck {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return {
    id,
    ok: lines.includes(expectedLine),
    expected: `line ${expectedLine}`,
    actual: lines.includes(expectedLine) ? `line ${expectedLine}` : 'missing',
    detail: `${expectedLine} must remain ignored until the relevant launch/build gate changes it explicitly.`,
  };
}
