import { redactSecrets } from '../store/redact.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';

/**
 * GR-1 (dev-plan §13.2 / §30.3 step 3) — the DETERMINISTIC FACT-RENDERING PATH,
 * the core of defect G4.
 *
 * 🔴 The measured defect: the deterministic renderer had no mechanism to place a
 * fact VALUE in a body. Every `line(...)` is a standing instruction, the
 * fall-through says *"Cover <heading>…"*, and `projectGroundingLine` says *"Use
 * the typed project/source metadata…"* — all three tell the reader to USE
 * grounding and none contains any. A no-key body therefore instructed about
 * facts it was holding.
 *
 * 🔴 The Phase-4 revert lesson, obeyed: a previous attempt widened the
 * projection with "no text field added" and collapsed to ONE CONSTANT LINE,
 * because every production fact carries `no_action_render_context_only`.
 * *"The missing step is RESOLUTION, not projection."* This renders group A's
 * resolved `evidence` payload — a fact with no resolved value produces NO line
 * here, and the section keeps its existing instruction. Nothing is invented to
 * fill a gap.
 *
 * The typed rules bind this path exactly as they bind the model (§41.3 / §44.1):
 * claim policy chooses the verb, anchor scope chooses the place, and the recency
 * band cannot be hidden. Deterministic — no LLM.
 */

/** Per-fact gates (§35 / §43.1). A gated fact never reaches wording at all. */
function isRenderableValueFactV1(fact: PromptEnhancementGuidanceFact): boolean {
  if (fact.privacyClass === 'do_not_render' || fact.sanitizationState === 'unsafe_to_render') return false;
  if (fact.claimVerbPolicy === 'do_not_render') return false;
  if (fact.renderPolicy === 'suppress_with_reason' || fact.renderPolicy === 'metadata_only') return false;
  if (fact.priority === 'suppressed') return false;
  return true;
}

/**
 * Reference-only facts state THAT a source exists, never its content
 * (`sensitive_ref_only`, `source_label_only`, and the served-provenance role).
 */
function isReferenceOnlyV1(fact: PromptEnhancementGuidanceFact): boolean {
  return (
    fact.privacyClass === 'sensitive_ref_only' ||
    fact.privacyClass === 'sensitive_suppress' ||
    fact.claimVerbPolicy === 'source_label_only' ||
    fact.factRole === 'served_variant_provenance_only'
  );
}

/** Where the knowledge is anchored — A4: a machine fact is never project architecture. */
function anchorPhraseV1(fact: PromptEnhancementGuidanceFact): string {
  switch (fact.sourceAnchorScope) {
    case 'machine_environment': return ' on this machine';
    case 'project_root': return ' in this project';
    case 'session_behavior': return ' in this session';
    case 'longitudinal_user_behavior': return ' in your recent work';
    case 'content_template_scope': return ' for this signal';
    default: return '';
  }
}

/**
 * L4977 honesty: stale/historical CANNOT be hidden. A months-old recollection
 * says so in the body rather than reading like something observed just now.
 */
function recencyPhraseV1(fact: PromptEnhancementGuidanceFact): string {
  switch (fact.recencyBand) {
    case 'historical': return ' (from earlier project history, not re-checked now)';
    case 'recent_project': return ' (from a recent project check)';
    case 'current_session': return ' (seen earlier this session)';
    case 'unknown': return ' (recency unknown)';
    default: return '';
  }
}

/**
 * The claim verb, from `claimVerbPolicy` — the same ceiling the composer prompt
 * puts on the model. A possibility-clamped fact may never be stated flatly.
 */
function claimSentenceV1(fact: PromptEnhancementGuidanceFact, key: string, value: string): string {
  const where = anchorPhraseV1(fact);
  const when = recencyPhraseV1(fact);
  switch (fact.claimVerbPolicy) {
    case 'may_state_as_user_practice':
      return `Your established practice${where}: ${key} is ${value}${when}.`;
    case 'may_state_as_project_capability':
      return `Known project fact${where}: ${key} is ${value}${when}.`;
    case 'must_have_behaviour_verified_practice':
      return `Behaviour-verified practice${where}: ${key} is ${value}${when}.`;
    case 'must_phrase_as_possibility':
      return `${key} appears to be ${value}${where}${when} — confirm before relying on it.`;
    case 'must_phrase_as_source_signal':
      return `The current source signal reports ${key} as ${value}${where}${when}.`;
    default:
      // Unknown or unset policy: the weakest wording, never a flat claim.
      return `${key} appears to be ${value}${where}${when} — confirm before relying on it.`;
  }
}

/**
 * The lines a section states from its own facts. Empty when nothing applies —
 * the caller then keeps the section's existing instruction, so a section with no
 * resolved fact is untouched by GR-1.
 */
export function promptEnhancementFactValueLinesV1(
  sectionKind: string,
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly string[] {
  const lines: string[] = [];
  for (const fact of facts) {
    if (fact.targetSectionKind !== sectionKind) continue;
    if (!isRenderableValueFactV1(fact)) continue;
    if (isReferenceOnlyV1(fact)) {
      // States THAT the source exists; never its content.
      lines.push(`A ${fact.sourceType.replaceAll('_', ' ')} source applies here; its content is withheld and must not be guessed.`);
      continue;
    }
    const evidence = fact.evidence;
    // ⛔ RESOLUTION, not projection: no resolved value means no line. The section
    // keeps its standing instruction rather than gaining an empty claim.
    if (!evidence || evidence.value.trim().length === 0) continue;
    // Defence in depth, matching the producer. `evidenceForGuidanceFact` already
    // redacts on the way in, so a production value arrives clean — but this is
    // the LAST hop before body text, and it renders whatever fact it is handed.
    // Without it a credential-shaped value reaches the body, the safety
    // validator's secret-literal patterns reject the whole body, and the user
    // loses the popup entirely rather than seeing a masked value.
    lines.push(claimSentenceV1(fact, evidence.key.replaceAll('_', ' '), redactSecrets(evidence.value.trim())));
  }
  return lines;
}

/**
 * The resolved VALUES a section legitimately states — the allow-list companion to
 * the lines above. Same gates: a withheld or reference-only fact contributes no
 * value, so nothing gated can be smuggled into the invention allow-list.
 */
export function promptEnhancementGroundedValuesV1(
  sectionKind: string,
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly string[] {
  const values: string[] = [];
  for (const fact of facts) {
    if (fact.targetSectionKind !== sectionKind) continue;
    if (!isRenderableValueFactV1(fact) || isReferenceOnlyV1(fact)) continue;
    // Must match what the renderer states, or the allow-list would permit a raw
    // value the body never contained and miss the masked one it does.
    const value = fact.evidence?.value.trim();
    if (value) values.push(redactSecrets(value));
  }
  return values;
}

/**
 * GR-2 step 1: the RESOLVED facts a section may cite, for the MODEL's prompt.
 *
 * Same gates as the body renderer, deliberately: a fact that may not be rendered
 * may not be shown to the model either — the prompt is an outbound surface, so a
 * withheld value must not travel there under the excuse that "the model decides".
 * Reference-only facts are included WITHOUT their value, so the model knows a
 * source exists and can cite it without seeing content it may not use.
 */
export function promptEnhancementSectionModelFactsV1(
  sectionKind: string,
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly {
  readonly factId: string;
  readonly sourceType: string;
  readonly confidenceBand: string;
  readonly originScope: string;
  readonly claimVerbPolicy: string;
  readonly evidence: string | undefined;
}[] {
  const out: {
    factId: string; sourceType: string; confidenceBand: string;
    originScope: string; claimVerbPolicy: string; evidence: string | undefined;
  }[] = [];
  for (const fact of facts) {
    if (fact.targetSectionKind !== sectionKind) continue;
    if (!isRenderableValueFactV1(fact)) continue;
    const referenceOnly = isReferenceOnlyV1(fact);
    const value = fact.evidence?.value.trim();
    out.push({
      factId: fact.factId,
      sourceType: fact.sourceType,
      confidenceBand: fact.confidenceBand ?? 'unknown',
      originScope: fact.sourceOriginScope ?? 'unknown',
      claimVerbPolicy: fact.claimVerbPolicy ?? 'must_phrase_as_possibility',
      evidence: referenceOnly || !value ? undefined : `${fact.evidence!.key} = ${redactSecrets(value)}`,
    });
  }
  return out;
}
