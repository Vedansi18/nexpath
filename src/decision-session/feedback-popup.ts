/**
 * The nexpath feedback popup — a short in-terminal survey asking how nexpath
 * is working out, rendered with the same popup pipeline as the advisory.
 *
 * The question and rating labels are shown to the user only; they are never
 * sent to the coding agent, so the option-voice rules that govern advisory
 * option text do not apply here.
 */

import { NEXPATH_HEADER } from './DecisionSession.js';
import {
  renderLoop,
  eventsFromReadline,
  type RenderLoopOptions,
  type SelectableItem,
} from './render-loop.js';

export const FEEDBACK_PINCH_LABEL = 'feedback';
export const FEEDBACK_QUESTION = "How's nexpath working out for you?";

/** Transparency note shown under the question — what a send transmits. */
export const FEEDBACK_NOTE = 'On send: your installation ID and timestamps — no prompt text.';

export interface FeedbackOption {
  /** Selection sentinel returned by the popup. */
  value:  string;
  /** Label shown in the option list. */
  label:  string;
  /** Numeric rating recorded for this option (1 = worst … 4 = best). */
  rating: number;
}

/** Rating scale, top → bottom, as shown in the popup. */
export const FEEDBACK_OPTIONS: readonly FeedbackOption[] = [
  { value: 'feedback-rating-1', label: 'Bad',       rating: 1 },
  { value: 'feedback-rating-2', label: 'Good',      rating: 2 },
  { value: 'feedback-rating-3', label: 'Fine',      rating: 3 },
  { value: 'feedback-rating-4', label: 'Excellent', rating: 4 },
];

const RATING_BY_VALUE: Record<string, number> =
  Object.fromEntries(FEEDBACK_OPTIONS.map((o) => [o.value, o.rating]));

export type FeedbackResult =
  | { outcome: 'selected';  rating: number }
  | { outcome: 'dismissed' };

/** Build the pure popup layout for the given terminal dimensions. */
export function buildFeedbackRenderOptions(rows: number, cols: number): RenderLoopOptions {
  return {
    pageHeader: NEXPATH_HEADER,
    pinchLabel: FEEDBACK_PINCH_LABEL,
    // Note sits under the pinch label, above the question; the trailing newline
    // leaves a blank line between the note and the question.
    subtitle:   `${FEEDBACK_NOTE}\n`,
    question:   FEEDBACK_QUESTION,
    options:    FEEDBACK_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    rows,
    cols,
  };
}

/** Renders the layout and resolves with the picked item, or null on dismiss. */
export type FeedbackRenderFn = (layout: RenderLoopOptions) => Promise<SelectableItem | null>;

export interface RunFeedbackPopupOptions {
  render?: FeedbackRenderFn;
  rows?:   number;
  cols?:   number;
}

/**
 * Show the feedback popup and map the picked item to a rating. Returns a
 * dismissed result when the user cancels or picks an unrecognised item.
 */
export async function runFeedbackPopup(opts: RunFeedbackPopupOptions = {}): Promise<FeedbackResult> {
  const render = opts.render ?? defaultFeedbackRender;
  const rows   = opts.rows ?? process.stdout.rows ?? 24;
  const cols   = opts.cols ?? process.stdout.columns ?? 80;

  const picked = await render(buildFeedbackRenderOptions(rows, cols));
  if (!picked) return { outcome: 'dismissed' };

  const rating = RATING_BY_VALUE[picked.value];
  return rating !== undefined ? { outcome: 'selected', rating } : { outcome: 'dismissed' };
}

/** Default renderer — drives renderLoop over the process stdin/stdout TTY. */
const defaultFeedbackRender: FeedbackRenderFn = async (layout) => {
  const input = process.stdin;
  const wasRaw = input.isRaw ?? false;
  if (input.isTTY) {
    input.setRawMode(true);
    input.resume();
  }
  const { events, cancel } = eventsFromReadline(input);
  try {
    return await renderLoop({ layout, keyEvents: events, out: process.stdout });
  } finally {
    cancel();
    if (input.isTTY) input.setRawMode(wasRaw);
  }
};
