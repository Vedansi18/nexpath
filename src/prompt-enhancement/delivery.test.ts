import { describe, expect, it } from 'vitest';
import { closeStore, openStore } from '../store/index.js';
import type { PromptEnhancementCurrentBodyV1 } from './contracts.js';
import {
  createPromptEnhancementTransportDiagnostic,
  createPromptEnhancementExtensionDeliveryPayload,
  evaluatePromptEnhancementHostCapability,
  preparePromptEnhancementStopBridgeDelivery,
  resolvePromptEnhancementPromptSubmitOrigin,
  validatePromptEnhancementExtensionDeliveryPayload,
} from './delivery.js';

const body = {
  currentBodyId: 'body-phase-9',
  bodyRevision: 3,
  composerRunId: 'composer-phase-9',
  routeDecisionId: 'route-debug',
  promptReviewOrigin: 'user_authored_current_prompt',
  promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
  sentPromptOrigin: 'pe_baseline_generated_body',
  nexpathGeneratedPromptRef: 'body-phase-9:generated:3',
  renderedPromptBody: 'Original request:\nFix payment retry.\n\nPlan:\nReproduce, patch, verify.',
  originalPromptSectionId: 'section-original',
  sourceAttribution: [
    {
      sourceRefId: 'source-current-prompt',
      sourceKind: 'source_a_user_prompt',
      sourceId: 'prompt:current',
      evidenceStatus: 'present',
      publicSafeLabel: 'current prompt',
      privateIdPolicy: 'metadata_only_not_body',
    },
    {
      sourceRefId: 'source-stage-signal',
      sourceKind: 'stage_or_absence_signal',
      sourceId: 'absence:debugging_observation_gap',
      evidenceStatus: 'present',
      publicSafeLabel: 'debugging signal',
      privateIdPolicy: 'metadata_only_not_body',
    },
  ],
  llmCallPolicy: 'no_call',
  composerMode: 'baseline_deterministic_render',
  languagePolicyApplied: 'technical_english_default',
  languageValidationStatus: 'valid',
  effectiveLanguageState: 'unknown_default',
  languageSource: 'technical_english_default',
  languageConfidence: 'unknown',
  languagePolicy: 'technical_english_default',
  instructionPrecedenceState: 'generated_sections_qualify_original',
  originalAsSourceStatus: 'local_verbatim_source_context',
  composerClaims: ['claim:original', 'claim:verification'],
  sourceFactIds: ['fact:original', 'fact:debug_signal'],
  localOriginalPromptIncluded: true,
  text: 'Fix payment retry by reproducing the failure, patching the smallest code path, and running the affected and full suites.',
  originalPromptText: 'Fix payment retry.',
  originalPromptPreservation: 'visible_verbatim',
  generatedOriginState: 'pe_generated_body',
  generatedSafeStatus: 'valid',
  userDirtyState: 'clean',
  sections: [
    {
      sectionId: 'section-original',
      sectionKind: 'original_request',
      title: 'Original request',
      bodyText: 'Fix payment retry.',
      templateType: 'debug_repair',
      familyId: 'debug_maintenance',
      primaryIntent: 'debug_and_verify',
      registryNamespace: 'prompt-enhancement-templates',
      sourceTemplateType: 'prompt_enhancement_template',
      sourceKind: 'source_a_user_prompt',
      sourceIds: ['prompt:current'],
      sourceFactIds: ['fact:original'],
      routeCandidateRefs: ['route-debug'],
      evidenceStatus: 'present',
      sourceEvidenceStatus: 'present',
      slotEvidenceStatus: 'present',
      baselineSourceSignalSlot: 'debugging_observation_gap',
      requirementSourceStatus: 'present',
      requiredSurvivor: true,
      mandatoryFloor: true,
      depthState: 'required_survivor',
      axisContributions: ['source_a'],
      canMergeInShorter: false,
      canExpandInMoreThorough: false,
      canGroundInMoreProjectGrounded: true,
      feedbackSensitivity: 'protected',
      fallbackBehavior: 'none',
      handoffFlags: [],
      privacyClass: 'local_private',
      publicCopySafe: false,
      authorityBoundary: 'no_authority_escalation',
      confirmationRequired: false,
      confirmationPresent: false,
      isEditable: true,
      removalFeedbackPolicy: 'typed_event_required',
      validationStatus: 'valid',
      safetyFlags: [],
      sensitivityFlags: [],
      spanRefs: [],
      publicExplanationCategory: 'source_coverage',
      whyHelpReasonCodes: ['original_preserved'],
      callVisibilityMode: 'deterministic',
      contentTemplateRuntimeSeamUse: 'none',
      handoffCapabilityFlags: ['no_runtime_sequence_v1'],
    },
    {
      sectionId: 'section-verify',
      sectionKind: 'verification_plan',
      title: 'Verification',
      bodyText: 'Run affected tests and full suite.',
      templateType: 'debug_repair',
      familyId: 'debug_maintenance',
      primaryIntent: 'debug_and_verify',
      registryNamespace: 'prompt-enhancement-templates',
      sourceTemplateType: 'prompt_enhancement_template',
      sourceKind: 'stage_or_absence_signal',
      sourceIds: ['absence:debugging_observation_gap'],
      sourceFactIds: ['fact:debug_signal'],
      routeCandidateRefs: ['route-debug'],
      evidenceStatus: 'present',
      sourceEvidenceStatus: 'present',
      slotEvidenceStatus: 'present',
      baselineSourceSignalSlot: 'debugging_observation_gap',
      requirementSourceStatus: 'present',
      requiredSurvivor: true,
      mandatoryFloor: false,
      depthState: 'standard',
      axisContributions: ['debugging_observation_gap'],
      canMergeInShorter: true,
      canExpandInMoreThorough: true,
      canGroundInMoreProjectGrounded: true,
      feedbackSensitivity: 'typed_feedback_allowed',
      fallbackBehavior: 'none',
      handoffFlags: [],
      privacyClass: 'public_safe',
      publicCopySafe: true,
      authorityBoundary: 'no_authority_escalation',
      confirmationRequired: false,
      confirmationPresent: false,
      isEditable: true,
      removalFeedbackPolicy: 'typed_event_required',
      validationStatus: 'valid',
      safetyFlags: [],
      sensitivityFlags: [],
      spanRefs: [],
      publicExplanationCategory: 'source_coverage',
      whyHelpReasonCodes: ['verification_required'],
      callVisibilityMode: 'deterministic',
      contentTemplateRuntimeSeamUse: 'none',
      handoffCapabilityFlags: ['no_runtime_sequence_v1'],
    },
  ],
} satisfies PromptEnhancementCurrentBodyV1;

describe('prompt-enhancement generated-origin delivery contract', () => {
  it('writes source-use before generated-origin and delivers current body through Stop as text-only transport', async () => {
    const store = await openStore(':memory:');
    try {
      const result = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-current',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-send-current',
        sendPolicy: 'send_current',
        now: 1000,
      });

      expect(result.outcome).toBe('stop_bridge_block');
      expect(result.stopBridgeDecision).toEqual({
        decision: 'block',
        reason: body.text,
        rawReasonIsTextCarrierOnly: true,
      });
      expect(result.delivery).toMatchObject({
        deliveryChannel: 'cli_stop_bridge',
        sendPolicy: 'send_current',
        stopReasonCarriesTextOnly: true,
        rawTransportIsSemanticAuthority: false,
        hostCapabilityState: 'stop_bridge_only',
      });
      expect(result.generatedOrigin).toMatchObject({
        generatedOriginId: 'delivery-current:origin',
        generatedOriginState: 'pe_generated_body',
        bodyId: 'body-phase-9',
        bodyRevision: 3,
        actionId: 'action-send-current',
        deliveryChannel: 'cli_stop_bridge',
        sourceUseIds: ['delivery-current:source:1', 'delivery-current:source:2'],
        echoRecursionGuard: {
          bodyFingerprintRef: 'body-phase-9:generated:3',
          sourcePromptEchoState: 'pe_generated_echo',
          lastInjectedPromptIsAuthority: false,
        },
      });
      expect(result.originLineage).toEqual({
        actionId: 'action-send-current',
        sequenceRuntimeState: 'not_sequence',
      });
      expect(result.invariants).toEqual({
        sourceUseRecordedBeforeTransport: true,
        sameTurnReplacementClaimed: false,
        autoSendClaimed: false,
        rawStopReasonIsSemanticAuthority: false,
        rawTransportIsSemanticAuthority: false,
      });

      const sourceRows = store.db.exec(
        'SELECT source_use_id, created_at FROM prompt_enhancement_source_use ORDER BY source_use_id ASC',
      )[0]?.values;
      const originRows = store.db.exec(
        'SELECT generated_origin_id, created_at, prompt_submit_processing_policy, learning_eligibility_json FROM prompt_enhancement_generated_origin',
      )[0]?.values;
      expect(sourceRows).toEqual([
        ['delivery-current:source:1', 1000],
        ['delivery-current:source:2', 1000],
      ]);
      expect(originRows?.[0]?.slice(0, 3)).toEqual([
        'delivery-current:origin',
        1001,
        'pe_generated_delivery_skip_classification',
      ]);
      expect(JSON.parse(originRows?.[0]?.[3] as string)).toMatchObject({
        promptHistory: false,
        profile: false,
        stage: false,
        language: false,
        missingSignalMemory: false,
        feedback: false,
        telemetry: false,
        sourceUseTracking: true,
      });
    } finally {
      closeStore(store);
    }
  });

  it('delivers original text with user-original origin and preserves normal prompt-submit processing', async () => {
    const store = await openStore(':memory:');
    try {
      const result = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-original',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-send-original',
        sendPolicy: 'send_original',
        now: 2000,
      });

      expect(result.transportedBody).toBe('original_prompt');
      expect(result.stopBridgeDecision?.reason).toBe('Fix payment retry.');
      expect(result.generatedOrigin).toMatchObject({
        generatedOriginState: 'user_original',
        sourceUseIds: ['delivery-original:source:original'],
        echoRecursionGuard: {
          sourcePromptEchoState: 'not_echo',
          lastInjectedPromptIsAuthority: false,
        },
      });

      const resolution = resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/phase9',
        bodyId: body.currentBodyId,
        bodyRevision: body.bodyRevision,
        generatedOriginId: 'delivery-original:origin',
        now: 2100,
        maxAgeMs: 1_000,
      });
      expect(resolution).toMatchObject({
        generatedOriginTrusted: false,
        processingPolicy: 'normal_user_prompt_full_processing',
        rawTransportIsSemanticAuthority: false,
        lastInjectedPromptIsAuthority: false,
        normalUserPromptFullProcessingPreserved: true,
      });
    } finally {
      closeStore(store);
    }
  });

  it('supports original-only/no-popup and deterministic/provider fallback delivery without generated-body authority', async () => {
    const store = await openStore(':memory:');
    try {
      const originalOnly = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-original-only',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-original-only',
        sendPolicy: 'original_only',
        readinessState: 'original_only_no_popup',
        now: 2500,
      });
      const deterministicFallback = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-deterministic-fallback',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-send-current',
        sendPolicy: 'send_current',
        readinessState: 'deterministic_fallback_ready',
        fallbackState: 'deterministic_body',
        now: 2600,
      });
      const providerFallback = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-provider-fallback',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-send-original',
        sendPolicy: 'send_original',
        readinessState: 'provider_api_unavailable_original_fallback',
        fallbackState: 'provider_api_unavailable',
        now: 2700,
      });

      expect(originalOnly).toMatchObject({
        outcome: 'stop_bridge_block',
        transportedBody: 'original_prompt',
        stopBridgeDecision: { reason: 'Fix payment retry.' },
        reasonCodes: expect.arrayContaining(['original_only_no_popup']),
      });
      expect(originalOnly.generatedOrigin).toMatchObject({
        generatedOriginState: 'user_original',
      });
      expect(deterministicFallback).toMatchObject({
        outcome: 'stop_bridge_block',
        transportedBody: 'current_body',
        reasonCodes: expect.arrayContaining(['deterministic_fallback_ready']),
      });
      expect(providerFallback).toMatchObject({
        outcome: 'stop_bridge_block',
        transportedBody: 'original_prompt',
        reasonCodes: expect.arrayContaining(['provider_api_unavailable_original_fallback']),
      });
      expect(store.db.exec(
        'SELECT generated_origin_id, fallback_state FROM prompt_enhancement_generated_origin WHERE generated_origin_id IN (?, ?) ORDER BY generated_origin_id ASC',
        ['delivery-deterministic-fallback:origin', 'delivery-provider-fallback:origin'],
      )[0]?.values).toEqual([
        ['delivery-deterministic-fallback:origin', 'deterministic_body'],
        ['delivery-provider-fallback:origin', 'provider_api_unavailable'],
      ]);
    } finally {
      closeStore(store);
    }
  });

  it('does not create transport authority for no-send or unsupported host states', async () => {
    const store = await openStore(':memory:');
    try {
      const noSend = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-no-send',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-close',
        sendPolicy: 'no_send',
        now: 3000,
      });
      const unsupported = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-unsupported',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-send-current',
        sendPolicy: 'send_current',
        hostCapabilityState: 'unsupported',
        now: 3001,
      });

      expect(noSend).toMatchObject({
        outcome: 'no_send',
        stopBridgeDecision: null,
        generatedOrigin: null,
        sourceUseIds: [],
      });
      expect(unsupported).toMatchObject({
        outcome: 'unsupported_host_fallback',
        stopBridgeDecision: null,
        generatedOrigin: null,
        sourceUseIds: [],
      });
      expect(store.db.exec('SELECT COUNT(*) FROM prompt_enhancement_generated_origin')[0]?.values[0]?.[0]).toBe(0);
      expect(store.db.exec('SELECT COUNT(*) FROM prompt_enhancement_source_use')[0]?.values[0]?.[0]).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('blocks Stop bridge transport for no-pending, no-renderer, no-tty, loop-guard, disabled-frequency, and validation states', async () => {
    const store = await openStore(':memory:');
    try {
      for (const readinessState of ['no_pending', 'no_tty', 'no_renderer', 'loop_guard', 'disabled_frequency', 'validation_blocked'] as const) {
        const result = preparePromptEnhancementStopBridgeDelivery(store, {
          deliveryAttemptId: `delivery-${readinessState.replaceAll('_', '-')}`,
          projectRoot: '/repo/phase9',
          enhancementId: 'enh-phase9',
          currentBody: body,
          actionId: 'action-send-current',
          sendPolicy: 'send_current',
          readinessState,
          now: 3500,
        });
        expect(result).toMatchObject({
          outcome: 'delivery_not_ready',
          transportedBody: 'none',
          stopBridgeDecision: null,
          generatedOrigin: null,
          originLineage: null,
          sourceUseIds: [],
          reasonCodes: expect.arrayContaining([readinessState, 'no_transport_without_ready_state']),
        });
      }
      expect(store.db.exec('SELECT COUNT(*) FROM prompt_enhancement_generated_origin')[0]?.values[0]?.[0]).toBe(0);
      expect(store.db.exec('SELECT COUNT(*) FROM prompt_enhancement_source_use')[0]?.values[0]?.[0]).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('trusts only typed generated-origin metadata on next prompt-submit, never raw transport text', async () => {
    const store = await openStore(':memory:');
    try {
      preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-next-submit',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-send-current',
        sendPolicy: 'send_current',
        now: 4000,
      });

      const trusted = resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/phase9',
        bodyId: body.currentBodyId,
        bodyRevision: body.bodyRevision,
        generatedOriginId: 'delivery-next-submit:origin',
        now: 4100,
        maxAgeMs: 1_000,
      });
      expect(trusted).toMatchObject({
        generatedOriginTrusted: true,
        processingPolicy: 'pe_generated_delivery_skip_classification',
        rawTransportIsSemanticAuthority: false,
        lastInjectedPromptIsAuthority: false,
        normalUserPromptFullProcessingPreserved: false,
        reasonCodes: expect.arrayContaining([
          'typed_generated_origin_trusted',
          'classification_skip_scoped_to_delivery_echo',
          'ds_advisory_processing_not_authorized',
          'ordinary_prompt_history_side_effects_disabled',
        ]),
      });

      for (const evidenceKind of [
        'raw_stop_reason_only',
        'last_injected_prompt_only',
        'clipboard_text_only',
        'extension_label_only',
        'old_ds_row',
        'product_feedback',
        'prompt_history',
        'served_variant_row',
        'transcript_corroboration',
        'raw_extension_payload',
        'malformed_generated_origin',
        'unsupported_version',
        'missing_host_capability',
        'missing',
      ] as const) {
        const untrusted = resolvePromptEnhancementPromptSubmitOrigin(store, {
          evidenceKind,
          projectRoot: '/repo/phase9',
          bodyId: body.currentBodyId,
          bodyRevision: body.bodyRevision,
          generatedOriginId: 'delivery-next-submit:origin',
        });
        expect(untrusted).toMatchObject({
          generatedOriginTrusted: false,
          processingPolicy: 'normal_user_prompt_full_processing',
          rawTransportIsSemanticAuthority: false,
          lastInjectedPromptIsAuthority: false,
          normalUserPromptFullProcessingPreserved: true,
        });
      }

      expect(resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/other',
        bodyId: body.currentBodyId,
        bodyRevision: body.bodyRevision,
        generatedOriginId: 'delivery-next-submit:origin',
      }).reasonCodes).toContain('generated_origin_row_missing');
      expect(resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/phase9',
        bodyId: body.currentBodyId,
        bodyRevision: body.bodyRevision,
        generatedOriginId: 'wrong-origin',
      }).reasonCodes).toContain('generated_origin_id_mismatch');
      expect(resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/phase9',
        bodyId: body.currentBodyId,
        bodyRevision: body.bodyRevision,
        generatedOriginId: 'delivery-next-submit:origin',
        now: 6000,
        maxAgeMs: 10,
      }).reasonCodes).toContain('generated_origin_stale');
      expect(resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/phase9',
        bodyId: body.currentBodyId,
        bodyRevision: body.bodyRevision + 1,
        generatedOriginId: 'delivery-next-submit:origin',
      }).reasonCodes).toContain('generated_origin_row_missing');
      expect(resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/phase9',
        bodyId: body.currentBodyId,
        bodyRevision: body.bodyRevision,
        generatedOriginId: 'wrong-origin',
      }).processingPolicy).toBe('normal_user_prompt_full_processing');
    } finally {
      closeStore(store);
    }
  });

  it('captures user-edited generated bodies before delivery without treating edits as ordinary prompt history', async () => {
    const store = await openStore(':memory:');
    try {
      const editedBody = {
        ...body,
        currentBodyId: 'body-phase-9-edited',
        bodyRevision: 4,
        text: `${body.text}\n\nAlso verify retry metrics.`,
        generatedOriginState: 'pe_user_edited_body',
        userDirtyState: 'dirty_user_edited',
      } satisfies PromptEnhancementCurrentBodyV1;

      const result = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-edited-current',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: editedBody,
        actionId: 'action-send-current',
        sendPolicy: 'send_current',
        now: 4500,
      });

      expect(result.stopBridgeDecision).toMatchObject({
        decision: 'block',
        reason: editedBody.text,
        rawReasonIsTextCarrierOnly: true,
      });
      expect(result.generatedOrigin).toMatchObject({
        generatedOriginState: 'pe_user_edited_body',
        bodyId: 'body-phase-9-edited',
        bodyRevision: 4,
      });

      const resolution = resolvePromptEnhancementPromptSubmitOrigin(store, {
        evidenceKind: 'typed_generated_origin',
        projectRoot: '/repo/phase9',
        bodyId: editedBody.currentBodyId,
        bodyRevision: editedBody.bodyRevision,
        generatedOriginId: 'delivery-edited-current:origin',
      });
      expect(resolution).toMatchObject({
        generatedOriginTrusted: true,
        processingPolicy: 'pe_generated_delivery_skip_classification',
        normalUserPromptFullProcessingPreserved: false,
        reasonCodes: expect.arrayContaining([
          'typed_generated_origin_trusted',
          'ordinary_prompt_history_side_effects_disabled',
        ]),
      });
    } finally {
      closeStore(store);
    }
  });

  it('accepts typed extension payload IDs and rejects old DecisionSession payload authority', async () => {
    const store = await openStore(':memory:');
    try {
      const result = preparePromptEnhancementStopBridgeDelivery(store, {
        deliveryAttemptId: 'delivery-extension',
        projectRoot: '/repo/phase9',
        enhancementId: 'enh-phase9',
        currentBody: body,
        actionId: 'action-send-current',
        sendPolicy: 'send_current',
        deliveryChannel: 'extension_bridge',
        extensionPayloadState: 'typed_payload_required',
        hostCapabilityEvidenceRefs: ['host-capability:extension-bridge'],
        additionalDetailsActionId: 'action-additional-details-1',
        sequenceId: 'sequence-summary-1',
        sequenceItemId: 'sequence-item-1',
        now: 5000,
      });
      const payload = createPromptEnhancementExtensionDeliveryPayload(result);

      expect(payload).toMatchObject({
        payloadKind: 'prompt_enhancement_editable_body_delivery',
        bodyId: 'body-phase-9',
        bodyRevision: 3,
        generatedOriginId: 'delivery-extension:origin',
        sourceUseIds: ['delivery-extension:source:1', 'delivery-extension:source:2'],
        originLineage: {
          actionId: 'action-send-current',
          additionalDetailsActionId: 'action-additional-details-1',
          sequenceId: 'sequence-summary-1',
          sequenceItemId: 'sequence-item-1',
          sequenceRuntimeState: 'metadata_only_no_runtime',
        },
        rawTransportIsSemanticAuthority: false,
      });
      expect(store.db.exec(
        'SELECT action_ids_json FROM prompt_enhancement_generated_origin WHERE generated_origin_id = ?',
        ['delivery-extension:origin'],
      )[0]?.values[0]?.[0]).toBe('["action-send-current","action-additional-details-1","sequence-summary-1","sequence-item-1"]');
      expect(validatePromptEnhancementExtensionDeliveryPayload(payload)).toEqual({
        ok: true,
        reasonCodes: ['typed_extension_payload_valid', 'raw_transport_not_authority'],
      });
      expect(validatePromptEnhancementExtensionDeliveryPayload({
        advisory: { id: 'old-ds' },
        selectedPrompt: body.text,
        options: [{ label: 'Enhanced prompt', prompt: body.text }],
      })).toMatchObject({
        ok: false,
        reasonCodes: expect.arrayContaining([
          'legacy_decision_session_payload_rejected',
          'legacy_key:selectedPrompt',
        ]),
      });
      expect(validatePromptEnhancementExtensionDeliveryPayload({
        rawStdout: JSON.stringify({ decision: 'block', reason: body.text }),
        rawStderr: 'stack trace with body text',
        optionLabel: 'Use this prompt',
        clipboardText: body.text,
      })).toMatchObject({
        ok: false,
        reasonCodes: expect.arrayContaining([
          'raw_transport_payload_rejected',
          'raw_key:rawStdout',
          'raw_key:clipboardText',
        ]),
      });
      expect(validatePromptEnhancementExtensionDeliveryPayload({
        schemaVersion: 1,
        payloadKind: 'prompt_enhancement_editable_body_delivery',
        deliveryAttemptId: 'delivery-extension',
        bodyId: 'body-phase-9',
        bodyRevision: 3,
        generatedOriginId: 'delivery-extension:origin',
        sourceUseIds: [],
        originLineage: { actionId: 'action-send-current', sequenceRuntimeState: 'not_sequence' },
        rawTransportIsSemanticAuthority: false,
      })).toMatchObject({
        ok: false,
        reasonCodes: expect.arrayContaining(['typed_extension_payload_invalid']),
      });
      expect(validatePromptEnhancementExtensionDeliveryPayload({
        ...payload,
        originLineage: {
          actionId: '',
          sequenceRuntimeState: 'metadata_only_no_runtime',
        },
      })).toMatchObject({
        ok: false,
        reasonCodes: expect.arrayContaining(['typed_extension_payload_invalid']),
      });
    } finally {
      closeStore(store);
    }
  });

  it('keeps host capability and foreground/direct-insert evidence non-semantic', () => {
    expect(evaluatePromptEnhancementHostCapability('claude_cli_stop_bridge_supported')).toMatchObject({
      deliveryChannel: 'cli_stop_bridge',
      hostCapabilityState: 'stop_bridge_only',
      fallbackRequired: false,
      canUseAsSemanticAuthority: false,
      canClaimUserConsent: false,
      canClaimExecution: false,
      canClaimCompletion: false,
      canClaimSequenceAdvancement: false,
    });
    expect(evaluatePromptEnhancementHostCapability('extension_typed_payload_supported')).toMatchObject({
      deliveryChannel: 'extension_bridge',
      extensionPayloadState: 'typed_payload_required',
      canUseAsSemanticAuthority: false,
    });

    for (const evidenceState of [
      'host_unsupported',
      'host_unknown',
      'direct_insert_failure',
      'foreground_unavailable',
      'stale_capability_data',
      'clipboard_manual_copy_source_precedent_only',
    ] as const) {
      expect(evaluatePromptEnhancementHostCapability(evidenceState)).toMatchObject({
        hostCapabilityState: 'unsupported',
        fallbackRequired: true,
        canUseAsSemanticAuthority: false,
        canClaimUserConsent: false,
        canClaimExecution: false,
        canClaimCompletion: false,
        canClaimSequenceAdvancement: false,
      });
    }

    expect(evaluatePromptEnhancementHostCapability('direct_insert_success_text_only')).toMatchObject({
      fallbackRequired: false,
      canUseAsSemanticAuthority: false,
      canClaimExecution: false,
      reasonCodes: expect.arrayContaining(['insertion_success_not_execution_proof']),
    });
  });

  it('emits sanitized transport diagnostics without raw prompt, source, stdout, stderr, error, or project-root values', () => {
    const diagnostic = createPromptEnhancementTransportDiagnostic({
      diagnosticId: 'diag-transport-1',
      deliveryAttemptId: 'delivery-current',
      bodyId: body.currentBodyId,
      bodyRevision: body.bodyRevision,
      hostCapabilityEvidenceState: 'stale_capability_data',
      fallbackState: 'fallback_without_authority',
      errorKind: 'malformed_ipc',
      rawStdout: JSON.stringify({ decision: 'block', reason: body.text }),
      rawStderr: 'private stack trace',
      rawError: new Error('private path /repo/phase9'),
      projectRoot: '/repo/phase9',
      promptText: body.originalPromptText,
      generatedBodyText: body.text,
      sourceExcerpt: 'private source excerpt',
      customFeedbackText: 'private feedback',
      extensionOutputText: `extension output ${body.text}`,
      prebuildArtifactPath: '/repo/phase9/src/ext-vscode/prebuilds/native.node',
    });

    expect(diagnostic).toMatchObject({
      diagnosticId: 'diag-transport-1',
      deliveryAttemptId: 'delivery-current',
      bodyId: body.currentBodyId,
      bodyRevision: body.bodyRevision,
      hostCapabilityEvidenceState: 'stale_capability_data',
      fallbackState: 'fallback_without_authority',
      errorKind: 'malformed_ipc',
      rawStdoutExcluded: true,
      rawStderrExcluded: true,
      rawErrorExcluded: true,
      projectRootExcluded: true,
      promptTextExcluded: true,
      generatedBodyTextExcluded: true,
      sourceExcerptExcluded: true,
      customFeedbackTextExcluded: true,
      extensionOutputTextExcluded: true,
      prebuildArtifactExcluded: true,
      privateIdsExcluded: true,
      reasonCodes: expect.arrayContaining([
        'transport_diagnostic_sanitized',
        'raw_stdout_excluded',
        'raw_stderr_excluded',
        'raw_error_excluded',
        'project_root_excluded',
        'prompt_text_excluded',
        'generated_body_text_excluded',
        'source_excerpt_excluded',
        'custom_feedback_text_excluded',
        'extension_output_text_excluded',
        'generated_prebuild_artifact_excluded',
      ]),
    });
    expect(JSON.stringify(diagnostic)).not.toContain(body.text);
    expect(JSON.stringify(diagnostic)).not.toContain('/repo/phase9');
    expect(JSON.stringify(diagnostic)).not.toContain('private source excerpt');
  });
});
