import { createHash } from 'node:crypto';
import {
  isPromptEnhancementSourceCriticalFactV1,
  type PromptEnhancementGuidanceFact,
} from './templates/section-plan.js';

/**
 * F3 (dev-plan §12.4 / L4980) — the per-guidance fatigue KEY.
 *
 * 🔒 L4980: *"Stable the source rule/the fatigue rule key for repeated guidance fatigue, without
 * raw prompt text. Fatigue fixtures fail on… safety/source-critical facts
 * learned away."*
 *
 * ⚠️ The two nagging causes are DIFFERENT and both are needed (§42.3): C4 fixed
 * the user who ALREADY SUPPLIED the evidence we were asking for; this fixes the
 * user we have ASKED REPEATEDLY and been ignored by. Neither subsumes the other.
 *
 * ⛔ This does NOT build a second fatigue mechanism. PE already fades over-shown
 * memory in `memory-scoring.ts` — with the same safety invariant — but that lane
 * is keyed by `signalKey` on the memory-record side. What was missing is a key on
 * the GUIDANCE FACT, so repeated guidance is recognisable per guidance rather
 * than per stored signal. The scorer stays the consumer of fade decisions; this
 * module only produces the key and answers whether a fact may be faded at all.
 *
 * Deterministic — no LLM, no clock, no I/O.
 */

/** Key format version — bump only if the composition below changes shape. */
const FATIGUE_KEY_VERSION_V1 = 'pef1';

/**
 * A fact carrying a SENSITIVE treatment state (A4 / L4995). Two consequences,
 * and they are deliberately the same set: its identity is fingerprinted so no
 * sensitive reference is stored in a key, AND it is never faded. Treating a fact
 * as too sensitive to name while still letting fatigue suppress it would be
 * incoherent — and prohibition 17 protects the confirmation lane by name.
 */
function isSensitiveFactV1(fact: PromptEnhancementGuidanceFact): boolean {
  return (
    fact.privacyClass === 'sensitive_ref_only' ||
    fact.privacyClass === 'sensitive_generalize' ||
    fact.privacyClass === 'sensitive_suppress' ||
    fact.privacyClass === 'requires_confirmation' ||
    fact.privacyClass === 'do_not_render' ||
    fact.sanitizationState === 'sensitive_ref_only' ||
    fact.sanitizationState === 'unsafe_to_render' ||
    fact.riskLevel === 'sensitive_authority_risky'
  );
}

/**
 * PROMPT-SCOPED identity — fingerprinted, but still fadeable.
 *
 * ⛔ Step 1's prohibition made STRUCTURAL rather than incidental. No producer
 * emits a prompt-derived fact today, so nothing prompt-shaped currently reaches
 * `sourceIds` — but "never raw prompt text" must not rest on that staying true.
 *
 * Kept SEPARATE from sensitivity on purpose: this is about not storing a user's
 * words, not about safety. Folding it into the never-faded set would disable
 * fatigue for prompt-derived guidance, which is exactly the guidance most likely
 * to repeat — the opposite of what F3 is for.
 */
function isPromptScopedForKeyV1(fact: PromptEnhancementGuidanceFact): boolean {
  return fact.sourceType === 'prompt_derived_fact' || fact.sourceOriginScope === 'current_prompt';
}

function needsFingerprintV1(fact: PromptEnhancementGuidanceFact): boolean {
  return isSensitiveFactV1(fact) || isPromptScopedForKeyV1(fact);
}

/**
 * The digest separator. NUL cannot occur in a source id or a project scope, so
 * joining with it keeps the digest UNAMBIGUOUS: ['a b','c'] and ['a','b c']
 * must not fingerprint alike, and with a space separator they would.
 *
 * ⚠️ Written as an ESCAPE on purpose. It first went in as a literal NUL byte,
 * which works at runtime but makes the file binary to grep/diff and invisible to
 * a reader — the same silent-corruption shape as F2's mangled regex escapes. A
 * tool that normalised that byte away would have quietly changed every key.
 */
const SEPARATOR_V1 = '\u0000';

/** Stable, non-reversing digest. Truncated: this identifies, it does not authenticate. */
function fingerprintV1(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join(SEPARATOR_V1)).digest('hex').slice(0, 16);
}

/**
 * Build the fatigue key for one fact.
 *
 * ⛔ Returns `undefined` when no project scope is available. A key without a
 * project scope would be GLOBAL, and a global key fades a user's guidance in one
 * project because they ignored it in another — the exact failure L4980's own
 * gate names. No key means no match, which merely forgoes fatigue; that is the
 * safe direction.
 *
 * The scope is ALWAYS fingerprinted, never embedded literally: callers pass a
 * project id or root path, and a root path is a local filesystem literal.
 */
export function buildPromptEnhancementFatigueKeyV1(input: {
  readonly fact: PromptEnhancementGuidanceFact;
  readonly projectScopeId: string | undefined;
}): string | undefined {
  const scope = input.projectScopeId?.trim();
  if (!scope) return undefined;

  const fact = input.fact;
  // Sorted so that two facts differing only in source-id ORDER share a key.
  const sourceIds = [...fact.sourceIds].sort();
  const identity = needsFingerprintV1(fact)
    ? `fp_${fingerprintV1(sourceIds)}`
    : sourceIds.join('+');

  // Composition: scope + what the guidance IS + where it lands + which sources
  // raised it. Deliberately excludes anything prompt-derived (no promptText, no
  // resolved evidence value), so the key is stable across rephrasings of the
  // same underlying guidance — which is what "repeated guidance" means.
  return [
    FATIGUE_KEY_VERSION_V1,
    fingerprintV1([scope]),
    fact.guidanceKind,
    fact.targetSectionKind,
    identity,
  ].join(':');
}

/**
 * 🔒 The locked guard (prohibition 17 / L4980): safety and source-critical facts
 * are NEVER faded by fatigue. Asking a user twice about a secret in their prompt
 * is not nagging worth suppressing — being ignored is precisely when the warning
 * matters most.
 *
 * Source-criticality uses the canonical predicate the gate and the mixer use, so
 * the three cannot drift apart.
 */
export function isPromptEnhancementFatigueEligibleV1(fact: PromptEnhancementGuidanceFact): boolean {
  if (isPromptEnhancementSourceCriticalFactV1(fact)) return false;
  // Sensitive treatment states are safety states: a fact whose identity must be
  // hidden from a stored key is not one to suppress for being repetitive.
  if (isSensitiveFactV1(fact)) return false;
  if (fact.factRole === 'safety_confirmation_support') return false;
  if (fact.guidanceKind === 'safety_or_confirmation') return false;
  if (fact.safetyHooks.length > 0) return false;
  return true;
}

/**
 * Stamp the key onto every produced fact at ONE choke point.
 *
 * The producer has seven fact-construction sites and will gain more; stamping at
 * each is how a later one silently ships keyless. A fact that may never be faded
 * gets NO key at all — the guard is then structural rather than a check some
 * future consumer has to remember to call.
 */
export function stampPromptEnhancementFatigueKeysV1(
  facts: readonly PromptEnhancementGuidanceFact[],
  projectScopeId: string | undefined,
): readonly PromptEnhancementGuidanceFact[] {
  return facts.map((fact) => {
    if (!isPromptEnhancementFatigueEligibleV1(fact)) return fact;
    const fatigueKey = buildPromptEnhancementFatigueKeyV1({ fact, projectScopeId });
    return fatigueKey === undefined ? fact : { ...fact, fatigueKey };
  });
}
