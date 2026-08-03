/**
 * Nexpath PE / MPS terminal-UI END-TO-END walkthrough + self-checking harness.
 *
 * Drives the REAL pipeline the way a user actually runs it:
 *   - PE popup: real facade → render-model → frame, then simulated keypresses
 *     decoded + reduced by the real interaction reducer, asserting the emitted
 *     typed commands for each user journey (send, edit+send, apply details,
 *     Shorter, cancel).
 *   - MPS first popup (§3.3) and continuation popup (§3.4): render the real
 *     frames and exercise the real typed intents (send / interruption / cancel).
 *
 * Run it:   npx tsx scripts/nexpath-ui-e2e.ts
 * Plain (no colour):   NEXPATH_PREVIEW_PLAIN=1 npx tsx scripts/nexpath-ui-e2e.ts
 *
 * Exits non-zero if any journey assertion fails. Invents no runtime/transport;
 * the MPS live path stays gated on DEP-B3-02.
 */
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION, type PromptEnhancementPrepareRequestV1, type PromptEnhancementSourceRefV1 } from '../src/prompt-enhancement/contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from '../src/prompt-enhancement/cost-observability.js';
import { getPromptStartStopSourceSnapshot } from '../src/prompt-enhancement/source-reality.js';
import { preparePromptEnhancement } from '../src/prompt-enhancement/facade.js';
import { buildPromptEnhancementPopupRenderModelV1 } from '../src/prompt-enhancement/popup-render-model.js';
import {
  buildPromptEnhancementCliActionRowsV1,
  buildPromptEnhancementCliInteractionStateV1,
  decodePromptEnhancementCliKeyV1,
  reducePromptEnhancementCliInteractionV1,
  renderPromptEnhancementPopupFrameV1,
  type PromptEnhancementCliPopupViewV1,
  type PromptEnhancementPopupRenderModelV1,
} from '../src/prompt-enhancement/cli-submit-popup.js';
import {
  renderPromptEnhancementMpsContinuationFrameV1,
  renderPromptEnhancementMpsFirstPopupFrameV1,
} from '../src/prompt-enhancement/cli-mps-popup.js';
import {
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1,
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1,
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1,
  createPromptEnhancementMpsCancelIntentV1,
  createPromptEnhancementMpsCurrentBodyIntentV1,
  type PromptEnhancementMpsFirstPopupModelV1,
} from '../src/prompt-enhancement/b3-first-popup.js';
import {
  PROMPT_ENHANCEMENT_MPS_CONTINUATION_LAYOUT_V1,
  PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_HEADING_V1,
  PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_TITLE_V1,
  PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1,
  PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1,
  createPromptEnhancementMpsContinuationCancelIntentV1,
  createPromptEnhancementMpsContinuationSendIntentV1,
  createPromptEnhancementMpsCustomInterruptionIntentV1,
  type PromptEnhancementMpsContinuationPopupModelV1,
} from '../src/prompt-enhancement/b3-continuation-popup.js';

const COLORIZE = process.env['NEXPATH_PREVIEW_PLAIN'] !== '1';
const ESC_BYTE = String.fromCharCode(27);
const RAW: Record<string, string> = { up: `${ESC_BYTE}[A`, down: `${ESC_BYTE}[B`, enter: String.fromCharCode(13), esc: ESC_BYTE };
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (ok) passed += 1; else failed += 1;
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} → ${detail}\n`);
}

function peRequest(promptText: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'e2e-src-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:e2e', sourceAuthorization: 'source_fact_only',
    evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'ui-e2e-1', projectRoot: '/tmp/e2e-project', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: promptText, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'e2e-project', sessionId: 'e2e-session',
      detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [],
      triggerProvenance: {
        currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended',
        degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [],
      popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [],
      sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [],
      paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

async function peModel(): Promise<{ model: PromptEnhancementPopupRenderModelV1; body: string }> {
  const prepared = await preparePromptEnhancement(peRequest('Fix the failing payment test and explain the verification.'));
  const rendered = buildPromptEnhancementPopupRenderModelV1({ result: prepared, timestampMs: 1, deliverySurface: prepared.delivery.deliveryChannel });
  if (rendered.state !== 'render_model_ready') throw new Error(`no PE model: ${rendered.reasonCodes.join(', ')}`);
  return { model: rendered.model, body: prepared.currentBody.text };
}

/** Drive a fresh interaction state through a list of raw keys; return accumulated commands. */
function drivePe(model: PromptEnhancementPopupRenderModelV1, body: string, details: string, keys: readonly string[]): { type: string }[] {
  let s = buildPromptEnhancementCliInteractionStateV1({ model, editedBodyText: body, additionalDetailsText: details, fieldWidth: 72, viewportRows: 10 });
  const rows = buildPromptEnhancementCliActionRowsV1(model);
  const commands: { type: string }[] = [];
  for (const raw of keys) {
    const res = reducePromptEnhancementCliInteractionV1(s, rows, decodePromptEnhancementCliKeyV1(raw));
    s = res.state;
    commands.push(...(res.commands as { type: string }[]));
  }
  return commands;
}

function mpsFirstModel(): PromptEnhancementMpsFirstPopupModelV1 {
  return {
    surface: 'prompt_enhancement_mps_first_popup', title: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1, heading: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1, layout: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1,
    identity: { requestId: 'ui-e2e-1', projectRoot: '/tmp/e2e-project', handoffDecisionId: 'handoff-1', currentBodyId: 'body-1', bodyRevision: 1, itemLineageRefs: ['handoff-slice:body-1:1'] },
    body: { text: 'Step 1 of the sequence: reproduce the failing checkout test and capture the exact error.', editable: true, originalPromptText: 'Run the checkout fix sequence.', originalPromptPreservation: 'visible_verbatim' },
    additionalDetails: { visible: true, text: 'Keep changes scoped to the payments module.', revision: 1 },
    actions: { submitCurrentBody: 'typed_current_body_plus_details', cancelRemainingSequence: { label: 'Cancel (remaining multi-prompt sequence)', state: 'available', disposition: 'blocked_no_send' }, originalPrompt: 'not_rendered' },
    sequencePlan: { remainingTaskCount: 3, taskRoleLabels: ['reproduce', 'fix', 'verify'] },
    keyboard: { plainEnter: 'emit_one_typed_current_body_plus_details_request', escape: 'leave_editor_focus_preserve_draft', ctrlOrCmdJ: 'insert_newline', ctrlOrCmdUpDown: 'move_by_line', leftRight: 'move_by_character' },
    authority: { localSequenceRuntime: false, localQueuePointer: false, localAutoSend: false, localAdvance: false, hostTransport: false },
  };
}

function mpsContinuationModel(): PromptEnhancementMpsContinuationPopupModelV1 {
  return {
    surface: 'prompt_enhancement_mps_continuation_popup', title: PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_TITLE_V1, heading: PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_HEADING_V1, layout: PROMPT_ENHANCEMENT_MPS_CONTINUATION_LAYOUT_V1,
    identity: { requestId: 'ui-e2e-1', projectRoot: '/tmp/e2e-project', sequenceId: 'seq-1', sequenceItemId: 'item-2', currentItemRevision: 2, bodyRevision: 1, detailsRevision: 1 },
    body: { text: 'Next sequence step: apply the fix and run the focused checkout test.', editable: true, originalPromptText: 'Run the checkout fix sequence.' },
    additionalDetails: { visible: true, text: 'Keep scope to the payments module.', revision: 1 },
    actions: { submitCurrentBody: 'typed_current_body_plus_details', customInterruption: { label: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1, helper: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1 }, cancelRemainingSequence: { label: 'Cancel (remaining multi-prompt sequence)', state: 'available', disposition: 'blocked_no_send' }, originalPrompt: 'not_rendered' },
    keyboard: { plainEnter: 'emit_one_typed_current_body_plus_details_request', escape: 'leave_editor_focus_preserve_draft', ctrlOrCmdJ: 'insert_newline', ctrlOrCmdUpDown: 'move_by_line', leftRight: 'move_by_character' },
    authority: { localSequenceRuntime: false, localQueuePointer: false, localAutoSend: false, localAdvance: false, stopIsCompletionProof: false, customInterruptionIsCancel: false, hostTransport: false },
  };
}

function banner(title: string): string {
  return `\n${'═'.repeat(70)}\n  ${title}\n${'═'.repeat(70)}\n`;
}

async function main(): Promise<void> {
  process.stdout.write('NEXPATH PE / MPS — END-TO-END WALKTHROUGH (real pipeline)\n');

  // ---- PE popup ----
  const { model, body } = await peModel();
  const view: PromptEnhancementCliPopupViewV1 = { model, editedBodyText: body, additionalDetailsText: '' };
  process.stdout.write(banner('1 · Prompt-Enhancement popup — what the user sees'));
  process.stdout.write(`${renderPromptEnhancementPopupFrameV1(view, { focusIndex: 0, helpExpanded: false, colorize: COLORIZE })}\n`);

  process.stdout.write(banner('1b · PE user journeys (simulated keypresses → typed commands)'));
  const j1 = drivePe(model, body, '', [RAW.enter!]);
  check('Enter on body → send as-is', j1.length === 1 && j1[0]!.type === 'use_current', JSON.stringify(j1.map((c) => c.type)));
  const j2 = drivePe(model, body, '', ['X', RAW.enter!]);
  check('Type "X" then Enter → edit then send', j2.map((c) => c.type).join(',') === 'edit_body,use_current', JSON.stringify(j2.map((c) => c.type)));
  const j3 = drivePe(model, body, '', [RAW.down!, 'n', 'o', 't', 'e', 's', RAW.enter!]);
  check('Down, type "notes", Enter → apply details', j3.length === 1 && j3[0]!.type === 'apply_details', JSON.stringify(j3));
  const j4 = drivePe(model, body, '', [RAW.down!, RAW.down!, RAW.enter!]);
  check('Down×2 to Shorter, Enter → refine', j4.length === 1 && j4[0]!.type === 'shorter', JSON.stringify(j4.map((c) => c.type)));
  const j5 = drivePe(model, body, '', [RAW.esc!]);
  check('Esc → cancel/close path', j5.length >= 1, JSON.stringify(j5.map((c) => c.type)));
  const j6 = drivePe(model, '', '', [RAW.enter!]);
  check('Blank body + Enter → no send (BF-1 guard)', j6.length === 0, JSON.stringify(j6.map((c) => c.type)));

  // ---- MPS first popup ----
  const first = mpsFirstModel();
  process.stdout.write(banner('2 · MPS first popup (§3.3) — what the user sees'));
  process.stdout.write(`${renderPromptEnhancementMpsFirstPopupFrameV1(first, { focusIndex: 0, colorize: COLORIZE })}\n`);
  process.stdout.write(banner('2b · MPS first-popup intents'));
  const fSend = createPromptEnhancementMpsCurrentBodyIntentV1(first, { editedBodyText: first.body.text });
  check('Send current body', fSend.state === 'intent_ready' && fSend.intent?.type === 'send_current_body', fSend.intent?.type ?? fSend.state);
  const fCancel = createPromptEnhancementMpsCancelIntentV1(first);
  check('Cancel remaining sequence (blocked_no_send)', fCancel.state === 'intent_ready' && fCancel.intent?.type === 'cancel_remaining_sequence', fCancel.intent?.type ?? fCancel.state);

  // ---- MPS continuation popup ----
  const cont = mpsContinuationModel();
  process.stdout.write(banner('3 · MPS continuation popup (§3.4) — what the user sees'));
  process.stdout.write(`${renderPromptEnhancementMpsContinuationFrameV1(cont, { focusIndex: 0, colorize: COLORIZE })}\n`);
  process.stdout.write(banner('3b · MPS continuation lifecycle (3 paths)'));
  const cSend = createPromptEnhancementMpsContinuationSendIntentV1(cont, { editedBodyText: cont.body.text });
  check('Path 1 — send current item', cSend.state === 'intent_ready' && cSend.intent?.type === 'send_current_body', cSend.intent?.type ?? cSend.state);
  const cInt = createPromptEnhancementMpsCustomInterruptionIntentV1(cont);
  check('Path 2 — interruption (not cancel, not completion)', cInt.state === 'intent_ready' && cInt.intent?.type === 'custom_interruption' && cont.authority.customInterruptionIsCancel === false && cont.authority.stopIsCompletionProof === false, cInt.intent?.type ?? cInt.state);
  const cCancel = createPromptEnhancementMpsContinuationCancelIntentV1(cont);
  check('Path 3 — terminal cancel (blocked_no_send)', cCancel.state === 'intent_ready' && cCancel.intent?.type === 'cancel_remaining_sequence', cCancel.intent?.type ?? cCancel.state);

  process.stdout.write(`\n${'═'.repeat(70)}\n  SUMMARY: ${passed} passed, ${failed} failed  (of ${passed + failed} E2E journeys)\n${'═'.repeat(70)}\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
