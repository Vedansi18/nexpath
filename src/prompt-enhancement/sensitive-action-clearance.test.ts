// The sensitive-action clearance gate + its plumbing, tested at the level this phase ships:
// the gate truth table, the classifier reply's soft-parsed fields, the request-field ride,
// and the inertness proof (absent field => byte-identical body on the deterministic path).
//
// ⚠️ Deliberately NOT here (they belong to the activation phase, together with the prompt
// block): the full body-level battery — both decision functions on the frozen 45-row set,
// the five fail-closed ways asserted on bodies, and the mutations.
import { describe, it, expect } from 'vitest';
import {
  promptEnhancementSensitiveActionClearedForTextV1,
  type PromptEnhancementSensitiveActionClearanceV1,
} from './sensitive-action-clearance.js';
import { parseStageClassifierReply } from '../classifier/stage-classifier.js';
import { routePromptEnhancement } from './routing-taxonomy.js';
import { planPromptEnhancementSections } from './templates/section-plan.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import type { PromptEnhancementSourceRefV1 } from './contracts.js';

const CANONICAL_MARKER = 'you must ask me for go-ahead confirmation';
const BENIGN_RISKY_PROMPT = 'drop a shadow under the header and remove the extra padding around the cards';

// The deterministic body composed for BENIGN_RISKY_PROMPT at the moment this phase began
// (harvested at pre-change HEAD). The inertness proof asserts the absent-clearance compose
// still produces exactly these bytes — the sentence present, wording unchanged.
const GOLDEN_BODY: string = JSON.parse(
  '"My original request (verbatim):\\ndrop a shadow under the header and remove the extra padding around the cards\\n\\nScope Non Goals:\\n- Cover Scope Non Goals for this request with concrete, source-backed specifics \\u2014 state what is required, how to implement it, and how to verify it.\\n\\nAssumptions Open Questions:\\n- Cover Assumptions Open Questions for this request with concrete, source-backed specifics \\u2014 state what is required, how to implement it, and how to verify it.\\n\\nAcceptance Or Output Expectation:\\n- State the expected output and acceptance criteria clearly enough that the implementation can be checked.\\n\\nPoint Inventory Or Decomposition:\\n- Preserve the original request, dependencies, and completion checks inside this one prompt body.\\n\\nRisk Safety Or Confirmation:\\n- Name risky or irreversible actions, ask for required confirmation, and include rollback or recovery checks.\\n- Still, before you do this destructive file or codebase change you must ask me for go-ahead confirmation.\\n\\nVerification Or Test Plan:\\n- Include the verification command, focused scenario, or regression check that should prove the change.\\n\\nSource Signal Guidance:\\n- Use the current source signal as a task constraint and convert it into direct implementation guidance."',
);

const sourceA: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'src-a-1',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:clearance-1',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
};

function composeBenignRiskyBody(clearance?: PromptEnhancementSensitiveActionClearanceV1): string {
  const route = routePromptEnhancement({
    routeDecisionId: 'clearance-route-1',
    promptText: BENIGN_RISKY_PROMPT,
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:verification_gap@implementation',
    effectiveFiredSource: 'classifier_fire_recommendation',
    selectedQualifyingAbsence: 'verification_gap',
    absenceGateReason: 'selected_qualifying_absence',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
  });
  const planning = planPromptEnhancementSections({
    routeResult: route,
    sourceRefs: [sourceA],
    guidanceFacts: [],
  });
  const composed = composePromptEnhancementBody({
    enhancementId: 'clearance-enh-1',
    originalPromptText: BENIGN_RISKY_PROMPT,
    sectionPlanningResult: planning,
    ...(clearance !== undefined ? { sensitiveActionClearance: clearance } : {}),
  });
  return composed.currentBody.text;
}

describe('the clearance gate truth table — absent, degraded, malformed, reasonless, proposed ALL emit', () => {
  const text = BENIGN_RISKY_PROMPT;

  it('absent clearance never clears (the degraded call omits the field — same shape)', () => {
    expect(promptEnhancementSensitiveActionClearedForTextV1(text, undefined)).toBe(false);
  });

  it("verdict 'proposed' never clears", () => {
    expect(promptEnhancementSensitiveActionClearedForTextV1(text, { verdict: 'proposed', reason: 'a real deployment is proposed' })).toBe(false);
  });

  it('a malformed verdict never clears — only the exact literal counts', () => {
    for (const verdict of ['maybe', 'NOT_PROPOSED', 'not proposed', '', 'cleared']) {
      expect(promptEnhancementSensitiveActionClearedForTextV1(text, { verdict, reason: 'a stated reading' })).toBe(false);
    }
    expect(promptEnhancementSensitiveActionClearedForTextV1(text, { reason: 'a stated reading' })).toBe(false);
  });

  it('a reasonless clearance is VOID — asserting is not auditing', () => {
    expect(promptEnhancementSensitiveActionClearedForTextV1(text, { verdict: 'not_proposed' })).toBe(false);
    expect(promptEnhancementSensitiveActionClearedForTextV1(text, { verdict: 'not_proposed', reason: '' })).toBe(false);
    expect(promptEnhancementSensitiveActionClearedForTextV1(text, { verdict: 'not_proposed', reason: '   ' })).toBe(false);
  });

  it('only an explicit negative with a stated benign reading clears', () => {
    expect(promptEnhancementSensitiveActionClearedForTextV1(text, {
      verdict: 'not_proposed',
      reason: "'drop' here means a CSS box-shadow; no data or file is being removed",
    })).toBe(true);
  });

  it('an empty judged text has no candidates a clearance could apply to', () => {
    expect(promptEnhancementSensitiveActionClearedForTextV1('', { verdict: 'not_proposed', reason: 'benign' })).toBe(false);
    expect(promptEnhancementSensitiveActionClearedForTextV1('   ', { verdict: 'not_proposed', reason: 'benign' })).toBe(false);
  });
});

describe('the classifier reply fields parse SOFTLY, degrading to ABSENT — never to a default', () => {
  const baseReply = {
    stage: 'Implementation',
    stage_confidence: 0.8,
    signals_present: ['verification_gap'],
    signals_absent: [],
    fire_decision_session: false,
    reason: 'implementing',
  };

  it('valid verdict + reason are carried', () => {
    const parsed = parseStageClassifierReply(JSON.stringify({
      ...baseReply,
      sensitive_action_verdict: 'not_proposed',
      sensitive_action_reason: 'names a CSS effect only',
    }));
    expect(parsed.sensitiveActionVerdict).toBe('not_proposed');
    expect(parsed.sensitiveActionReason).toBe('names a CSS effect only');
  });

  it('an invalid verdict value degrades to absent without failing the classification', () => {
    const parsed = parseStageClassifierReply(JSON.stringify({
      ...baseReply,
      sensitive_action_verdict: 'definitely_fine',
      sensitive_action_reason: 'whatever',
    }));
    expect(parsed.stage).toBe('implementation');
    expect(parsed.sensitiveActionVerdict).toBeUndefined();
  });

  it('a non-string or whitespace-only reason degrades to absent', () => {
    for (const reason of [42, '', '   ', null, ['x']]) {
      const parsed = parseStageClassifierReply(JSON.stringify({
        ...baseReply,
        sensitive_action_verdict: 'not_proposed',
        sensitive_action_reason: reason,
      }));
      expect(parsed.sensitiveActionReason).toBeUndefined();
    }
  });

  it('fields absent entirely parse to absent — the pre-activation state of every real call', () => {
    const parsed = parseStageClassifierReply(JSON.stringify(baseReply));
    expect(parsed.sensitiveActionVerdict).toBeUndefined();
    expect(parsed.sensitiveActionReason).toBeUndefined();
  });
});

describe('the plumbing is CONNECTED end to end through compose (the wiring-exists proof)', () => {
  it('a valid clearance suppresses the canonical sentence on the deterministic path', () => {
    const body = composeBenignRiskyBody({
      verdict: 'not_proposed',
      reason: "'drop' here means a CSS box-shadow; no data or file is being removed",
    });
    expect(body).not.toContain(CANONICAL_MARKER);
  });

  it('a reasonless clearance is void ON THE WIRED PATH too — the sentence ships', () => {
    const body = composeBenignRiskyBody({ verdict: 'not_proposed' });
    expect(body).toContain(CANONICAL_MARKER);
  });
});

describe('INERTNESS — with the field absent, behaviour is today\'s to the byte', () => {
  it('the absent-clearance body is byte-identical to the pre-change golden, sentence included', () => {
    const body = composeBenignRiskyBody(undefined);
    expect(body).toBe(GOLDEN_BODY);
    expect(body).toContain(CANONICAL_MARKER);
  });

  it('explicitly-undefined and key-absent compose identically', () => {
    const route = { a: composeBenignRiskyBody(undefined), b: composeBenignRiskyBody() };
    expect(route.a).toBe(route.b);
  });
});
