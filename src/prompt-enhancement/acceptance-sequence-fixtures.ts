import { promptEnhancementAcceptanceFixtureV1 } from './acceptance-fixture-shape.js';
import type { PromptEnhancementAcceptanceFixtureV1 } from './acceptance-matrix.js';

/**
 * The multi-prompt sequence's acceptance cases, placed into the families that already exist.
 *
 * ⛔ NO TENTH FAMILY. The family enum is a shared contract literal and the packet validator checks
 * membership against it — a sequence case is genuinely a composer, store, routing or delivery case
 * about a sequence, and inventing a family to hold them would widen a literal that is not ours.
 *
 * ⚠️ EVERY ONE IS SHAPE-DEFINED, NOT RUN. `actualResult` and `hardFailResult` are
 * `not_run_shape_only` throughout, the packet's own status stays
 * `matrix_defined_waiting_for_execution`, and `readinessClaimAllowed` is a literal `false`. "All the
 * sequence fixtures are placed" is not a statement about whether anything works, and the structure
 * is built so it cannot be read as one.
 *
 * ⛔ AND NOT ONE ASSERTS A NUMBER. A fixture claiming a duration or a size is unshippable until an
 * oracle sign-off exists that does not exist yet, so the measurable properties here are stated as
 * completeness and presence rather than as thresholds.
 *
 * A note on where they can run. Roughly a third of these need a live continuation Stop or the
 * popup surface — the delivery-host four, the interface three, and the store-lock one — and that
 * half of the runtime is not built here. Writing them is this side's work; running those is not,
 * and a written fixture is not a passed one.
 */
export function buildPromptEnhancementSequenceAcceptanceFixturesV1(): readonly PromptEnhancementAcceptanceFixtureV1[] {
  return [
    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-provider-failure-no-generated-content',
      family: 'cost_fallback',
      inputPrompt: 'Plan a multi-prompt sequence while the provider is unavailable or the key is missing.',
      expectedFamily: 'cost_fallback',
      expectedIntent: 'sequence_provider_failure',
      expectedCapability: 'public_safe_error_no_generated_content',
      mandatorySlotsOrSafeguards: [
        'public_safe_error_popup',
        'no_generated_sequence_content',
        // A call that could not be made is a fault the waiting user is told about. It is NOT the
        // repair path — that exists for a reply which arrived and did not hold up.
        'not_the_validation_retry_path',
        'single_prompt_path_untouched',
      ],
      sourceReasonMetadata: ['no_key', 'provider_error', 'timeout'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'public_safe_reason_code_only',
        'no_sequence_offered',
        'no_partial_item_wording_rendered',
      ],
      hardFailFocus: [
        'generated_content_after_provider_failure',
        'provider_failure_routed_into_repair_loop',
        'raw_provider_error_surfaced_to_user',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-custom-interruption-same-item-returns',
      family: 'store_memory',
      inputPrompt: 'Choose to do something else first while a sequence item is offered.',
      expectedFamily: 'store_memory',
      expectedIntent: 'custom_interruption_pointer_holds',
      expectedCapability: 'item_returns_after_interruption',
      mandatorySlotsOrSafeguards: [
        'pointer_does_not_advance',
        'same_item_offered_again',
        'interruption_is_neither_cancel_nor_completion',
      ],
      sourceReasonMetadata: ['currentItemIndex', 'sequenceItemId', 'sequence_status'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'same_sequence_item_offered_at_the_next_decision_point',
        'sequence_remains_active',
      ],
      hardFailFocus: [
        'pointer_advanced_on_interruption',
        'interruption_treated_as_cancel',
        'interruption_treated_as_item_completion',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-cancel-mid-sequence-scoped',
      family: 'ui_contract',
      inputPrompt: 'Cancel the remaining sequence while a continuation item is offered.',
      expectedFamily: 'ui_contract',
      expectedIntent: 'cancel_remaining_sequence',
      expectedCapability: 'terminal_cancelled_scoped_to_this_sequence',
      expectedPopupState: 'blocked_no_send',
      mandatorySlotsOrSafeguards: [
        'terminal_cancelled_outcome',
        // Scoped to THIS sequence. A cancel is one row's status and never a project-wide clear:
        // taking every declined-offer record in the project with it is a data-loss path, not a
        // tidier implementation of the same intention.
        'suppression_scoped_to_this_sequence_only',
        'no_global_disable',
        'no_other_project_row_touched',
      ],
      sourceReasonMetadata: ['sequenceId', 'sequence_status', 'blocked_no_send'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'sequence_ends_cancelled',
        'no_further_item_offered_for_this_sequence',
        'unrelated_sequence_records_unchanged',
      ],
      hardFailFocus: [
        'cancel_disables_sequences_globally',
        'cancel_deletes_other_project_rows',
        'cancelled_sequence_resumes',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-single-item-no-continuation',
      family: 'routing',
      inputPrompt: 'Fix the failing login test.',
      expectedFamily: 'routing',
      expectedIntent: 'single_intent_no_sequence',
      expectedCapability: 'no_sequence_outcome',
      expectedPopupState: 'popup',
      mandatorySlotsOrSafeguards: [
        // A one-item sequence is not a shorter sequence, it is the ordinary single prompt. Emitting
        // one puts a continuation surface in front of work that never needed continuing.
        'outcome_is_no_sequence',
        'not_a_one_item_sequence',
        'ordinary_single_prompt_path',
      ],
      sourceReasonMetadata: ['item_count', 'no_sequence_single_prompt'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_sequence_row_created',
        'single_prompt_popup_shown',
      ],
      hardFailFocus: [
        'one_item_sequence_offered',
        'continuation_surface_for_single_intent',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-max-item-count-complete-batch',
      family: 'routing',
      inputPrompt: 'A request carrying the largest number of distinct pieces of work a sequence may hold.',
      expectedFamily: 'routing',
      expectedIntent: 'maximum_sequence_size',
      expectedCapability: 'complete_batch_at_the_cap',
      mandatorySlotsOrSafeguards: [
        'item_count_at_the_locked_maximum',
        'maximum_minus_one_when_a_closing_recap_is_present',
        // The batch that writes the largest sequence is the largest thing this feature produces.
        // A reply that ran out of room is a BROKEN sequence, not a shorter one: an item whose
        // wording was cut mid-sentence satisfies every stored invariant while being unusable.
        'batch_output_complete_not_truncated',
        'truncated_batch_is_invalid_not_degraded',
      ],
      sourceReasonMetadata: ['item_count', 'wrap_up_presence', 'batch_output_cap'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'every_planned_item_has_wording',
        'no_item_wording_ends_mid_output',
      ],
      hardFailFocus: [
        'sequence_silently_shortened_to_fit',
        'truncated_batch_accepted_as_degraded',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-stale-and-duplicate-continuation-event',
      family: 'delivery_host',
      inputPrompt: 'A continuation event arrives stale, and then the same one arrives twice.',
      expectedFamily: 'delivery_host',
      expectedIntent: 'stale_and_duplicate_continuation',
      expectedCapability: 'stale_refused_duplicate_harmless',
      expectedPopupState: 'no_popup',
      mandatorySlotsOrSafeguards: [
        'stale_event_produces_no_popup',
        // The packager does not deduplicate, and does not need to: re-reading frozen text produces
        // the same result, so a replayed event serves the same body. What must not repeat is the
        // ACTION, and the action identity is what refuses it.
        'duplicate_event_re_serves_the_same_body',
        'replayed_action_refused_by_action_identity',
      ],
      sourceReasonMetadata: ['stateFreshness', 'bodyRevision', 'lastActionId'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'stale_event_reason_code_no_popup',
        'duplicate_event_yields_byte_identical_body',
        'second_action_on_the_same_body_refused',
      ],
      hardFailFocus: [
        'stale_event_opens_a_popup',
        'duplicate_event_advances_the_pointer',
        'replayed_action_applied_twice',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-confirmation-carries-no-original-text',
      family: 'composer',
      inputPrompt: 'A sequence whose confirmation items sit beside task items carrying verbatim slices.',
      expectedFamily: 'composer',
      expectedIntent: 'confirmation_carries_no_original',
      expectedCapability: 'confirmation_written_in_its_own_words',
      mandatorySlotsOrSafeguards: [
        'confirmation_slice_reference_is_absent',
        // Strictly none — and not only its own, which it does not have. Any task's slice appearing
        // inside a confirmation is the failure.
        'no_task_slice_reproduced_inside_a_confirmation',
        'task_items_still_carry_their_slice_verbatim',
      ],
      sourceReasonMetadata: ['originalSliceRef', 'itemKind'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'confirmation_body_contains_no_span_of_the_original_request',
        'task_body_contains_its_own_span_unchanged',
      ],
      hardFailFocus: [
        'confirmation_quotes_the_user',
        'confirmation_paraphrases_a_slice_as_its_question',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-same-item-returns-identical',
      family: 'store_memory',
      inputPrompt: 'An offered sequence item is deferred and later offered again.',
      expectedFamily: 'store_memory',
      expectedIntent: 'item_wording_is_frozen',
      expectedCapability: 'byte_identical_on_every_re_offer',
      mandatorySlotsOrSafeguards: [
        // Deliberately NOT the same fixture as the one testing that the item returns. That one asks
        // whether the pointer held; this one asks whether the text did. An implementation can pass
        // the first while recomposing on every read, and the user would watch the prompt change
        // under them with nothing reporting it.
        'byte_identical_wording_on_re_offer',
        'no_recomposition_on_read',
        'wording_immutable_once_written',
      ],
      sourceReasonMetadata: ['generatedWording', 'bodyRevision'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'second_reading_returns_the_same_characters',
        'no_provider_call_on_re_offer',
      ],
      hardFailFocus: [
        'item_regenerated_on_re_offer',
        'wording_rewritten_after_activation',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-binary-confirmation-token-set',
      family: 'composer',
      inputPrompt: 'A sequence emitting each of the confirmation kinds.',
      expectedFamily: 'composer',
      expectedIntent: 'format_follows_item_kind',
      expectedCapability: 'exact_token_set_per_kind',
      mandatorySlotsOrSafeguards: [
        'token_set_is_a_total_function_of_the_item_kind',
        'no_two_formats_in_one_item',
        // The demand is a clause in the QUESTION and never a fact about the reply — agent replies
        // are not read. It exists so the USER can find the answer at a glance, which is also why
        // implementing it as parser-friendliness would be the wrong thing passing the check.
        'the_question_demands_the_answer_stand_alone_on_its_line',
      ],
      sourceReasonMetadata: ['itemKind', 'format_token_set'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'confirmation_carries_only_its_kind_token_set',
        'confirmation_states_the_answer_alone_demand',
      ],
      hardFailFocus: [
        'format_chosen_freely_by_the_composer',
        'two_token_sets_in_one_confirmation',
        'reply_parser_reintroduced',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-no-confirmation-when-not-complex',
      family: 'composer',
      inputPrompt: 'A sequence of routine, self-contained pieces of work.',
      expectedFamily: 'composer',
      expectedIntent: 'confirmations_follow_complexity',
      expectedCapability: 'no_confirmation_for_routine_work',
      mandatorySlotsOrSafeguards: [
        'a_not_complex_item_is_followed_by_no_confirmation',
        'confirmation_count_follows_the_per_item_verdict_only',
      ],
      sourceReasonMetadata: ['complexity', 'itemKind'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_confirmation_item_follows_a_routine_task',
      ],
      hardFailFocus: [
        'confirmation_emitted_for_routine_work',
        'confirmation_emitted_to_fill_a_pattern',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-confirmation-three-mandatory-parts',
      family: 'composer',
      inputPrompt: 'A sequence emitting several confirmations of different kinds.',
      expectedFamily: 'composer',
      expectedIntent: 'confirmation_completeness',
      expectedCapability: 'all_three_mandatory_parts_present',
      mandatorySlotsOrSafeguards: [
        'format_constraint_present',
        'certainty_bar_present',
        // Without it the agent answers from its own previous turn: it reports what it already said
        // instead of going and checking, and a confirmation answered that way confirms nothing.
        'ground_level_anti_assumption_instruction_present',
        'a_confirmation_missing_one_does_not_ship',
      ],
      sourceReasonMetadata: ['itemKind', 'confirmation_parts'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'every_emitted_confirmation_carries_all_three_parts',
      ],
      hardFailFocus: [
        'confirmation_without_the_ground_level_clause',
        'confirmation_without_a_certainty_bar',
        'parts_merged_into_one_weakened_sentence',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-every-confirmation-covers-both-classes',
      family: 'composer',
      inputPrompt: 'A sequence emitting confirmations at every level at which one is emitted at all.',
      expectedFamily: 'composer',
      expectedIntent: 'both_classes_always',
      expectedCapability: 'no_class_selection',
      mandatorySlotsOrSafeguards: [
        // EVERY confirmation, not only the ones on the most demanding items. The two classes fail
        // independently: depth alone passes thorough work built against a shape that does not
        // match reality, and grounding alone passes work genuinely checked and then half-built.
        'every_confirmation_covers_depth_and_grounding',
        'no_selection_between_the_two_classes',
        // The case a narrower wording misses: a double or cross emitted on its own, below the level
        // that also earns a binary, is still every-confirmation.
        'includes_a_confirmation_emitted_below_the_highest_level',
      ],
      sourceReasonMetadata: ['itemKind', 'complexity'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_emitted_confirmation_covers_only_one_class',
      ],
      hardFailFocus: [
        'single_class_confirmation_below_the_highest_level',
        'class_selected_per_item',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-readiness-ask-never-emitted',
      family: 'composer',
      inputPrompt: 'Work whose natural confirmation would be to ask whether it is safe to proceed.',
      expectedFamily: 'composer',
      expectedIntent: 'readiness_ask_refused',
      expectedCapability: 'ground_level_question_or_nothing',
      mandatorySlotsOrSafeguards: [
        // A readiness ask invites a weighing of consequences, appetite for risk and timing, none of
        // which are facts anyone can read. Its answer cannot be wrong, and an answer that cannot be
        // wrong is not a confirmation.
        'no_readiness_or_scheduling_question_emitted',
        'question_asks_something_that_could_be_found_false_by_reading_the_system',
        'nothing_is_emitted_when_it_cannot_be_re_expressed',
      ],
      sourceReasonMetadata: ['itemKind', 'complexityReason'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_emitted_confirmation_asks_whether_something_is_ready',
      ],
      hardFailFocus: [
        'readiness_ask_emitted',
        'scheduling_question_emitted',
        'unanswerable_question_emitted_to_fill_a_slot',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-no-risk-no-confirmation',
      family: 'safety_privacy',
      inputPrompt: 'A sequence of small, plainly reversible changes with nothing sensitive in them.',
      expectedFamily: 'safety_privacy',
      expectedIntent: 'no_risk_no_safeguard',
      expectedCapability: 'silence_where_nothing_is_at_stake',
      mandatorySlotsOrSafeguards: [
        'no_recorded_risk_and_no_floor_yields_no_confirmation',
        // Most work is trivially reversible — add a button, fix spacing, write a test — and none of
        // the safety machinery fires on it. A safeguard on work that needs none teaches the user to
        // dismiss safeguards.
        'no_confirmation_floor_embedded',
      ],
      sourceReasonMetadata: ['actionRiskKinds', 'requiresConfirmationFloor'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_confirmation_item_emitted',
        'no_go_ahead_sentence_in_any_body',
      ],
      hardFailFocus: [
        'safeguard_emitted_for_risk_free_work',
        'floor_embedded_without_a_recorded_reason',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-confirmation-volume-uncorrelated',
      family: 'composer',
      inputPrompt: 'A long routine request, and a short one that touches the core — run as a pair.',
      expectedFamily: 'composer',
      expectedIntent: 'confirmation_volume_independent_of_size',
      expectedCapability: 'volume_follows_the_per_item_verdict_only',
      mandatorySlotsOrSafeguards: [
        'long_routine_request_yields_no_confirmation',
        'short_core_touching_request_yields_several',
        // ANY correlation is the defect, not merely a systematic one. A correlation that is real but
        // irregular passes the weaker reading and fails the rule — and a per-item cap was already
        // refused once as the same correlation in a weaker form.
        'any_correlation_between_request_size_and_confirmation_volume_is_the_defect',
        'the_only_input_is_the_per_item_complexity_verdict',
      ],
      sourceReasonMetadata: ['complexity', 'confirmation_count'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'confirmation_volume_moves_with_the_verdict_and_not_with_size',
      ],
      hardFailFocus: [
        'confirmation_count_derived_from_item_count',
        'confirmation_count_derived_from_request_length',
        'confirmation_count_derived_from_section_count',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-persist-before-block-and-exit',
      family: 'delivery_host',
      inputPrompt: 'A sequence item is delivered by blocking, and the process then exits.',
      expectedFamily: 'delivery_host',
      expectedIntent: 'persist_before_block_emission',
      expectedCapability: 'no_state_lost_at_the_exit',
      mandatorySlotsOrSafeguards: [
        // Anything the next decision point needs is on disk BEFORE the block is emitted and before
        // the process is told to leave. Written after, it is written by something that may not be
        // there — and the sequence comes back missing the step that was just taken.
        'state_persisted_before_block_emission',
        'state_persisted_before_forced_exit',
        'no_fire_and_forget_write_on_the_exit_path',
      ],
      sourceReasonMetadata: ['sequence_status', 'currentItemIndex'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'state_readable_after_the_exit_reflects_the_decision_just_made',
      ],
      hardFailFocus: [
        'write_issued_after_block_emission',
        'write_not_awaited_before_exit',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-store-lock-not-held-across-wait',
      family: 'store_memory',
      inputPrompt: 'A sequence popup is left open for a long time while another session writes.',
      expectedFamily: 'store_memory',
      expectedIntent: 'lock_released_across_the_user_wait',
      expectedCapability: 'reload_before_write',
      mandatorySlotsOrSafeguards: [
        'lock_not_held_while_the_user_is_deciding',
        // Re-acquiring is not enough on its own: writing what was read before the wait silently
        // reverts whatever another session did during it. That is a data-loss path, not a
        // concurrency inconvenience.
        're_acquire_reloads_before_writing',
        // And the third half, which is a requirement to build NOTHING: a click on a popup whose
        // sequence died while the user was away is a no-op with no explanation. The silence is the
        // specified behaviour.
        'no_stale_popup_recovery_interface_is_added',
      ],
      sourceReasonMetadata: ['sequenceId', 'sequence_status', 'updated_at'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'concurrent_write_survives_the_long_popup',
        'action_on_a_dead_sequence_does_nothing_and_says_nothing',
      ],
      hardFailFocus: [
        'lock_held_across_a_user_wait',
        'write_without_reload_after_re_acquire',
        'stale_popup_explained_to_the_user',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-no-popup-no-sequence-row',
      family: 'source',
      inputPrompt: 'A request that does not earn an enhancement popup at all.',
      expectedFamily: 'source',
      expectedIntent: 'no_popup_no_sequence',
      expectedCapability: 'sequence_requires_the_locked_source_condition',
      expectedPopupState: 'no_popup',
      mandatorySlotsOrSafeguards: [
        // ⛔ The oracle asserts the LOCKED predicate — at least one absence-signal-based section —
        // and NOT the condition the current code happens to test. A fixture written from the code's
        // own condition asserts that the code does what the code does, passes forever, and proves
        // nothing. The two concepts co-occurred in every sampled case, which is exactly why only a
        // fixture written against the lock can tell them apart.
        'at_least_one_absence_signal_based_section_required',
        'not_written_against_the_implementation_condition',
        'no_popup_means_no_sequence_row',
      ],
      sourceReasonMetadata: ['section_source_kind', 'absence_signal'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_sequence_row_exists_when_no_popup_was_shown',
      ],
      hardFailFocus: [
        'sequence_row_written_without_a_popup',
        'oracle_restated_from_the_implementation_condition',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-continuation-body-is-sequence-owned',
      family: 'generated_origin',
      inputPrompt: 'A continuation item body is delivered and then reaches prompt submission.',
      expectedFamily: 'generated_origin',
      expectedIntent: 'continuation_body_origin',
      expectedCapability: 'sequence_owned_body_does_not_re_enter_planning',
      generatedOriginState: ['sequence_handoff_owned_body'],
      mandatorySlotsOrSafeguards: [
        'continuation_body_marked_sequence_owned',
        // Marked as the user's own words, a continuation re-enters the planner and plans a sequence
        // out of Nexpath's own writing — a loop whose every iteration looks like a legitimate
        // multi-intent request.
        'sequence_owned_body_does_not_re_enter_the_planner',
        'origin_marking_present_on_every_continuation_body',
      ],
      sourceReasonMetadata: ['sentPromptOrigin', 'generatedOriginState', 'nexpathGeneratedPromptRef'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'continuation_body_reports_sequence_owned_origin',
        'no_second_sequence_planned_from_a_continuation_body',
      ],
      hardFailFocus: [
        'continuation_body_marked_user_authored',
        'sequence_planned_from_generated_text',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-item-must-stand-alone',
      family: 'routing',
      inputPrompt: 'A request whose pieces only make sense together, not one at a time.',
      expectedFamily: 'routing',
      expectedIntent: 'standalone_acceptance_condition',
      expectedCapability: 'no_sequence_when_an_item_cannot_stand_alone',
      expectedPopupState: 'no_popup',
      mandatorySlotsOrSafeguards: [
        // A per-item acceptance condition, not a preference. An item that only makes sense because
        // a later one is coming is a fragment, and a fragment sent on its own is a prompt the agent
        // will answer wrongly with no way to know it.
        'every_item_is_answerable_on_its_own',
        'an_item_that_depends_on_a_later_one_blocks_the_offer',
        'sequence_is_not_offered_rather_than_offered_smaller',
      ],
      sourceReasonMetadata: ['dependencyOrder', 'decompositionGroupId'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_sequence_offered_for_a_non_separable_request',
      ],
      hardFailFocus: [
        'fragment_emitted_as_a_standalone_item',
        'sequence_offered_by_dropping_the_dependent_item',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-config-gate-off-is-silent',
      family: 'routing',
      inputPrompt: 'A multi-intent request while the sequence setting is off, project-scoped, or invalid.',
      expectedFamily: 'routing',
      expectedIntent: 'sequence_disabled',
      expectedCapability: 'no_planning_and_no_explanation',
      expectedPopupState: 'no_popup',
      mandatorySlotsOrSafeguards: [
        'planning_does_not_run_when_the_setting_is_off',
        'project_scope_beats_global_and_global_beats_the_default',
        'an_invalid_value_resolves_to_off_rather_than_to_the_default',
        // ⛔ And the second half, which is the one an implementer will get wrong: OFF IS SILENT. The
        // instinct is to explain the silence, and the presentation contract forbids the setting's
        // name appearing in a rendered model at all. No popup, no "sequences are disabled" line,
        // no key, no value.
        'nothing_rendered_names_the_setting',
        'no_explanation_of_the_silence_is_shown',
      ],
      sourceReasonMetadata: ['sequence_enabled', 'validated_effective_config_state', 'source_scope'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_sequence_offered',
        'rendered_model_contains_no_configuration_key',
      ],
      hardFailFocus: [
        'setting_name_rendered_to_the_user',
        'disabled_state_explained_in_the_interface',
        'invalid_value_treated_as_the_default',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-handoff-validity-cross-project',
      family: 'delivery_host',
      inputPrompt: 'A continuation handoff arrives invalid, and then one arrives from another project.',
      expectedFamily: 'delivery_host',
      expectedIntent: 'handoff_validity_and_project_scope',
      expectedCapability: 'invalid_or_foreign_handoff_starts_nothing',
      expectedPopupState: 'no_popup',
      mandatorySlotsOrSafeguards: [
        'invalid_handoff_yields_no_sequence',
        // A handoff belonging to another project must never start or continue a sequence here. The
        // two projects are different work, and the scope check is the only thing that knows it.
        'foreign_project_handoff_yields_no_sequence',
        'handoff_re_validated_at_intake_not_trusted_from_the_producer',
      ],
      sourceReasonMetadata: ['requestId', 'projectScope', 'handoffKind'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'scope_mismatch_reason_code_and_no_popup',
        'tampered_handoff_reason_code_and_no_popup',
      ],
      hardFailFocus: [
        'sequence_started_from_another_project_handoff',
        'handoff_accepted_without_re_validation',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-no-auto-start',
      family: 'ui_contract',
      inputPrompt: 'A sequence is offered and then left alone: no send, no answer, no interaction.',
      expectedFamily: 'ui_contract',
      expectedIntent: 'explicit_send_is_the_only_activation',
      expectedCapability: 'nothing_activates_by_itself',
      mandatorySlotsOrSafeguards: [
        // Nothing activates a sequence except an explicit send. Not the popup opening, not a
        // timeout, not a render, not an advance call. The offer surface OFFERS.
        'popup_opening_does_not_activate',
        'timeout_does_not_activate',
        'render_does_not_activate',
        'advance_request_does_not_activate',
      ],
      sourceReasonMetadata: ['sequence_status', 'offer_disposition'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'no_sequence_becomes_active_without_an_explicit_send',
      ],
      hardFailFocus: [
        'sequence_activated_on_render',
        'sequence_activated_on_timeout',
        'sequence_activated_by_an_advance_call',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-use-original-does-not-activate',
      family: 'ui_contract',
      inputPrompt: 'A sequence is offered and the user chooses to send their own text instead.',
      expectedFamily: 'ui_contract',
      expectedIntent: 'use_original_is_not_activation',
      expectedCapability: 'own_text_leaves_no_sequence_behind',
      mandatorySlotsOrSafeguards: [
        // Distinct from the no-auto-start case, and deliberately kept separate: that one says
        // nothing activates on its own, this one says that this specific deliberate action does not
        // activate either. An implementation can pass the first and fail this.
        'no_sequence_row_created',
        'no_sequence_activated',
        'the_user_text_is_sent_unchanged',
      ],
      sourceReasonMetadata: ['offer_disposition', 'sentPromptOrigin'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'original_text_sent_and_no_sequence_exists_afterwards',
      ],
      hardFailFocus: [
        'sequence_activated_by_choosing_the_original',
        'sequence_row_written_for_a_declined_offer',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-stop-is-not-completion-proof',
      family: 'delivery_host',
      inputPrompt: 'A turn ends while the work of the current sequence item is plainly unfinished.',
      expectedFamily: 'delivery_host',
      expectedIntent: 'turn_end_is_a_decision_point_only',
      expectedCapability: 'no_completion_inferred_from_timing',
      mandatorySlotsOrSafeguards: [
        // A turn ending is when the user CAN be asked something. It is never evidence that the work
        // finished, and nothing in the system could supply that evidence — so the pointer moves on
        // the user's decision and on nothing else.
        'turn_end_is_a_decision_opportunity_not_completion_evidence',
        'pointer_does_not_advance_on_timing',
        'no_response_quality_is_evaluated',
      ],
      sourceReasonMetadata: ['stopEventState', 'currentItemIndex'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'sequence_pointer_unchanged_by_the_turn_ending_alone',
      ],
      hardFailFocus: [
        'turn_end_treated_as_item_completion',
        'pointer_advanced_without_a_user_decision',
        'agent_reply_read_to_decide_completion',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-privacy-telemetry-negative',
      family: 'safety_privacy',
      inputPrompt: 'A full sequence runs from offer to completion with telemetry enabled.',
      expectedFamily: 'safety_privacy',
      expectedIntent: 'sequence_persistence_and_telemetry_boundary',
      expectedCapability: 'ids_counts_status_only',
      privacyExpectation: [
        'ids_counts_status_only',
        'raw_prompt_body_source_feedback_excluded',
        'sequence_item_wording_excluded_from_telemetry',
      ],
      mandatorySlotsOrSafeguards: [
        // Written as a NEGATIVE test on purpose: the claim is about what must be absent, and a
        // positive test that the right fields are present passes just as well while a raw body sits
        // beside them.
        'no_raw_request_text_emitted',
        'no_generated_item_wording_emitted',
        'no_source_excerpt_emitted',
        'no_feedback_text_emitted',
        'no_agent_reply_persisted_or_emitted',
      ],
      sourceReasonMetadata: ['sequenceId', 'item_count', 'sequence_status'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'emitted_records_carry_identifiers_counts_and_status_and_nothing_else',
      ],
      hardFailFocus: [
        'raw_body_in_telemetry',
        'item_wording_in_telemetry',
        'agent_reply_persisted',
      ],
    }),

    promptEnhancementAcceptanceFixtureV1({
      fixtureId: 'acceptance-sequence-old-decision-session-not-authority',
      family: 'store_memory',
      inputPrompt: 'An older decision-session record is present, replayed, and skipped, around a sequence.',
      expectedFamily: 'store_memory',
      expectedIntent: 'legacy_session_is_not_sequence_authority',
      expectedCapability: 'sequence_state_has_one_source',
      mandatorySlotsOrSafeguards: [
        // A legacy record is precedent, never authority. Allowed to decide anything here, the
        // sequence would take instructions from a system that knows nothing about it.
        'legacy_session_row_is_not_authority_for_a_sequence',
        'a_replayed_legacy_session_does_not_resume_a_sequence',
        'a_skipped_legacy_session_does_not_start_or_alter_one',
      ],
      sourceReasonMetadata: ['sequenceId', 'sequence_status'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation', 'old_decision_session_precedent_only'],
      registryLinkedFixtureIds: [],
      expectedObservableOutcome: [
        'sequence_state_unchanged_by_any_legacy_session_activity',
      ],
      hardFailFocus: [
        'legacy_row_read_as_sequence_authority',
        'sequence_resumed_from_a_replayed_legacy_session',
      ],
    }),
  ];
}
