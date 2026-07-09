// Re-export bridge — keeps src/decision-session/options.ts in place (10k+ lines, zero regression risk).
// Core and browser callers import types + resolver from here; the static content stays in its original file.
export type { OptionEntry, DecisionContent } from '../../decision-session/options.js';
export { resolveDecisionContent, SHOW_SIMPLER, SKIP_NOW } from '../../decision-session/options.js';

import type { LLMPort } from '../ports/llm.port.js';
import type { UserProfile, PromptRecord } from '../classifier/types.js';
import type { DecisionContent } from '../../decision-session/options.js';
import {
  generateOptionList as generateOptionListImpl,
  type GeneratedOptions,
  type OptionGenContext,
} from '../../decision-session/OptionGenerator.js';
import { llmToOpenAIClient } from './llm-openai-shim.js';

export type { GeneratedOptions, OptionGenContext };

/**
 * LLMPort-based entry point for the personalised option generator — the browser
 * + core parity for how the CLI calls `decision-session/OptionGenerator`.
 *
 * Delegates to the unchanged, battle-tested engine `generateOptionList` through
 * an LLMPort→OpenAI-SDK shim, so both worlds run identical option-generation
 * logic (vocabulary adaptation, feature-noun embedding, R4/R5 runtime
 * substitutions). CLI: pass an OpenAILLMAdapter; browser: pass a FetchLLMAdapter.
 *
 * Never throws — returns null on any failure so callers fall back to static
 * options, exactly like the engine.
 */
export async function generateOptionList(
  content:  DecisionContent,
  profile:  UserProfile | undefined,
  language: string | undefined,
  history:  PromptRecord[],
  context:  OptionGenContext | undefined,
  llm:      LLMPort,
): Promise<GeneratedOptions | null> {
  return generateOptionListImpl(content, profile, language, history, context, llmToOpenAIClient(llm));
}
