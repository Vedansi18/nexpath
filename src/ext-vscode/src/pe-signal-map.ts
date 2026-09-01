import type { PeEventType } from './pe-events.js';

/**
 * Content-free feedback-signal kinds this extension can produce for a PE action.
 *
 * These string literals MUST stay in sync with `ACTION_SIGNAL_KINDS` in the CLI's
 * `src/store/feedback-signals.ts`. This package is import-isolated from the main
 * `src`, so the type cannot be shared directly — but the CLI's `record-signal`
 * command validates the kind against that list and rejects anything it does not
 * recognise, so a drift here fails CLOSED (no row written), never a silent bad
 * record.
 */
export type PeActionSignalKind =
  | 'pe_use_current'
  | 'pe_use_original'
  | 'pe_shorter'
  | 'pe_more_thorough'
  | 'pe_more_project_grounded'
  | 'pe_apply_details'
  | 'pe_close';

/**
 * Webview PE event types that correspond to a content-free feedback signal.
 * `edit_body`, `skip_or_reject`, and `explicit_feedback` have no signal kind and
 * map to `null`. (`pe_back` is a declared CLI kind with no webview event yet.)
 */
const EVENT_TO_SIGNAL: Partial<Record<PeEventType, PeActionSignalKind>> = {
  deliver_current_body:          'pe_use_current',
  use_original:                  'pe_use_original',
  request_shorter:               'pe_shorter',
  request_more_thorough:         'pe_more_thorough',
  request_more_project_grounded: 'pe_more_project_grounded',
  submit_additional_details:     'pe_apply_details',
  close_no_send:                 'pe_close',
};

/**
 * Map a webview PE event type to its content-free feedback-signal kind, or
 * `null` when the event type has no corresponding signal.
 */
export function peEventTypeToSignalKind(eventType: PeEventType): PeActionSignalKind | null {
  return EVENT_TO_SIGNAL[eventType] ?? null;
}
