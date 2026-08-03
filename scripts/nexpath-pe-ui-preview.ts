/**
 * Nexpath PE / MPS terminal-UI preview.
 *
 * Renders the REAL popup frames (not mock-ups) so anyone can see and user-test
 * exactly what the terminal UI looks like:
 *   - the Prompt-Enhancement (PE) popup — via the real facade → render-model →
 *     frame path, and
 *   - the Multi-Prompt-Sequence (MPS) first popup (§3.3) — via the real
 *     b3-first-popup model → §3.3 renderer.
 *
 * Run it:   npx tsx scripts/nexpath-pe-ui-preview.ts
 * Plain (no colour, for capture/CI):   NEXPATH_PREVIEW_PLAIN=1 npx tsx scripts/nexpath-pe-ui-preview.ts
 *
 * This is a preview/demo harness only — it invents no runtime, delivery, or
 * transport; the MPS live path stays gated on the external DEP-B3-02 packet.
 */
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION, type PromptEnhancementPrepareRequestV1, type PromptEnhancementSourceRefV1 } from '../src/prompt-enhancement/contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from '../src/prompt-enhancement/cost-observability.js';
import { getPromptStartStopSourceSnapshot } from '../src/prompt-enhancement/source-reality.js';
import { preparePromptEnhancement } from '../src/prompt-enhancement/facade.js';
import { buildPromptEnhancementPopupRenderModelV1 } from '../src/prompt-enhancement/popup-render-model.js';
import { renderPromptEnhancementPopupFrameV1, type PromptEnhancementCliPopupViewV1 } from '../src/prompt-enhancement/cli-submit-popup.js';
import {
  renderPromptEnhancementMpsFirstPopupFrameV1,
} from '../src/prompt-enhancement/cli-mps-popup.js';
import {
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1,
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1,
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1,
  type PromptEnhancementMpsFirstPopupModelV1,
} from '../src/prompt-enhancement/b3-first-popup.js';

const COLORIZE = process.env['NEXPATH_PREVIEW_PLAIN'] !== '1';

function peRequest(promptText: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'preview-src-1',
    sourceKind: 'source_a_user_prompt',
    sourceId: 'prompt:preview',
    sourceAuthorization: 'source_fact_only',
    evidenceStatus: 'present',
    freshness: 'current',
    confidence: 'high',
    privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'ui-preview-1',
    projectRoot: '/tmp/preview-project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: promptText, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation',
      currentAgentMode: 'workspace-write',
      projectId: 'preview-project',
      sessionId: 'preview-session',
      detectedLanguage: 'en',
      stageCandidate: 'implementation',
      promptCount: 1,
      recentPromptMetadataRefs: [],
      triggerProvenance: {
        currentStage: 'implementation',
        prevStage: 'task_breakdown',
        triggerKind: 'stage_transition',
        classifierState: 'fire_recommended',
        degradedNoActionState: 'none',
        promptStartBoundary: p.hookBoundary,
        deliveryBoundary: p.deliveryBoundary,
        promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef,
      sourceRefs: [sourceRef],
      normalizedStageAbsenceSignalRefs: [],
      contentTemplateRecordFactRefs: [],
      popupQuestionSourceRefs: [],
      whyHelpSourceRefs: [],
      profileRoleModeRefs: [],
      rightGoodWorkStyleEnvRuntimeRefs: [],
      missingMemoryCandidateRefs: [],
      sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: {
        hookBoundary: p.hookBoundary,
        deliveryBoundary: p.deliveryBoundary,
        runAutoCanHoldOrReplaceSubmittedPrompt: false,
        sharedSignalCount: p.sharedSignalCount,
        classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons,
      },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] },
      transcriptPathState: 'not_authority',
      streamBOutputs: [],
      paramEventChannels: [],
      servedVariantIdentityRefs: [],
      deliveryGateRefs: [],
      sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: {
      sensitivityClass: 'normal',
      localStorageEligibility: 'ids_and_categories_only',
      telemetryEligibility: 'allowlisted_counts_only',
      llmSharingEligibility: 'allowed_minimal',
      generatedBodyStoragePolicy: 'do_not_store_raw_by_default',
    },
  };
}

async function renderPeFrame(promptText: string): Promise<string> {
  const prepared = await preparePromptEnhancement(peRequest(promptText));
  const rendered = buildPromptEnhancementPopupRenderModelV1({ result: prepared, timestampMs: 1, deliverySurface: prepared.delivery.deliveryChannel });
  if (rendered.state !== 'render_model_ready') return `(no PE popup — ${rendered.reasonCodes.join(', ')})`;
  const view: PromptEnhancementCliPopupViewV1 = { model: rendered.model, editedBodyText: prepared.currentBody.text, additionalDetailsText: '' };
  return renderPromptEnhancementPopupFrameV1(view, { focusIndex: 0, helpExpanded: false, colorize: COLORIZE });
}

function mpsFirstModel(): PromptEnhancementMpsFirstPopupModelV1 {
  return {
    surface: 'prompt_enhancement_mps_first_popup',
    title: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1,
    heading: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1,
    layout: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1,
    identity: { requestId: 'ui-preview-1', projectRoot: '/tmp/preview-project', handoffDecisionId: 'handoff-1', currentBodyId: 'body-1', bodyRevision: 1, itemLineageRefs: ['handoff-slice:body-1:1'] },
    body: { text: 'Step 1 of the sequence: reproduce the failing checkout test and capture the exact error.', editable: true, originalPromptText: 'Run the checkout fix sequence.', originalPromptPreservation: 'visible_verbatim' },
    additionalDetails: { visible: true, text: 'Keep changes scoped to the payments module.', revision: 1 },
    actions: {
      submitCurrentBody: 'typed_current_body_plus_details',
      cancelRemainingSequence: { label: 'Cancel (remaining multi-prompt sequence)', state: 'available', disposition: 'blocked_no_send' },
      originalPrompt: 'not_rendered',
    },
    sequencePlan: { remainingTaskCount: 3, taskRoleLabels: ['reproduce', 'fix', 'verify'] },
    keyboard: { plainEnter: 'emit_one_typed_current_body_plus_details_request', escape: 'leave_editor_focus_preserve_draft', ctrlOrCmdJ: 'insert_newline', ctrlOrCmdUpDown: 'move_by_line', leftRight: 'move_by_character' },
    authority: { localSequenceRuntime: false, localQueuePointer: false, localAutoSend: false, localAdvance: false, hostTransport: false },
  };
}

function banner(title: string): string {
  return `\n${'═'.repeat(64)}\n  ${title}\n${'═'.repeat(64)}\n`;
}

async function main(): Promise<void> {
  const out: string[] = [];
  out.push(banner('1 · Prompt-Enhancement popup (PE) — shown on prompt submit'));
  out.push(await renderPeFrame('Fix the failing payment test and explain the verification.'));
  out.push(banner('2 · Multi-Prompt-Sequence first popup (MPS · §3.3)'));
  out.push(renderPromptEnhancementMpsFirstPopupFrameV1(mpsFirstModel(), { focusIndex: 0, colorize: COLORIZE }));
  out.push('\n(MPS live runtime is gated on DEP-B3-02; this preview shows the rendered UI from a validated model.)\n');
  process.stdout.write(out.join('\n'));
}

void main();
