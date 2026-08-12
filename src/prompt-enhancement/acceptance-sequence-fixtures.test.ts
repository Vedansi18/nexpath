import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementSequenceAcceptanceFixturesV1 } from './acceptance-sequence-fixtures.js';
import {
  PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1,
  buildPromptEnhancementAcceptancePacketV1,
  validatePromptEnhancementAcceptancePacketV1,
} from './acceptance-matrix.js';
import { PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1 } from './sequence-runtime.js';

const sequenceFixtures = buildPromptEnhancementSequenceAcceptanceFixturesV1();

const byId = (id: string) => sequenceFixtures.find((entry) => entry.fixtureId === id);

describe('sequence acceptance register — placement', () => {
  it('places every case into a family that already exists', () => {
    // The family enum is a shared contract literal and the packet validator checks membership. A
    // tenth family invented to hold sequence cases would widen a literal that is not ours, and the
    // validator would refuse the packet rather than the family.
    for (const entry of sequenceFixtures) {
      expect(PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1).toContain(entry.family);
    }
  });

  it('gives every required family a sequence case', () => {
    // Nine families, and the point of the register is that none of them is left describing only
    // single-prompt behaviour.
    const covered = new Set(sequenceFixtures.map((entry) => entry.family));
    for (const family of PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1) {
      expect(covered.has(family)).toBe(true);
    }
  });

  it('carries the whole register, distributed as the plan places it', () => {
    // The count and the per-family split are both stated. Pinned together because either can drift
    // alone: a case dropped during a refactor keeps the total honest-looking if another is added
    // elsewhere, and the split is what says which family lost its coverage.
    expect(sequenceFixtures).toHaveLength(27);
    const counts: Record<string, number> = {};
    for (const entry of sequenceFixtures) counts[entry.family] = (counts[entry.family] ?? 0) + 1;
    expect(counts).toEqual({
      composer: 7,
      routing: 4,
      store_memory: 4,
      delivery_host: 4,
      ui_contract: 3,
      safety_privacy: 2,
      cost_fallback: 1,
      source: 1,
      generated_origin: 1,
    });
  });

  it('carries no duplicate identity, inside itself or against the existing matrix', () => {
    const ids = sequenceFixtures.map((entry) => entry.fixtureId);
    expect(new Set(ids).size).toBe(ids.length);
    // And against the whole packet, because a duplicate id is a packet-level validation failure and
    // the two registers are written in different files.
    const packetIds = buildPromptEnhancementAcceptancePacketV1().fixtures.map((entry) => entry.fixtureId);
    expect(new Set(packetIds).size).toBe(packetIds.length);
  });

  it('leaves the packet valid with the register in it', () => {
    // The register is not a document beside the matrix — it goes through the same validator, so a
    // fixture missing an oracle or a hard-fail focus fails here rather than being noticed later.
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const validation = validatePromptEnhancementAcceptancePacketV1(packet);
    expect(validation.reasonCodes).toEqual([]);
    expect(validation.ok).toBe(true);
  });
});

describe('sequence acceptance register — what it refuses to claim', () => {
  it('is shape-defined throughout, and not one entry is marked as passing', () => {
    // Placement is not execution. A register that marks its own entries as passing is how "the
    // fixtures are written" quietly becomes "the fixtures pass", which is the claim the packet is
    // built to refuse.
    for (const entry of sequenceFixtures) {
      expect(entry.actualResult).toBe('not_run_shape_only');
      expect(entry.hardFailResult).toBe('not_run_shape_only');
    }
  });

  it('keeps the packet unable to state readiness', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.status).toBe('matrix_defined_waiting_for_execution');
    expect(packet.ownerSignoffState).toBe('required_before_readiness_claim');
  });

  it('never states a MEASURED threshold', () => {
    // The prohibition is about measurements: a fixture asserting a duration, a latency or an output
    // size needs an oracle sign-off that does not exist, so it would be unshippable the day it was
    // written. It is NOT about numbers as such — a constant the spec fixed and the validator
    // already enforces is a different thing, and reading the rule the broad way is what left the
    // item-cap oracle telling its reader to go and find the two values it turns on.
    const MEASURED = /\b\d+\s*(ms|s|sec|secs|seconds|minutes?|kb|mb|bytes?|tokens?)\b|\bunder\s+\d|\bwithin\s+\d|\bfaster than\s+\d|\bno more than\s+\d/i;
    for (const entry of sequenceFixtures) {
      const text = [
        ...entry.mandatorySlotsOrSafeguards,
        ...entry.expectedObservableOutcome,
        ...entry.hardFailFocus,
        entry.inputPrompt,
      ].join(' | ');
      expect(text).not.toMatch(MEASURED);
    }
  });

  it('states the item cap from the shipping constant, not from a copy of it', () => {
    // The oracle carries both values — the cap, and the cap minus one when a closing recap is
    // present — because they differ by one and a reader who has to look them up is the reader who
    // writes the fixture against whatever the code says today.
    const entry = byId('acceptance-sequence-max-item-count-complete-batch');
    const cap = PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1;
    expect(entry?.mandatorySlotsOrSafeguards).toEqual(expect.arrayContaining([
      `item_count_is_${cap}_at_the_locked_maximum`,
      `item_count_is_${cap - 1}_when_a_closing_recap_is_present`,
      `batch_output_complete_for_a_${cap}_item_sequence`,
    ]));
    // Interpolated, so moving the cap moves the oracle with it. A literal here would be a second
    // copy of a number the payload validator already enforces.
    expect(entry?.mandatorySlotsOrSafeguards.join(' ')).toContain(String(cap));
  });

  it('does not require the sequence runtime to be declared live', () => {
    // The packet asserts the sequence runtime is metadata-only and the validator hard-fails a
    // packet that says otherwise. A fixture depending on that boundary being false could never run
    // inside this structure.
    const packet = buildPromptEnhancementAcceptancePacketV1();
    expect(packet.futureSequenceRuntimeBoundary.metadataOnlyInV1).toBe(true);
    expect(validatePromptEnhancementAcceptancePacketV1({
      ...packet,
      futureSequenceRuntimeBoundary: { ...packet.futureSequenceRuntimeBoundary, metadataOnlyInV1: false },
    }).reasonCodes).toContain('future_sequence_runtime_enabled_in_phase13');
  });
});

describe('sequence acceptance register — the oracles most likely to be written wrong', () => {
  it('asserts the locked source predicate, not the condition the code happens to test', () => {
    // A fixture written from the implementation's own condition asserts that the code does what the
    // code does. It passes forever and proves nothing — and the two concepts co-occurred in every
    // sampled case, which is exactly why only an oracle written against the lock separates them.
    const entry = byId('acceptance-sequence-no-popup-no-sequence-row');
    expect(entry?.mandatorySlotsOrSafeguards).toContain('at_least_one_absence_signal_based_section_required');
    expect(entry?.mandatorySlotsOrSafeguards).toContain('not_written_against_the_implementation_condition');
    expect(entry?.hardFailFocus).toContain('oracle_restated_from_the_implementation_condition');
  });

  it('asks every confirmation for both classes, including one emitted below the highest level', () => {
    // The narrower wording — a complex item's confirmation covers both — lets a single-class double
    // or cross through when it is emitted on its own, which is a real emission case.
    const entry = byId('acceptance-sequence-every-confirmation-covers-both-classes');
    expect(entry?.mandatorySlotsOrSafeguards).toContain('every_confirmation_covers_depth_and_grounding');
    expect(entry?.mandatorySlotsOrSafeguards).toContain('includes_a_confirmation_emitted_below_the_highest_level');
    expect(entry?.hardFailFocus).toContain('single_class_confirmation_below_the_highest_level');
  });

  it('makes ANY size-to-volume correlation the defect, not merely a systematic one', () => {
    // A correlation that is real but irregular passes the weaker predicate and fails the rule. A
    // per-item cap was already refused once as the same correlation in a weaker form.
    const entry = byId('acceptance-sequence-confirmation-volume-uncorrelated');
    expect(entry?.mandatorySlotsOrSafeguards)
      .toContain('any_correlation_between_request_size_and_confirmation_volume_is_the_defect');
    // All three forbidden inputs, not only the one the fixture exercises.
    expect(entry?.hardFailFocus).toEqual(expect.arrayContaining([
      'confirmation_count_derived_from_item_count',
      'confirmation_count_derived_from_request_length',
      'confirmation_count_derived_from_section_count',
    ]));
  });

  it('keeps "the item returns" and "it returns unchanged" as two separate cases', () => {
    // An implementation that recomposes on every read passes the first and fails the second, and
    // the user would watch the prompt change under them with nothing reporting it.
    const returns = byId('acceptance-sequence-custom-interruption-same-item-returns');
    const identical = byId('acceptance-sequence-same-item-returns-identical');
    expect(returns).toBeDefined();
    expect(identical).toBeDefined();
    expect(returns?.mandatorySlotsOrSafeguards).toContain('pointer_does_not_advance');
    expect(identical?.mandatorySlotsOrSafeguards).toContain('byte_identical_wording_on_re_offer');
    expect(returns?.fixtureId).not.toBe(identical?.fixtureId);
  });

  it('keeps "nothing auto-starts" and "this action does not activate" as two separate cases', () => {
    const auto = byId('acceptance-sequence-no-auto-start');
    const original = byId('acceptance-sequence-use-original-does-not-activate');
    expect(auto?.mandatorySlotsOrSafeguards).toContain('render_does_not_activate');
    expect(original?.mandatorySlotsOrSafeguards).toContain('no_sequence_row_created');
    expect(auto?.fixtureId).not.toBe(original?.fixtureId);
  });

  it('carries all three halves of the store-lock case, including the one that builds nothing', () => {
    // Releasing without reloading silently reverts another session's writes, and a recovery
    // interface for a dead popup is a thing the rule says NOT to build. Two of the three are easy
    // to satisfy while missing the one that matters.
    const entry = byId('acceptance-sequence-store-lock-not-held-across-wait');
    expect(entry?.mandatorySlotsOrSafeguards).toEqual(expect.arrayContaining([
      'lock_not_held_while_the_user_is_deciding',
      're_acquire_reloads_before_writing',
      'no_stale_popup_recovery_interface_is_added',
    ]));
  });

  it('requires the disabled setting to be silent, not explained', () => {
    // The instinct is to tell the user why nothing happened, and the presentation contract forbids
    // the setting's name appearing in a rendered model at all.
    const entry = byId('acceptance-sequence-config-gate-off-is-silent');
    expect(entry?.mandatorySlotsOrSafeguards).toContain('nothing_rendered_names_the_setting');
    expect(entry?.expectedObservableOutcome).toContain('rendered_model_contains_no_configuration_key');
    expect(entry?.hardFailFocus).toContain('disabled_state_explained_in_the_interface');
  });

  it('states the privacy case negatively, which is the only way it can fail', () => {
    // A positive test that the right fields are present passes just as well with a raw body sitting
    // beside them.
    const entry = byId('acceptance-sequence-privacy-telemetry-negative');
    expect(entry?.mandatorySlotsOrSafeguards.every((slot) => slot.startsWith('no_'))).toBe(true);
    expect(entry?.privacyExpectation).toContain('sequence_item_wording_excluded_from_telemetry');
  });

  it('treats a truncated batch as invalid rather than as a shorter sequence', () => {
    const entry = byId('acceptance-sequence-max-item-count-complete-batch');
    expect(entry?.mandatorySlotsOrSafeguards).toContain('truncated_batch_is_invalid_not_degraded');
    expect(entry?.hardFailFocus).toContain('sequence_silently_shortened_to_fit');
  });

  it('routes a provider failure away from the repair path', () => {
    // A call that could not be made is a fault the user is told about; the repair path exists for a
    // reply that arrived and did not hold up. Sending the first down the second spends three more
    // calls on a provider that is not answering.
    const entry = byId('acceptance-sequence-provider-failure-no-generated-content');
    expect(entry?.mandatorySlotsOrSafeguards).toContain('not_the_validation_retry_path');
    expect(entry?.hardFailFocus).toContain('generated_content_after_provider_failure');
  });

  it('does not claim the host-unavailable case, which is another lane', () => {
    // Placing a host completion or commit-proof fixture here would claim coverage this side does
    // not own, and the absence is deliberate rather than an omission.
    const text = JSON.stringify(sequenceFixtures);
    expect(text).not.toContain('host_unavailable');
    expect(text).not.toContain('host_commit_proof');
  });
});
