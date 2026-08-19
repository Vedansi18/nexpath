// MPS sequence — LLM-layer verification (Q1 tool). READ-ONLY: it imports and CALLS nexpath's real
// LLM layer end-to-end (prepare + sequence planner → items-2…N wording batch → intake). It changes
// ZERO production code — it only exercises the exported functions the Phase-1 spawn path relies on.
//
// It answers, live: does nexpath's LLM layer actually (1) generate a sequence, (2) word items 2…N,
// and (3) produce an intake that would record a valid pending-sequence row? That is the whole data
// path the MPS 2nd popup depends on.
//
// Run it WITH a key in the environment (never via a committed .env). It works from ANY directory:
//   npm run build   # dist must be current (in the nexpath repo)
//   OPENAI_API_KEY=sk-... node /path/to/nexpath/scripts/mps-sequence-llm-verify.mjs
//
// With no key it still validates setup (imports, request construction, store) and then stops before
// the live calls — so you can sanity-check the harness without spending a token.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The repo root is THIS file's directory's parent (scripts/..), resolved from the file location — so
// the script runs from any working directory, not just the repo root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (p) => join(ROOT, 'dist', p);

// ── imports from the built output (real nexpath functions) ───────────────────────────────────────
const { openStore }                              = await import(D('store/db.js'));
const { preparePromptEnhancementWithSequenceV1 } = await import(D('prompt-enhancement/facade.js'));
const { PROMPT_ENHANCEMENT_CONTRACT_VERSION }    = await import(D('prompt-enhancement/contracts.js'));
const { getPromptStartStopSourceSnapshot }       = await import(D('prompt-enhancement/source-reality.js'));
const { buildPromptEnhancementCostVisibilityMetadataV1 } = await import(D('prompt-enhancement/cost-observability.js'));
const { assemblePromptEnhancementSequenceBodyProducerInputV1, startSequenceWordingBatchV1 } = await import(D('prompt-enhancement/sequence-body-producer-stop-input.js'));
const { runPromptEnhancementSequenceBodyProducerV1 } = await import(D('prompt-enhancement/sequence-body-producer-runtime.js'));
const { intakePromptEnhancementSequenceOnFirstSendV1 } = await import(D('prompt-enhancement/sequence-intake.js'));
const { runPromptEnhancementSequencePlannerV1 } = await import(D('prompt-enhancement/sequence-planner.js'));
const { PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY, setPromptEnhancementSequenceEnabled } = await import(D('config/PromptEnhancementConfig.js'));
const { resolveOpenAIKey } = await import(D('config/ApiKeyResolver.js'));

// ── a multi-step candidate prompt (mirrors the facade test's candidateRequest) ────────────────────
const PROMPT = process.argv[2]
  ?? 'Fix the failing payment test, then add a rate limiter to the login endpoint and write a test for it.';

function buildRequest(text) {
  const sourceRef = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'seq-llm-verify-1', projectRoot: '/tmp/seq-llm-verify', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

// ── SETUP (no LLM) — validates imports + request + store even without a key ───────────────────────
const store = await openStore(':memory:');
setPromptEnhancementSequenceEnabled(store, PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY, 'on');
const req = buildRequest(PROMPT);
console.log('SETUP OK  · store ready · sequence-enabled=on · request built');
console.log('PROMPT:', JSON.stringify(PROMPT));

const key = await resolveOpenAIKey(ROOT);
if (!key) {
  console.log('\nNO KEY in the environment — setup validated, skipping the live calls.');
  console.log('Re-run with:  OPENAI_API_KEY=sk-... node scripts/mps-sequence-llm-verify.mjs');
  process.exit(0);
}

const OpenAI = (await import(ROOT + '/node_modules/openai/index.js')).default;
const client = new OpenAI(); // uses process.env.OPENAI_API_KEY set by the resolver

// ── STAGE 0 — DIRECT planner probe (LLM) — reveals the EXACT reason the planner fails ──────────────
// The facade swallows the planner's failure reason (falls back to the describe splitter silently). This
// calls runPromptEnhancementSequencePlannerV1 directly so we see {ok:false, reason} or a single-prompt
// outcome — the precise sub-cause behind an empty planner_items_json → empty items_json → no 2nd popup.
console.log('\n[0/3] DIRECT planner probe (why does the planner produce no items?)…');
try {
  const probe = await runPromptEnhancementSequencePlannerV1({
    promptContext: PROMPT,
    localOriginalText: PROMPT,
    entry: { promptOrigin: 'user', guidanceGateShow: true },
    db: store.db,
    projectRoot: '/tmp/seq-llm-verify',
  }, client);
  if (probe.ok) {
    console.log('  planner OK · outcome=' + probe.output.outcome +
      ' · items=' + (probe.output.items ? probe.output.items.length : 0));
    if (probe.output.outcome !== 'sequence') {
      console.log('  >>> the planner DECIDED single-prompt (outcome=' + probe.output.outcome + ') — not a check failure.');
    }
  } else {
    console.log('  planner REFUSED · reason=' + probe.reason + (probe.itemIndex !== undefined ? ' · itemIndex=' + probe.itemIndex : ''));
    console.log('  >>> THIS is the exact planner failure blocking the sequence. Fix this check/behaviour.');
  }
} catch (e) {
  console.log('  planner THREW:', (e && e.message) ? e.message : String(e));
}

// ── STAGE 1 — prepare + sequence planner (LLM) ────────────────────────────────────────────────────
console.log('\n[1/3] prepare + sequence planner (live)…');
const prepared = await preparePromptEnhancementWithSequenceV1(req, { db: store.db, client });
const result = prepared.result;
const plannerItems = prepared.plannerItems;
const plannerPromptDirectives = prepared.plannerPromptDirectives;
const summary = result.uiView?.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary;
console.log('  disposition:', result.disposition);
console.log('  handoff present:', Boolean(result.uiView?.handoffAndSequenceSummary));
console.log('  planner items:', plannerItems ? plannerItems.length : 0,
  plannerItems ? '[' + plannerItems.map((i) => i.itemKind).join(', ') + ']' : '');
console.log('  summary.remainingTaskCount:', summary ? summary.remainingTaskCount : '(none)');

if (!plannerItems || plannerItems.length < 2) {
  console.log('\nVERDICT: planner did NOT generate a multi-item sequence (fell back to single). Nothing to word.');
  process.exit(0);
}

// ── STAGE 2 — items-2…N wording batch (LLM) — this is the Q1 batch ────────────────────────────────
console.log('\n[2/3] items 2…N wording batch (live) — the Q1 batch…');
const assembled = assemblePromptEnhancementSequenceBodyProducerInputV1({
  result, plannerItems, plannerPromptDirectives,
});
if (!assembled.ok) { console.log('  assemble not ok:', assembled.reason, '→ nothing to word'); process.exit(0); }
const batch = startSequenceWordingBatchV1(
  assembled,
  (input) => runPromptEnhancementSequenceBodyProducerV1(input),
  (err) => console.log('  batch error:', String(err)),
);
const batchResult = await batch.awaitResult();
const wordedOk = Boolean(batchResult && batchResult.ok);
const wordedItems = wordedOk ? batchResult.items : [];
console.log('  batch started:', batch.started, ' ok:', wordedOk, ' worded items:', wordedItems.length);
if (batchResult && !batchResult.ok) {
  console.log('  >>> body producer FAILED · stage=' + batchResult.stage + ' · reason=' + batchResult.reason);
}
wordedItems.forEach((it, i) => {
  const w = it.generatedWording ?? it.wording ?? '';
  console.log(`    item[${i}] kind=${it.itemKind} wordedLen=${(w || '').length}`);
});

// ── STAGE 3 — intake (no LLM) — would a real pending-sequence row be recorded? ─────────────────────
console.log('\n[3/3] intake (would the row be recorded?)…');
const intake = intakePromptEnhancementSequenceOnFirstSendV1({
  result,
  projectRoot: '/tmp/seq-llm-verify',
  sessionId: 's1',
  wordedItems: wordedOk ? wordedItems : undefined,
  promptDirectives: plannerPromptDirectives,
});
console.log('  intake state:', intake.state, intake.state === 'sequence_recorded'
  ? '· itemCount=' + intake.runtime.itemCount + ' · payloadItems=' + (intake.payload?.items?.length ?? 0)
  : '· reasonCode=' + intake.reasonCode);

// ── VERDICT ───────────────────────────────────────────────────────────────────────────────────────
console.log('\n==================== VERDICT ====================');
const generated = plannerItems.length >= 2;
const worded = wordedOk && wordedItems.length >= 1;
const recorded = intake.state === 'sequence_recorded';
console.log('sequence generated :', generated ? 'YES' : 'no', '(' + plannerItems.length + ' items)');
console.log('items 2…N worded   :', worded ? 'YES' : 'no', '(' + wordedItems.length + ' worded)');
console.log('row would record   :', recorded ? 'YES' : 'no');
console.log(generated && worded && recorded
  ? 'GATE: PASS — the LLM layer produces a fully worded, recordable sequence (Phase-1 data path is live-verified).'
  : 'GATE: PARTIAL — see the stage that failed above.');
console.log('=================================================');
