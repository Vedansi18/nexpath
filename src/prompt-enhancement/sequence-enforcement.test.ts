import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementSequenceItemValidationGraphV1,
  checkPromptEnhancementSequenceEditV1,
} from './sequence-enforcement.js';
import type { PromptEnhancementSafetySummaryV1 } from './contracts.js';

const SAFETY = {
  sensitiveActionState: 'none_detected',
} as unknown as PromptEnhancementSafetySummaryV1;

const graphFor = (sliceText: string | null, generatedWording: string) =>
  buildPromptEnhancementSequenceItemValidationGraphV1({
    sliceText,
    generatedWording,
    sequenceItemId: 'seq-1:item-2',
    safetyState: SAFETY,
    providerRuntimeState: 'deterministic',
    optionalCallAvailabilityState: 'deterministic_only',
  });

describe('per-item authority — the check that had a label and no location', () => {
  it('passes wording that stays inside the slice\'s authority', () => {
    const graph = graphFor('review the deployment script', 'review the deployment script and report what you find');
    expect(graph.failures).toEqual([]);
    expect(graph.phaseStates[0]?.stage).toBe('sequence');
    expect(graph.phaseStates[0]?.status).not.toBe('invalid_non_sendable');
  });

  it('catches wording that turns a plan into an instruction to act', () => {
    // The single-prompt validator runs on the single-prompt body and never on per-item wording, and
    // every item IS a generated body. Without this the escalation happens and nothing notices.
    const graph = graphFor(
      'review the deployment script',
      'review the deployment script, then deploy it to production and delete the old release',
    );
    expect(graph.failures).toHaveLength(1);
    expect(graph.failures[0]?.failureCode).toBe('sequence_item_wording_exceeds_slice_authority');
    expect(graph.failures[0]?.stage).toBe('sequence');
    expect(graph.failures[0]?.blocking).toBe(true);
    // The failure names the item, not the sequence.
    expect(graph.failures[0]?.affectedBodySpanRefs).toEqual(['seq-1:item-2']);
    // And the phase state reflects it, which is what makes the stored record a graph.
    expect(graph.phaseStates[0]?.status).toBe('invalid_non_sendable');
  });

  it('asks nothing of a kind that carries no slice', () => {
    // Not a pass by default — a confirmation has no authority of its own to exceed, so there is
    // nothing to compare against.
    const graph = graphFor(null, 'Reply YES or NO only, and only if you are clear and sure.');
    expect(graph.failures).toEqual([]);
  });

  it('carries the graph invariants that must not be flipped to make a check fit', () => {
    const graph = graphFor(null, 'anything');
    expect(graph.rawTransportIsValidationProof).toBe(false);
    expect(graph.evaluatesAgentResponseQuality).toBe(false);
    expect(graph.canAutoAdvanceSequencePointer).toBe(false);
    expect(graph.graphOwner).toBe('content_semantics');
  });

  it('holds the summary as a member, which is what the packager reads', () => {
    // The summary is inside the graph. Storing only the summary would leave the packager holding a
    // safety state with no phase states and no failures beside it, and inventing the rest is the
    // fabrication it is forbidden.
    expect(graphFor(null, 'anything').safetyState).toBe(SAFETY);
  });

  it('records only enums, codes and ids — never text', () => {
    // The storage cost was argued on this. A failure that carried the wording would make the stored
    // verdict a new class of data.
    const graph = graphFor('rotate the key', 'rotate the key and redeploy production immediately');
    const serialised = JSON.stringify(graph);
    expect(serialised).not.toContain('rotate the key');
    expect(serialised).not.toContain('redeploy');
  });
});

describe('the edit check — one question, and the narrowness is the rule', () => {
  const FLOOR = 'Tell me the revert path and ask me for go-ahead before you start.';
  const SERVED = `Rotate the Stripe webhook secret.\n\n${FLOOR}`;
  const REF = { start: SERVED.indexOf(FLOOR), end: SERVED.indexOf(FLOOR) + FLOOR.length };

  const check = (
    sentBodyText: string,
    safetyClauseRef: { start: number; end: number } | null = REF,
  ) => checkPromptEnhancementSequenceEditV1({
    servedBodyText: SERVED,
    sentBodyText,
    safetyClauseRef,
    sequenceItemId: 'seq-1:item-2',
  });

  it('leaves an ordinary edit completely alone', () => {
    // Never interfere. An edit that keeps the safeguard returns the same state an unedited body
    // has — a state that moved on any edit would be reporting interference that is not happening.
    const result = check(`Rewrite this how I like it, my own words entirely.\n\n${FLOOR}`);
    expect(result.validityState).toBe('valid_for_current_body_revision');
    expect(result.failures).toEqual([]);
  });

  it('names the removal of a safety clause, and names it specifically', () => {
    // A generic boolean is not enough: a reader has to tell a body-revision change from a safety
    // removal, and one bit cannot say which.
    const result = check('Rotate the Stripe webhook secret, and no go-ahead nonsense.');
    expect(result.validityState).toBe('invalid_due_user_edit_or_safety_removal');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.failureCode).toBe('sequence_item_safety_clause_removed_by_edit');
    expect(result.failures[0]?.stage).toBe('user_edit');
    expect(result.phaseState.stage).toBe('user_edit');
    expect(result.phaseState.status).toBe('invalid_non_sendable');
  });

  it('reads the clause out of the SERVED body, never the sent one', () => {
    // The sent body is what the range would move under. Resolving it there would slide the offsets
    // across every edit made above the floor and report on whatever text landed at them — which is
    // how a check like this comes to guard the wrong sentence without anyone noticing.
    const padded = `A long paragraph the user typed in front of everything else.\n\n${SERVED}`;
    expect(check(padded).validityState).toBe('valid_for_current_body_revision');
  });

  it('says nothing about an item that carried no safety clause', () => {
    // Most items carry none, and for those the question does not arise.
    expect(check('anything at all', null).validityState).toBe('valid_for_current_body_revision');
  });

  it('treats a position that does not fit the served body as no position at all', () => {
    // Fail-closed the other way would block every send on a corrupt row. The row is written under
    // a read invariant that makes this unreachable; if it is reached, the safe reading is that the
    // engine cannot answer, not that the user removed something.
    expect(check(SERVED, { start: 5, end: 9000 }).validityState)
      .toBe('valid_for_current_body_revision');
  });

  it('does not judge the edit itself', () => {
    // Not quality, not completeness, not whether the edit was wise. Widened even slightly, every
    // edit becomes a negotiation with the engine.
    const wordSalad = `asdf ghjk\n\n${FLOOR}`;
    expect(check(wordSalad).validityState).toBe('valid_for_current_body_revision');
    expect(check(wordSalad).failures).toEqual([]);
  });
});
