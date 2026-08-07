import OpenAI from 'openai';
import type { PromptEnhancementSectionPlanningResult } from './templates/section-plan.js';
import type { PromptEnhancementStructuredComposerOutputV1 } from './compose-enhancement.js';
import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_OUTPUT_TOKEN_CAP_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
  PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1,
} from './cost-observability.js';
import { isPromptEnhancementLanguageConsistentV1 } from './language-consistency.js';

const STRONGER_LANGUAGE_DIRECTIVE =
  '\n\nIMPORTANT: your previous reply drifted from the original language. Write EVERY section' +
  " strictly in the original prompt's language, slang, and script (do NOT switch to English), and set" +
  ' detectedLanguageSelfReport correctly.';

/**
 * E4 — bounded LLM composer wording call.
 *
 * Produces a {@link PromptEnhancementStructuredComposerOutputV1} for the E2-planned
 * sections via one gpt-4o-mini call, mirroring the existing Nexpath LLM pattern
 * (`stage-classifier.ts`): an injectable client (default `new OpenAI()`), the
 * shared cost caps, and — critically — **any** failure resolves to a TYPED
 * `{ ok: false, reason }` result (TI-2 fix 2026-08-07) so the facade can map the
 * failure onto the runtime states that already exist, while `composePromptEnhancement
 * Body` still renders deterministically. Previously every failure collapsed to
 * `undefined`, making a provider timeout byte-identical to "never eligible for an
 * LLM call" in the UI, logs, and cost metadata simultaneously. This function never
 * throws to its caller.
 *
 * It only proposes wording. `composePromptEnhancementBody` independently validates
 * every draft (section id must be planned + non-original, no leaked ids/labels,
 * `sourceFactIds ⊆` the section's refs, `claim:` union) and rejects → deterministic
 * fallback, so a bad model reply is always safe.
 */
export interface PromptEnhancementComposerClientV1 {
  chat: {
    completions: {
      create: (
        body: {
          model: string;
          max_tokens: number;
          messages: readonly { role: 'system' | 'user'; content: string }[];
          response_format?: { type: 'json_object' };
        },
        options?: { timeout?: number; maxRetries?: number },
      ) => Promise<{ choices?: readonly { message?: { content?: string | null } }[] }>;
    };
  };
}

export type PromptEnhancementComposerDirectionalActionV1 =
  | 'shorter'
  | 'more_thorough'
  | 'more_project_grounded'
  | 'apply_details';

/**
 * TI-2 (2026-08-07): why a composer call produced no usable output. `no_key` and
 * `no_eligible_sections` mean the call was genuinely NOT MADE (the facade keeps them as
 * "not requested"); the other three are real provider/output failures the facade maps onto
 * the existing `PromptEnhancementComposerRuntimeState` failure states.
 */
export type PromptEnhancementComposerCallFailureReasonV1 =
  | 'no_key'
  | 'no_eligible_sections'
  | 'provider_error'
  | 'timeout'
  | 'invalid_output';

/** Discriminated composer-call result (TI-2): success carries the output; failure carries WHY. */
export type PromptEnhancementComposerCallResultV1 =
  | { ok: true; output: PromptEnhancementStructuredComposerOutputV1 }
  | { ok: false; reason: PromptEnhancementComposerCallFailureReasonV1 };

/**
 * Classify a thrown provider error as timeout vs any-other provider failure. The OpenAI SDK
 * raises `APIConnectionTimeoutError` ("Request timed out.") on the per-call `timeout` option;
 * match by name first, message shape as fallback, so an injected non-SDK client behaves the same.
 */
function composerErrorReason(error: unknown): 'timeout' | 'provider_error' {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && /timeout/i.test(name)) return 'timeout';
  return /timed?\s?out/i.test(String(error)) ? 'timeout' : 'provider_error';
}

export interface PromptEnhancementComposerLlmInputV1 {
  enhancementId: string;
  originalPromptText: string;
  planning: PromptEnhancementSectionPlanningResult;
  // E8: when set, word the recomposition in this directional action's style; the
  // section set / canonical state is chosen by composePromptEnhancementBody.
  action?: PromptEnhancementComposerDirectionalActionV1;
  additionalDetailsText?: string;
}

// E8: per-action wording directive (the section selection + canonical-state transitions
// stay in composePromptEnhancementBody / adjustment-state; this only shapes wording).
function actionWordingDirective(
  action: PromptEnhancementComposerDirectionalActionV1 | undefined,
  additionalDetailsText: string | undefined,
): string {
  switch (action) {
    case 'shorter':
      return "\n\nRecomposition style — SHORTER: make each section as concise as possible while keeping every required point, safety/confirmation, and source-signal guidance. Cut filler, never substance.";
    case 'more_thorough':
      return '\n\nRecomposition style — MORE THOROUGH: add depth and completeness (specific steps, edge cases, verification) without inventing scope or adding alternative variants.';
    case 'more_project_grounded':
      return '\n\nRecomposition style — MORE PROJECT-GROUNDED: ground each section in the available project facts and source references provided; do not invent project details.';
    case 'apply_details':
      return `\n\nRecomposition style — APPLY DETAILS: incorporate these additional user details into the relevant sections and recompose the whole prompt to reflect them:\n${additionalDetailsText ?? ''}`;
    default:
      return '';
  }
}

const SYSTEM_PROMPT = [
  "You are Nexpath's prompt-enhancement composer. You word guidance sections that will",
  "become the user's own next prompt to their coding agent — write in the user's first-person",
  'voice as direct, methodical instructions, never as advice ABOUT the user and never mentioning',
  'Nexpath. Do not restate the original request; other sections handle that.',
  '',
  'Language fidelity (E5 — critical):',
  '- Write ALL generated section wording in the SAME language, slang, and code-switching as the',
  "  user's original prompt below. Mirror their exact register — do NOT normalize to formal English",
  '  or to a standard language (Hinglish is NOT Hindi; Gujlish is NOT Gujarati). Preserve even slight slang.',
  '- Report the detected language of the original prompt in "detectedLanguageSelfReport" as a BCP-47-ish',
  '  code (e.g. "en", "hi", "hi-Latn" for Hinglish, "gu", "gu-Latn" for Gujlish).',
  '',
  'Authority boundary (critical):',
  '- Keep every generated section in the SAME mode as the original request. If it asks to plan, review,',
  '  check, prepare, assess, or investigate, do NOT write instructions that carry out the work: no',
  '  deploying, releasing to production, deleting, migrating, installing, publishing, or force-pushing.',
  '- Express the same substance within that mode instead — what to check, what evidence to gather, what',
  '  a plan or checklist would contain, what to verify, and which risks need confirmation first.',
  '- Never widen the scope, and never grant permission the original request did not already give.',
  '',
  'Rules:',
  '- Use ONLY the provided sectionId values; never invent a section or output the original-request section.',
  '- For each section, cite in sourceFactIds only the allowed source fact ids listed for THAT section.',
  '- Do not include internal ids, section kinds, or planning labels in bodyText.',
  '- Reply with STRICT JSON only, matching:',
  '  {"detectedLanguageSelfReport":"...","sectionDrafts":[{"sectionId":"...","bodyText":"...","sourceFactIds":["..."]}],"composerClaims":["claim:<sourceFactId>"]}',
  '- composerClaims must be the union of every sourceFactId you used, each prefixed with "claim:".',
].join('\n');

function buildUserPrompt(
  originalPromptText: string,
  sections: readonly { sectionId: string; sectionKind: string; structuredContentPartRefs: readonly string[] }[],
): string {
  const sectionLines = sections
    .map(
      (section) =>
        `- sectionId: ${section.sectionId}\n  purpose: ${section.sectionKind}\n  allowedSourceFactIds: ${JSON.stringify(section.structuredContentPartRefs)}`,
    )
    .join('\n');
  return [
    `Original request (context only — do NOT reword it):\n${originalPromptText}`,
    '',
    'Sections to word (produce one draft per section):',
    sectionLines,
  ].join('\n');
}

function parseStructuredComposerOutput(
  raw: string,
  enhancementId: string,
): PromptEnhancementStructuredComposerOutputV1 | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;

  const rawDrafts = Array.isArray(obj['sectionDrafts']) ? obj['sectionDrafts'] : [];
  const sectionDrafts = rawDrafts
    .filter((draft): draft is Record<string, unknown> => !!draft && typeof draft === 'object')
    .map((draft) => ({
      sectionId: typeof draft['sectionId'] === 'string' ? draft['sectionId'] : '',
      bodyText: typeof draft['bodyText'] === 'string' ? draft['bodyText'] : '',
      sourceFactIds: Array.isArray(draft['sourceFactIds'])
        ? draft['sourceFactIds'].filter((id): id is string => typeof id === 'string')
        : [],
    }))
    .filter((draft) => draft.sectionId !== '' && draft.bodyText !== '');
  if (sectionDrafts.length === 0) return undefined;

  const composerClaims = Array.isArray(obj['composerClaims'])
    ? obj['composerClaims'].filter((claim): claim is string => typeof claim === 'string')
    : [];

  const detectedLanguageSelfReport = typeof obj['detectedLanguageSelfReport'] === 'string'
    ? obj['detectedLanguageSelfReport']
    : undefined;

  return { outputId: `${enhancementId}:composer-llm`, sectionDrafts, composerClaims, detectedLanguageSelfReport };
}

export async function composeStructuredComposerOutputV1(
  input: PromptEnhancementComposerLlmInputV1,
  client?: PromptEnhancementComposerClientV1,
): Promise<PromptEnhancementComposerCallResultV1> {
  const sections = input.planning.sectionPlans.filter(
    (section) => section.sectionKind !== 'original_request_or_goal' && section.structuredContentPartRefs.length > 0,
  );
  if (sections.length === 0) return { ok: false, reason: 'no_eligible_sections' };

  let openai: PromptEnhancementComposerClientV1;
  try {
    // With no injected client and no key, `new OpenAI()` throws -> deterministic fallback.
    openai = client ?? (new OpenAI() as unknown as PromptEnhancementComposerClientV1);
  } catch {
    return { ok: false, reason: 'no_key' };
  }

  const userPrompt = buildUserPrompt(input.originalPromptText, sections) + actionWordingDirective(input.action, input.additionalDetailsText);
  // Malformed / empty / language-inconsistent replies retry up to the locked count
  // (§33348: retry up to 3 times). A thrown error (provider unavailable / timeout) is
  // NOT retried — fast deterministic fallback rather than repeated slow waits. On a
  // language mismatch the retry carries a stronger language directive (E5/5.3).
  let languageRetry = false;
  for (let attempt = 0; attempt <= PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1; attempt++) {
    let raw: string | null | undefined;
    try {
      const response = await openai.chat.completions.create(
        {
          model: PROMPT_ENHANCEMENT_COST_MODEL_V1,
          max_tokens: PROMPT_ENHANCEMENT_COST_OUTPUT_TOKEN_CAP_V1,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: languageRetry ? userPrompt + STRONGER_LANGUAGE_DIRECTIVE : userPrompt },
          ],
          response_format: { type: 'json_object' },
        },
        // maxRetries: 0 — THIS loop implements the locked retry policy; the SDK's own default
        // (2 internal retries per attempt) would multiply it into a minutes-long UI freeze.
        { timeout: PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1, maxRetries: 0 },
      );
      raw = response.choices?.[0]?.message?.content;
    } catch (error) {
      // Thrown provider error is NOT retried (fast deterministic fallback) — but it is now
      // REPORTED: timeout vs any other provider failure (TI-2).
      return { ok: false, reason: composerErrorReason(error) };
    }
    const parsed = raw ? parseStructuredComposerOutput(raw, input.enhancementId) : undefined;
    if (!parsed) continue; // malformed / empty -> retry
    if (!isPromptEnhancementLanguageConsistentV1(input.originalPromptText, parsed)) {
      // Uncovered language or English drift -> retry with a stronger directive.
      languageRetry = true;
      continue;
    }
    return { ok: true, output: parsed };
  }
  // Retries exhausted (malformed or persistent language mismatch) -> deterministic
  // English fallback (never ship English generated sections for a non-English prompt).
  return { ok: false, reason: 'invalid_output' };
}
