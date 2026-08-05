import type { PromptEnhancementMemoryRow } from '../store/prompt-enhancement.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidancePriority,
} from './templates/section-plan.js';

/**
 * PE-AR-6 memory consumption scorer (E2 / phase 2.4).
 *
 * The query (`queryRelevantPromptEnhancementMemory`, wired in auto.ts / E1) returns
 * memory rows filtered only by status. This is the shared scoring seam the fix-plan
 * §4d requires: apply fatigue/suppression here so a repeatedly-edited-out or
 * over-shown signal does not re-surface, and map the row's evidence/confidence into
 * the guidance-fact priority + evidence state. The same scoring is reused by E3 /
 * AR6-G2 on the record side.
 *
 * Safety invariant: safety/mandatory/high-risk-protected memory is never fatigued or
 * suppressed out — safety must survive fatigue (fix-plan §4b / DR2-G1).
 *
 * Live memory data only arrives once E3 wires the record side; this scorer is shape-
 * ready now and unit-tested against synthetic rows. Deterministic — no LLM.
 */
export interface ScoredPromptEnhancementMemoryCandidate {
  signalKey: string;
  factPriority: PromptEnhancementGuidancePriority;
  factEvidenceState: PromptEnhancementGuidanceFact['sourceEvidenceState'];
  safetyProtected: boolean;
}

export interface PromptEnhancementMemoryScoringResult {
  eligible: readonly ScoredPromptEnhancementMemoryCandidate[];
  suppressed: readonly { signalKey: string; reasonCode: string }[];
}

const SAFETY_PROTECTED_STATES: ReadonlySet<PromptEnhancementMemoryRow['protectionState']> = new Set([
  'safety_protected',
  'mandatory_protected',
  'high_risk_protected',
]);

export function scorePromptEnhancementMemoryCandidates(
  rows: readonly PromptEnhancementMemoryRow[],
): PromptEnhancementMemoryScoringResult {
  const eligible: ScoredPromptEnhancementMemoryCandidate[] = [];
  const suppressed: { signalKey: string; reasonCode: string }[] = [];

  for (const row of rows) {
    const safetyProtected = SAFETY_PROTECTED_STATES.has(row.protectionState);

    // Fatigue / scoped-suppression drop the candidate — unless it is safety-protected,
    // in which case it survives (safety is never fatigued out).
    if (!safetyProtected) {
      if (row.fatigueState === 'fatigued') {
        suppressed.push({ signalKey: row.signalKey, reasonCode: 'memory_fatigued' });
        continue;
      }
      if (row.suppressionState === 'suppressed_scoped') {
        suppressed.push({ signalKey: row.signalKey, reasonCode: 'memory_suppressed_scoped' });
        continue;
      }
    }

    eligible.push({
      signalKey: row.signalKey,
      factPriority: priorityForMemoryRow(row, safetyProtected),
      factEvidenceState: evidenceStateForMemoryRow(row),
      safetyProtected,
    });
  }

  return { eligible, suppressed };
}

function priorityForMemoryRow(
  row: PromptEnhancementMemoryRow,
  safetyProtected: boolean,
): PromptEnhancementGuidancePriority {
  if (safetyProtected) return 'required_survivor';
  // Near the fatigue/suppression threshold: keep it, but as a weak tie-breaker.
  if (row.fatigueState === 'candidate' || row.suppressionState === 'candidate_scoped') return 'low';
  if (row.currentEvidenceState === 'live_current' && row.confidenceBand !== 'low') return 'high';
  return 'normal';
}

function evidenceStateForMemoryRow(
  row: PromptEnhancementMemoryRow,
): PromptEnhancementGuidanceFact['sourceEvidenceState'] {
  switch (row.currentEvidenceState) {
    case 'live_current':
      return row.confidenceBand === 'low' ? 'partial' : 'strong';
    case 'historical_candidate':
      return 'partial';
    case 'feedback_derived':
      return 'partial';
    default:
      return 'weak_low_risk'; // unknown_neutral
  }
}
