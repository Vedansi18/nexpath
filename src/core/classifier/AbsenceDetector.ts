import type { SessionState, AbsenceFlag, UserProfile } from './types.js';
import { SIGNAL_MAP } from './signals.js';
import { STAGE_CONFIRM_THRESHOLD } from '../session-state.js';

// ── Phase 7 F1 custom detection constants ─────────────────────────────────────

const WORK_RHYTHM_VELOCITY_THRESHOLD_MS = 30_000;
const WORK_RHYTHM_WINDOW = 10;

const FOCUS_DRIFT_DOMAIN_THRESHOLD = 5;
const FOCUS_DRIFT_WINDOW = 20;

const FOCUS_DOMAINS: Record<string, string[]> = {
  auth:         ['login', 'password', 'token', 'authentication', 'jwt', 'oauth', 'session', 'permission'],
  database:     ['database', 'query', 'migration', 'schema', 'table', 'sql', 'orm', 'mongodb', 'postgres'],
  ui:           ['component', 'frontend', 'css', 'style', 'button', 'modal', 'layout', 'render', 'react', 'vue'],
  api:          ['endpoint', 'route', 'request', 'response', 'rest', 'graphql', 'fetch', 'axios', 'webhook'],
  testing:      ['test', 'spec', 'assert', 'mock', 'fixture', 'coverage', 'jest', 'vitest', 'cypress'],
  deployment:   ['deploy', 'docker', 'ci', 'pipeline', 'build', 'release', 'kubernetes', 'staging'],
  performance:  ['cache', 'optimize', 'latency', 'memory', 'profiling', 'benchmark', 'slow'],
  architecture: ['refactor', 'design', 'pattern', 'architecture', 'module', 'abstraction', 'structure'],
};

const FOCUS_COMPLETION_KEYWORDS = ['done', 'finished', 'merged', 'shipped', 'closed'];

function detectWorkRhythmFlag(state: SessionState): boolean {
  const history = state.promptHistory;
  if (history.length < WORK_RHYTHM_WINDOW) return false;
  const recent = history.slice(-WORK_RHYTHM_WINDOW);
  let totalInterval = 0;
  for (let i = 1; i < recent.length; i++) {
    totalInterval += (recent[i]!.capturedAt - recent[i - 1]!.capturedAt);
  }
  const avgInterval = totalInterval / (recent.length - 1);
  return avgInterval < WORK_RHYTHM_VELOCITY_THRESHOLD_MS;
}

function detectFocusDriftFlag(state: SessionState): boolean {
  const history = state.promptHistory;
  const window = history.slice(-FOCUS_DRIFT_WINDOW);
  const windowText = window.map((r) => r.text.toLowerCase()).join(' ');
  const hasCompletion = FOCUS_COMPLETION_KEYWORDS.some((kw) => windowText.includes(kw));
  if (hasCompletion) return false;
  const activeDomains = Object.values(FOCUS_DOMAINS).filter(
    (keywords) => keywords.some((kw) => windowText.includes(kw)),
  );
  return activeDomains.length >= FOCUS_DRIFT_DOMAIN_THRESHOLD;
}

export const ABSENCE_MIN_PROMPTS = 15;
export const ABSENCE_COOLDOWN_PROMPTS = 30;

export function detectAbsenceFlags(
  state:               SessionState,
  profile?:            UserProfile | null,
  projectType?:        string,
  thresholdMultiplier = 1.0,
  absenceMinFloor     = 5,
): AbsenceFlag[] {
  const { currentStage, stageConfidence, promptsInCurrentStage, promptCount } = state;

  if (stageConfidence < STAGE_CONFIRM_THRESHOLD) return [];

  const isVibeProfile    = profile?.nature === 'beginner' || profile?.nature === 'cool_geek';
  const profileMultiplier = isVibeProfile ? 0.5 : 1.0;

  if (promptsInCurrentStage < absenceMinFloor) return [];

  const newFlags: AbsenceFlag[] = [];

  for (const sig of SIGNAL_MAP.values()) {
    if (!sig.expectedStages.includes(currentStage)) continue;

    if (sig.relevantProjectTypes && projectType && projectType !== 'other'
        && !sig.relevantProjectTypes.includes(projectType)) continue;

    if (sig.nature && sig.nature !== profile?.nature) continue;

    if (sig.role && sig.role !== profile?.role) continue;

    const effectiveThreshold = Math.max(absenceMinFloor, Math.ceil(sig.absenceThreshold * profileMultiplier * thresholdMultiplier));
    if (promptsInCurrentStage < effectiveThreshold) continue;

    if (sig.key === 'decision_fatigue_pattern') {
      const streak = state.consecutiveAcceptanceStreak ?? 0;
      if (streak < sig.absenceThreshold) continue;
    } else if (sig.key === 'work_rhythm_check') {
      if (!detectWorkRhythmFlag(state)) continue;
    } else if (sig.key === 'focus_drift_detection') {
      if (!detectFocusDriftFlag(state)) continue;
    } else if (sig.key === 'problem_correction') {
      const hasProblemContext = state.promptHistory.some((p) =>
        /\b(bug|error|broken|crash|fail(ed|ing)?|issue|problem|not working|doesn't work|TypeError|undefined|exception)\b/i.test(p.text)
      );
      if (!hasProblemContext) continue;
      const counter = state.signalCounters[sig.key];
      if (!counter || counter.lastSeenAt !== null) continue;
    } else if (sig.key === 'deployment_planning') {
      const MIN_REVIEW_TESTING_PROMPTS = 5;
      if (currentStage !== 'release' &&
          !(currentStage === 'review_testing' &&
            promptsInCurrentStage >= MIN_REVIEW_TESTING_PROMPTS)) continue;
      const counter = state.signalCounters[sig.key];
      if (!counter || counter.lastSeenAt !== null) continue;
    } else if (sig.key === 'context_loss') {
      const MIN_CONTEXT_LOSS_PROMPTS = 25;
      if (promptCount < MIN_CONTEXT_LOSS_PROMPTS) continue;
      const counter = state.signalCounters[sig.key];
      if (!counter || counter.lastSeenAt !== null) continue;
    } else {
      const counter = state.signalCounters[sig.key];
      if (!counter || counter.lastSeenAt !== null) continue;
    }

    const existingFlag = state.absenceFlags.find((f) => f.signalKey === sig.key);
    if (existingFlag && promptCount < existingFlag.cooldownUntil) continue;

    newFlags.push({
      signalKey:     sig.key,
      stage:         currentStage,
      raisedAtIndex: promptCount,
      cooldownUntil: promptCount + ABSENCE_COOLDOWN_PROMPTS,
    });
  }

  return newFlags;
}
