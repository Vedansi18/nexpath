/**
 * WHICH project facts belong in THIS prompt.
 *
 * The env probe knows ten things about a project. Before this module, every one of them reached
 * every enhanced prompt: a request to rename a variable arrived carrying the test runner, the
 * lockfile, the backup situation and the CI pipeline. Grounding that is always present is not
 * grounding — it is noise the reader learns to skip, and it crowds out the facts that did matter.
 *
 * ⛔ The judgement is the MODEL's, ruled by Hiren: applicability needs reasoning depth about what a
 * prompt is for, and a keyword map cannot supply it — the same argument that demoted the keyword
 * capability decider. It rides the PARKED stage-classifier call (no new call, standing ruling), and
 * follows the §21/§24 pattern exactly: the model OBSERVES which categories this prompt calls for,
 * the registry DECIDES what that means for the payload.
 *
 * This module owns only the vocabulary both sides share: the categories, their public-safe labels,
 * and which stored fact belongs to which category.
 */

/** The categories the model is asked about. Public-safe ids — they travel in a prompt. */
export type PromptEnhancementProjectFactCategoryV1 =
  | 'framework'
  | 'test_runner'
  | 'version_control'
  | 'ci_pipeline'
  | 'deploy_config'
  | 'env_separation'
  | 'backups'
  | 'lockfile'
  | 'security_scanner'
  | 'persistent_context';

/**
 * The category list as the model sees it: what the fact IS, and what kind of request it serves.
 *
 * ⚠️ The "serves" text is the applicability semantics Hiren confirmed. It is deliberately written
 * as the SHAPE of request each fact informs, never as keywords — a keyword list here would rebuild
 * the decider this observation exists to replace, one layer down.
 */
export const PROJECT_FACT_CATEGORIES_V1: readonly {
  readonly id: PromptEnhancementProjectFactCategoryV1;
  readonly label: string;
  readonly serves: string;
}[] = [
  { id: 'framework', label: 'project framework',
    serves: 'writing or changing application code, where the framework shapes how it should be written' },
  { id: 'test_runner', label: 'test runner',
    serves: 'writing, running or reviewing tests, regression checks, or verification of a change' },
  { id: 'version_control', label: 'version control',
    serves: 'committing, branching, reverting, comparing revisions, or recovering from a bad change' },
  { id: 'ci_pipeline', label: 'CI pipeline',
    serves: 'release, rollout, build automation, or checks that must pass before merge' },
  { id: 'deploy_config', label: 'deployment configuration',
    serves: 'deploying, releasing, or changing how and where the project runs' },
  { id: 'env_separation', label: 'environment separation',
    serves: 'configuration, secrets, or work that differs between local, staging and production' },
  { id: 'backups', label: 'backups',
    serves: 'destructive, migration or data-affecting work where recovery matters' },
  { id: 'lockfile', label: 'dependency lockfile',
    serves: 'adding, upgrading, pinning or debugging dependencies' },
  { id: 'security_scanner', label: 'security scanning',
    serves: 'security review, vulnerability work, or handling untrusted input and secrets' },
  { id: 'persistent_context', label: 'persistent project context file',
    serves: 'handing work over, resuming earlier work, or establishing shared project conventions' },
];

const CATEGORY_IDS: ReadonlySet<string> = new Set(PROJECT_FACT_CATEGORIES_V1.map((c) => c.id));

/** Stored env-fact key → the category it is judged under. */
const CATEGORY_BY_FACT_KEY: Readonly<Record<string, PromptEnhancementProjectFactCategoryV1>> = {
  project_framework:           'framework',
  has_test_runner:             'test_runner',
  has_version_control:         'version_control',
  has_ci_pipeline:             'ci_pipeline',
  has_deploy_config:           'deploy_config',
  has_env_separation:          'env_separation',
  has_backups:                 'backups',
  has_lockfile:                'lockfile',
  has_security_scanner:        'security_scanner',
  has_persistent_context_file: 'persistent_context',
};

/** Narrow a raw model string to a known category — unknown values are dropped, never guessed. */
export function isPromptEnhancementProjectFactCategoryV1(
  value: unknown,
): value is PromptEnhancementProjectFactCategoryV1 {
  return typeof value === 'string' && CATEGORY_IDS.has(value);
}

/**
 * The category a crossing grounding ref is judged under, or undefined when the ref is not a
 * project fact at all.
 *
 * ⚠️ `env_change:` refs resolve to the SAME category as the standing fact they moved — Hiren's
 * ruling (Q4): a movement is subject to the same applicability test as the fact itself, or the
 * movement lane just becomes a second way to send noise.
 */
export function projectFactCategoryForRefV1(ref: string): PromptEnhancementProjectFactCategoryV1 | undefined {
  for (const prefix of ['hard_fact:', 'env_change:']) {
    if (ref.startsWith(prefix)) return CATEGORY_BY_FACT_KEY[ref.slice(prefix.length)];
  }
  return undefined;
}

/**
 * The registry's decision for one ref, from the model's observation.
 *
 * 🔒 FAIL-CLOSED (Hiren, Q3 + the fix plan): `observed === undefined` means no observation channel
 * ran at all — no key, a classifier failure, a degraded route — and the answer is NO. The old
 * behaviour was to send all ten facts on every prompt, so falling back to it would restore the
 * exact defect on precisely the runs nobody is watching.
 *
 * ⚠️ A ref with no category is NOT a project fact (work-style, mistakes, prompt-mined material) and
 * is none of this gate's business — it passes through untouched.
 */
export function projectFactRefIsApplicableV1(
  ref: string,
  observed: readonly PromptEnhancementProjectFactCategoryV1[] | undefined,
): boolean {
  const category = projectFactCategoryForRefV1(ref);
  if (category === undefined) return true;
  return (observed ?? []).includes(category);
}
