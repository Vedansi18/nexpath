import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';

/**
 * PE-AR-2 subresearch-2 cross-lane conflict resolution (E2 / phase 2.4b).
 *
 * Locked rule (analysis L5592-5594): "RIGHT/GOOD facts can be amplified only while
 * still current enough and not contradicted by active absence/mistake evidence.
 * Active absence/mistake evidence wins for source mixing; old positive facts can be
 * suppressed, softened, or used only as context."
 *
 * So when a positive `right_good_pattern` (Source B) fact names the same practice as
 * an active Source-A missing-practice fact (an absence signal, including a mistake
 * signal normalized into Source A), the positive fact is suppressed with a reason —
 * we must not amplify "you already do X well" while also flagging X as missing.
 *
 * Matching is by practice token (the ref suffix after its source prefix). Where the
 * two subsystems' keys align, the conflict is caught; broader semantic alignment is
 * data-tuned (split 2). Deterministic — no LLM.
 */
export interface PromptEnhancementConflictResolutionResult {
  facts: readonly PromptEnhancementGuidanceFact[];
  suppressed: readonly { factId: string; reasonCode: string; conflictsWith: string }[];
}

const SOURCE_PREFIXES = [
  'absence:',
  'mistake:',
  'right_good:',
  'memory:',
  'hard_fact:',
  'work_style:',
  'stage:',
];

function practiceToken(sourceId: string): string {
  for (const prefix of SOURCE_PREFIXES) {
    if (sourceId.startsWith(prefix)) return sourceId.slice(prefix.length);
  }
  return sourceId;
}

export function resolvePromptEnhancementSourceConflictsV1(
  facts: readonly PromptEnhancementGuidanceFact[],
): PromptEnhancementConflictResolutionResult {
  // Active missing-practice evidence = Source-A absence signals (mistakes are
  // normalized into absence_signal upstream). Map each practice token to its fact id.
  const activePractices = new Map<string, string>();
  for (const fact of facts) {
    if (fact.sourceType !== 'absence_signal') continue;
    for (const sourceId of fact.sourceIds) {
      const token = practiceToken(sourceId);
      if (!activePractices.has(token)) activePractices.set(token, fact.factId);
    }
  }

  const suppressed: { factId: string; reasonCode: string; conflictsWith: string }[] = [];
  const resolved = facts.map((fact): PromptEnhancementGuidanceFact => {
    if (fact.sourceType !== 'right_good_pattern') return fact;
    const conflictToken = fact.sourceIds.map(practiceToken).find((token) => activePractices.has(token));
    if (conflictToken === undefined) return fact;

    const conflictsWith = activePractices.get(conflictToken) as string;
    suppressed.push({ factId: fact.factId, reasonCode: 'right_good_contradicted_by_active_absence', conflictsWith });
    return {
      ...fact,
      priority: 'suppressed',
      renderPolicy: 'suppress_with_reason',
      requiredBecause: `contradicted_by:${conflictsWith}`,
    };
  });

  return { facts: resolved, suppressed };
}
