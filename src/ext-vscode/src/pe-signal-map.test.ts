import { describe, it, expect } from 'vitest';
import { peEventTypeToSignalKind } from './pe-signal-map.js';
import type { PeEventType } from './pe-events.js';

describe('peEventTypeToSignalKind', () => {
  const MAPPED: ReadonlyArray<readonly [PeEventType, string]> = [
    ['deliver_current_body',          'pe_use_current'],
    ['use_original',                  'pe_use_original'],
    ['request_shorter',               'pe_shorter'],
    ['request_more_thorough',         'pe_more_thorough'],
    ['request_more_project_grounded', 'pe_more_project_grounded'],
    ['submit_additional_details',     'pe_apply_details'],
    ['close_no_send',                 'pe_close'],
  ];

  const UNMAPPED: ReadonlyArray<PeEventType> = ['edit_body', 'skip_or_reject', 'explicit_feedback'];

  it.each(MAPPED)('maps %s -> %s', (eventType, kind) => {
    expect(peEventTypeToSignalKind(eventType)).toBe(kind);
  });

  it.each(UNMAPPED)('maps %s -> null (no corresponding signal)', (eventType) => {
    expect(peEventTypeToSignalKind(eventType)).toBeNull();
  });

  it('accounts for every PeEventType (mapped + unmapped = all 10)', () => {
    // If a new PeEventType is added to pe-events.ts, update this list — the count
    // guard then forces a deliberate decision about its signal (or lack of one).
    const all: ReadonlyArray<PeEventType> = [
      'deliver_current_body', 'use_original', 'edit_body', 'skip_or_reject',
      'request_shorter', 'request_more_thorough', 'request_more_project_grounded',
      'submit_additional_details', 'explicit_feedback', 'close_no_send',
    ];
    expect(all.length).toBe(MAPPED.length + UNMAPPED.length);
  });
});
