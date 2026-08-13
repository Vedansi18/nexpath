/**
 * Prompt-enhancement body assertion — live provider, deliberately NOT part of the vitest run.
 *
 *   npm run pe:body-assertion
 *
 * The deterministic suite can prove the pipeline runs. It cannot prove the body it produces is
 * ABOUT the user's request rather than about its own section headings. That needs a real model,
 * so this is a script and not a test: it costs money, it needs a key, and it is recorded by hand
 * rather than gating CI.
 *
 * Three mechanical checks, all oracle-free — none scores quality, because there is no agreed
 * scorer and a made-up threshold would be worse than no threshold:
 *
 *   1. THE MODEL RAN. A body the deterministic renderer produced is boilerplate whether or not it
 *      trips the checks below, so this is asked first. It is not implied by them: the twelve mapped
 *      section kinds emit their own fixed strings, which are NOT the fall-through sentence, so a
 *      plan made only of mapped kinds renders entirely from constants and counts zero — and two
 *      such bodies still differ from each other because their section SETS differ.
 *   2. NO FALL-THROUGH SENTENCE. A guidance section with no entry in the content map renders one
 *      fixed sentence with its own heading pasted in. Any occurrence means the model did not word
 *      that section.
 *   3. CROSS-PROMPT DISTINCTNESS. No two prompts may produce the same guidance text. This is the
 *      defect stated directly: a body whose section SET varies by intent while its section TEXT
 *      never varies at all is generic no matter how it reads in isolation.
 *
 * Word-overlap scoring is deliberately NOT used. A body can name the user's subject in its own
 * vocabulary — "checkout flow", "error codes", "payment methods" for a prompt about a failing
 * Stripe checkout — and score low while being exactly right. That judgement is a human read, and
 * this script prints every body in full so it can be made.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparePromptEnhancement } from '../src/prompt-enhancement/facade.js';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from '../src/prompt-enhancement/contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from '../src/prompt-enhancement/cost-observability.js';
import { getPromptStartStopSourceSnapshot } from '../src/prompt-enhancement/source-reality.js';
import { isValidApiKey } from '../src/config/ApiKeyResolver.js';
import {
  collectPromptEnhancementBodyAssertionFailuresV1,
  countPromptEnhancementFallThroughSentencesV1,
  isPromptEnhancementBodyAssertionCheckerCurrentV1,
} from '../src/prompt-enhancement/body-assertion-checks.js';

/**
 * Both traffic shapes. Engineer-written prompts name their artefact; casual ones do not, and a
 * body that only works for the first kind is not a fix.
 */
const PROMPTS: readonly { shape: 'engineer' | 'casual'; text: string }[] = [
  { shape: 'engineer', text: 'The invoice PDF shows a null address for customers created after the migration. Fix it.' },
  { shape: 'engineer', text: 'Add a retry with exponential backoff to the webhook sender in src/webhooks/send.ts.' },
  { shape: 'engineer', text: "The login page throws 'Cannot read property id of undefined' after the session refactor." },
  { shape: 'engineer', text: 'Write a migration to add a nullable phone_number column to the users table.' },
  { shape: 'casual', text: 'make the landing page look more modern and professional' },
  { shape: 'casual', text: 'why is my app so slow' },
  { shape: 'casual', text: 'add dark mode to the settings page' },
  { shape: 'casual', text: 'i need to send emails when someone signs up' },
  { shape: 'casual', text: 'my stripe checkout keeps failing for some customers and i dont know why' },
  { shape: 'casual', text: 'build me a dashboard that shows how many users signed up each day' },
];

/**
 * Guard against this script going stale. The sentence it hunts for is built inline in the renderer,
 * so a rewording there would leave it looking for text that no longer exists — and it would then
 * pass every run while checking nothing.
 */
function assertCheckerIsCurrent(): void {
  const rendererPath = join(process.cwd(), 'src', 'prompt-enhancement', 'compose-enhancement.ts');
  let renderer = '';
  try {
    renderer = readFileSync(rendererPath, 'utf8');
  } catch {
    process.stderr.write(`PE body assertion: cannot read ${rendererPath} to self-check.\n`);
    process.exit(1);
  }
  if (!isPromptEnhancementBodyAssertionCheckerCurrentV1(renderer)) {
    process.stderr.write(
      'PE body assertion: STALE CHECKER — the fall-through sentence it looks for is no longer in\n'
      + 'compose-enhancement.ts. Update body-assertion-checks.ts before trusting a pass.\n',
    );
    process.exit(1);
  }
}

function baseRequest(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current',
    confidence: 'high', privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'pe-body-assertion',
    projectRoot: process.cwd(),
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: {
      text: '', origin: 'user', capturedAt: 1, promptIndex: 1,
      generatedOriginPolicy: 'ordinary_source_a',
    },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write',
      projectId: 'project-1', sessionId: 'session-1', detectedLanguage: 'en',
      stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [],
      triggerProvenance: {
        currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition',
        classifierState: 'fire_recommended', degradedNoActionState: 'none',
        promptStartBoundary: promptStartStop.hookBoundary,
        deliveryBoundary: promptStartStop.deliveryBoundary,
        promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef],
      normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [],
      popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [],
      rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [],
      sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: {
        hookBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary,
        runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: promptStartStop.sharedSignalCount,
        classifierDegradedNoFireReasons: promptStartStop.classifierDegradedNoFireReasons,
      },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] },
      transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [],
      servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: {
      sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid',
      arbitraryConfigRowsAreAuthority: false,
    },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', {
      callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0,
    }),
    privacyAndStoragePolicy: {
      sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only',
      telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal',
      generatedBodyStoragePolicy: 'do_not_store_raw_by_default',
    },
  };
}

async function main(): Promise<void> {
  assertCheckerIsCurrent();

  if (!isValidApiKey(process.env['OPENAI_API_KEY'] ?? '')) {
    process.stderr.write(
      'PE body assertion: no valid OPENAI_API_KEY. This check needs a live provider — without one the\n'
      + 'deterministic renderer answers, which is the thing being checked against.\n',
    );
    process.exit(1);
  }

  const collected: { prompt: string; bodyText: string; composed: boolean }[] = [];

  for (const { shape, text } of PROMPTS) {
    const base = baseRequest();
    const request = { ...base, sourcePrompt: { ...base.sourcePrompt, text } } as PromptEnhancementPrepareRequestV1;

    const startedAt = Date.now();
    const result = await preparePromptEnhancement(request);
    const elapsedMs = Date.now() - startedAt;

    const bodyText = result.currentBody.text;
    const mode = result.callAndVisibilityMetadata.callVisibilityMode;
    const fallThrough = countPromptEnhancementFallThroughSentencesV1(bodyText);

    process.stdout.write(`\n${'='.repeat(78)}\n[${shape}] ${text}\n`);
    process.stdout.write(`disposition=${result.disposition} mode=${mode} model=${result.modelVersion} ${elapsedMs}ms fallThrough=${fallThrough}\n`);
    process.stdout.write(`${'-'.repeat(78)}\n${bodyText}\n`);

    collected.push({ prompt: text, bodyText, composed: mode === 'llm_wording' });
  }

  const failures = collectPromptEnhancementBodyAssertionFailuresV1(collected);

  process.stdout.write(`\n${'='.repeat(78)}\n`);
  if (failures.length > 0) {
    process.stderr.write(`PE body assertion: FAILED — ${failures.length} finding(s):\n`);
    for (const failure of failures) process.stderr.write(`  ${failure}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `PE body assertion: OK — ${PROMPTS.length} prompts, both shapes. Every body composed by the\n`
    + 'model, zero fall-through sentences, no two prompts sharing guidance text.\n'
    + 'The bodies above still need a human read: these checks prove the model wrote them, not that\n'
    + 'what it wrote is good advice.\n',
  );
}

await main();
