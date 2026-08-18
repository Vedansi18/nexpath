import { describe, expect, it } from 'vitest';
import {
  promptEnhancementFactValueLinesV1,
  promptEnhancementSectionModelFactsV1,
} from './fact-value-render.js';
import {
  applyPromptEnhancementSourceMixV1,
  estimatePromptEnhancementPayloadWeightV1,
} from './source-mix.js';
import {
  isPromptEnhancementRenderableRuntimePathV1,
  type PromptEnhancementGuidanceFact,
  type PromptEnhancementSelectionStateV1,
  type PromptEnhancementSourceRuntimePathV1,
} from './templates/section-plan.js';

/**
 * A6 — tier-4 observability fields (dev-plan §7.7), and the bill's two owed fixtures:
 * the RUNTIME-SEAM gate and FACT-ID STABILITY.
 *
 * The done-when: "the contract's fields all exist on the fact with locked names-or-proven-renames;
 * nothing lives only as a mixer local."
 */

function fact(overrides: Partial<PromptEnhancementGuidanceFact> = {}): PromptEnhancementGuidanceFact {
  return {
    factId: 'f-1',
    sourceType: 'absence_signal',
    sourceIds: ['absence:verification_gap@implementation'],
    guidanceKind: 'missing_practice',
    suggestedActionKind: 'add_verification',
    targetFamily: 'family_agnostic',
    targetSectionKind: 'verification_or_test_plan',
    sourceEvidenceState: 'strong',
    priority: 'required_survivor',
    renderPolicy: 'render_as_section',
    riskLevel: 'low',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    ...overrides,
  };
}

describe('A6 — nothing lives only as a mixer local', () => {
  it('the mixer decision is PROMOTED onto every classified fact', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [fact(), fact({ factId: 'f-2', priority: 'normal' })],
      'default',
    );
    expect(result.classifiedFacts.length).toBeGreaterThan(0);
    for (const entry of result.classifiedFacts) {
      // The done-when in one assertion: reading the FACT is enough — no consumer needs the envelope.
      expect(entry.fact.selectionState, `${entry.fact.factId} has no selectionState`).toBeDefined();
      expect(entry.fact.selectionReasonCodes, `${entry.fact.factId} has no reason codes`).toBeDefined();
      expect(entry.fact.selectionReasonCodes?.length).toBeGreaterThan(0);
      expect(entry.fact.sourceMixFactId).toBeDefined();
      expect(typeof entry.fact.payloadWeight).toBe('number');
    }
  });

  it('the promoted state MATCHES the mixer role — a copy that drifts is worse than none', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [fact(), fact({ factId: 'f-2', priority: 'normal' })],
      'default',
    );
    for (const entry of result.classifiedFacts) {
      expect(entry.fact.selectionState).toBe(entry.selectionRole as PromptEnhancementSelectionStateV1);
      expect(entry.fact.selectionReasonCodes).toEqual([entry.selectionReasonCode]);
    }
  });
});

// ── The bill's runtime-seam fixture ─────────────────────────────────────────

describe('A6 / L4970 — an unknown or hidden runtime path must not DRIVE rendered guidance', () => {
  const ALL_PATHS: readonly PromptEnhancementSourceRuntimePathV1[] = [
    'local_static', 'local_store', 'local_probe', 'local_read_model',
    'runtime_llm_param_extract', 'runtime_llm_grounding', 'runtime_autogen', 'unknown',
  ];

  it('the locked eight are all typed, and exactly one of them is non-renderable', () => {
    expect(ALL_PATHS).toHaveLength(8);
    expect(ALL_PATHS.filter((path) => !isPromptEnhancementRenderableRuntimePathV1(path))).toEqual(['unknown']);
  });

  it('an UNKNOWN path is refused as a driver of rendered guidance', () => {
    expect(isPromptEnhancementRenderableRuntimePathV1('unknown')).toBe(false);
  });

  it('every DECLARED path is allowed — the gate blocks the hidden case, not the seams', () => {
    // The lock's concern is a path nobody can account for. A declared runtime seam is exactly what
    // PE-EM-1 visibility exists to report, so blocking those would defeat the field's purpose.
    for (const path of ALL_PATHS.filter((candidate) => candidate !== 'unknown')) {
      expect(isPromptEnhancementRenderableRuntimePathV1(path), `${path} was refused`).toBe(true);
    }
  });

  it('an absent path is not silently treated as unknown', () => {
    // Absence means "nobody stamped it", which is a different fact from "the path is hidden".
    // Conflating them would let a producer that simply has not been wired look like a leak.
    expect(isPromptEnhancementRenderableRuntimePathV1(undefined)).toBe(true);
  });
});

// ── The bill's fact-id stability fixture ────────────────────────────────────

describe('A6 / L4964 — sourceMixFactId is stable per popup-session and never rendered', () => {
  it('the same input yields the same id — a re-run does not renumber facts', () => {
    const input = [fact(), fact({ factId: 'f-2', priority: 'normal' })];
    const first = applyPromptEnhancementSourceMixV1(input, 'default');
    const second = applyPromptEnhancementSourceMixV1(input, 'default');
    const idsOf = (result: typeof first) => result.classifiedFacts.map((entry) => entry.fact.sourceMixFactId);
    expect(idsOf(first)).toEqual(idsOf(second));
  });

  it('DIFFERENT facts get different ids — stability is not sameness', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [fact(), fact({ factId: 'f-2', priority: 'normal' })],
      'default',
    );
    const ids = result.classifiedFacts.map((entry) => entry.fact.sourceMixFactId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the id never reaches rendered text — it carries no prompt content to render', () => {
    // L4964 says "never rendered". The structural guarantee is that the id is built from ids only,
    // so even a mistaken render would leak no user content — and nothing in the render path reads it.
    const result = applyPromptEnhancementSourceMixV1([fact({ evidence: { key: 'secret_key', value: 'secret-value' } })], 'default');
    const id = result.classifiedFacts[0]?.fact.sourceMixFactId ?? '';
    expect(id).not.toContain('secret-value');
    expect(id).toContain('f-1');
  });
});

// ── payloadWeight (L4979) ───────────────────────────────────────────────────

describe('A6 / L4979 — payloadWeight is a relative cap/visibility estimate', () => {
  it('a fact carrying more evidence weighs more', () => {
    const light = estimatePromptEnhancementPayloadWeightV1(fact({ evidence: { key: 'k', value: 'v' } }));
    const heavy = estimatePromptEnhancementPayloadWeightV1(
      fact({ evidence: { key: 'test_runner', value: 'vitest with a long configuration description attached' } }),
    );
    expect(heavy).toBeGreaterThan(light);
  });

  it('a fact with no evidence still has a weight — its source ids cost something', () => {
    expect(estimatePromptEnhancementPayloadWeightV1(fact())).toBeGreaterThan(0);
  });
});

describe('A6 done-when — the contract\'s 19 fields all exist, by locked name or proven rename', () => {
  // "the contract's 19 fields all exist on the fact with locked names-or-proven-renames".
  // A type-level claim needs a type-level check: this object must name every field, so adding a
  // locked field without wiring it — or renaming a shipped one — stops compiling rather than
  // quietly reducing the count.
  it('every locked field is reachable on the fact type', () => {
    const probe: Required<Pick<PromptEnhancementGuidanceFact,
      | 'sourceMixFactId'      // L4964
      | 'sourceType'           // locked `sourceKind`, rename proven at A2
      | 'sourceIds'
      | 'sourceOriginScope'
      | 'sourceAnchorScope'
      | 'sourceRuntimePath'    // L4970
      | 'sourceEligibilityState' // L4971
      | 'sourceEvidenceState'  // locked `evidenceState`, rename proven at A2
      | 'factRole'
      | 'claimVerbPolicy'
      | 'targetFamily'
      | 'targetSectionKind'
      | 'confidenceBand'
      | 'recencyBand'
      | 'privacyClass'         // locked `sensitivityClass`, superset pinned at A2
      | 'payloadWeight'        // L4979
      | 'fatigueKey'           // L4980
      | 'selectionState'       // L4981
      | 'selectionReasonCodes' // L4982
    >> = {
      sourceMixFactId: 'mix:1:f-1',
      sourceType: 'absence_signal',
      sourceIds: ['absence:x'],
      sourceOriginScope: 'current_prompt',
      sourceAnchorScope: 'project_root',
      sourceRuntimePath: 'local_probe',
      sourceEligibilityState: 'fresh_trigger_eligible',
      sourceEvidenceState: 'strong',
      factRole: 'required_source_signal_survivor',
      claimVerbPolicy: 'must_phrase_as_source_signal',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'verification_or_test_plan',
      confidenceBand: 'high',
      recencyBand: 'current_prompt',
      privacyClass: 'public_safe',
      payloadWeight: 12,
      fatigueKey: 'fatigue:abc123',
      selectionState: 'selected_required',
      selectionReasonCodes: ['required_source_signal_survivor'],
    };
    expect(Object.keys(probe)).toHaveLength(19);
  });
});

describe('A6 / L4970 — the gate is APPLIED, not merely typed', () => {
  // Verification round 1: A6 shipped `isPromptEnhancementRenderableRuntimePathV1` as a predicate
  // that NOTHING called, so the lock's requirement — "unknown/hidden runtime path must never drive
  // rendered guidance" — was unenforced while its fixture passed. The gate now sits in
  // `isRenderableValueFactV1`, the seam where a fact's VALUE becomes body text, and these assert
  // the behaviour rather than the predicate.
  const groundingFact = (path?: PromptEnhancementSourceRuntimePathV1): PromptEnhancementGuidanceFact => ({
    ...fact({
      factId: 'runtime-1',
      sourceType: 'hard_fact',
      guidanceKind: 'project_grounding',
      suggestedActionKind: 'ground_in_project_fact',
      targetSectionKind: 'project_grounding_facts',
      priority: 'normal',
      claimVerbPolicy: 'may_state_as_project_capability',
      sourceOriginScope: 'local_probe',
      sourceAnchorScope: 'project_root',
      evidence: { key: 'test_runner', value: 'vitest' },
    }),
    ...(path === undefined ? {} : { sourceRuntimePath: path }),
  });

  it('an UNKNOWN runtime path renders NO value line', () => {
    expect(promptEnhancementFactValueLinesV1('project_grounding_facts', [groundingFact('unknown')])).toEqual([]);
  });

  it('a DECLARED runtime path renders normally — the gate blocks the hidden case only', () => {
    const lines = promptEnhancementFactValueLinesV1('project_grounding_facts', [groundingFact('local_probe')]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('vitest');
  });

  it('an ABSENT path still renders — unstamped is not hidden', () => {
    // Every producer that predates the field would fall silent otherwise, which would turn an
    // observability field into a behaviour change.
    const lines = promptEnhancementFactValueLinesV1('project_grounding_facts', [groundingFact(undefined)]);
    expect(lines).toHaveLength(1);
  });
});

describe('A6 — the SKIP paths carry the observability too', () => {
  // Verification round 2: the promotion ran only before the FINAL return, so every skip — no
  // Source-A survivor, Source-B-only, invalid-source fallback — returned classified facts with none
  // of the tier-4 fields. That is exactly backwards: a skipped popup is the case someone needs
  // explained, and observability that only exists on the success path explains the case nobody asks
  // about.
  const sourceBOnly = (): PromptEnhancementGuidanceFact => fact({
    factId: 'grounding-1',
    sourceType: 'hard_fact',
    guidanceKind: 'project_grounding',
    suggestedActionKind: 'ground_in_project_fact',
    targetSectionKind: 'project_grounding_facts',
    sourceOriginScope: 'local_probe',
    evidence: { key: 'test_runner', value: 'vitest' },
  });

  it('a fact on the no-survivor skip path still carries state, codes, id and weight', () => {
    const result = applyPromptEnhancementSourceMixV1([sourceBOnly()], 'default');
    expect(result.showPopup).toBe(false);
    const entry = result.classifiedFacts.find((row) => row.fact.factId === 'grounding-1');
    expect(entry, 'the fact vanished from the skip result').toBeDefined();
    expect(entry?.fact.selectionState).toBeDefined();
    expect(entry?.fact.selectionReasonCodes?.length).toBeGreaterThan(0);
    expect(entry?.fact.sourceMixFactId).toBeDefined();
    expect(typeof entry?.fact.payloadWeight).toBe('number');
  });

  it('the skip reason is the one the mixer recorded, not a placeholder', () => {
    const result = applyPromptEnhancementSourceMixV1([sourceBOnly()], 'default');
    const entry = result.classifiedFacts.find((row) => row.fact.factId === 'grounding-1');
    expect(entry?.fact.selectionReasonCodes).toEqual([entry?.selectionReasonCode]);
  });
});

describe('A6 / L4964 — "never rendered", checked at both outbound surfaces', () => {
  // The lock says the id is local identity only. Two surfaces can leak it: the BODY the user sends,
  // and the MODEL payload GR-2 built. Both are checked, because typing a field as internal does not
  // keep it out of a string someone builds later.
  const renderableFact = (): PromptEnhancementGuidanceFact => fact({
    factId: 'render-1',
    sourceType: 'hard_fact',
    guidanceKind: 'project_grounding',
    suggestedActionKind: 'ground_in_project_fact',
    targetSectionKind: 'project_grounding_facts',
    priority: 'normal',
    claimVerbPolicy: 'may_state_as_project_capability',
    sourceOriginScope: 'local_probe',
    sourceAnchorScope: 'project_root',
    sourceRuntimePath: 'local_probe',
    evidence: { key: 'test_runner', value: 'vitest' },
    sourceMixFactId: 'mix:9:render-1',
  });

  it('the body never contains the mix fact id', () => {
    const lines = promptEnhancementFactValueLinesV1('project_grounding_facts', [renderableFact()]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).not.toContain('mix:9:render-1');
  });

  it('the MODEL payload never contains it either — it cites the guidance ref, not the mix id', () => {
    const payload = promptEnhancementSectionModelFactsV1('project_grounding_facts', [renderableFact()]);
    expect(payload.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain('mix:9:render-1');
    expect(payload[0]?.factId).toBe('guidance_fact:render-1');
  });
});
