/**
 * B1 UI Contract — FROZEN.
 *
 * This file defines the boundary between the nexpath core pipeline and the UI layer.
 * UI developers implement against this contract; the pipeline team implements against it.
 * Neither side breaks the other as long as this contract stays stable.
 *
 * DO NOT change these interfaces without a major-version bump or explicit sign-off from both sides.
 */

// ── AdvisoryPayload — what the pipeline sends to the UI ───────────────────────

export interface AdvisoryOption {
  /** Short action label (e.g. "Write the PRD now →"). */
  label:       string;
  /** Full description / why-this-matters text. */
  description: string;
}

/**
 * Complete advisory payload delivered by the pipeline to the UI.
 * All fields are required — the UI must handle every one.
 */
export interface AdvisoryPayload {
  /** Session identifier — opaque string. */
  sessionId:   string;
  /** Current dev stage key (e.g. 'implementation', 'prd'). */
  stage:       string;
  /** Previous stage key — empty string if no transition. */
  prevStage:   string;
  /** FlagType string (e.g. 'stage_transition', 'absence:test_creation'). */
  flagType:    string;
  /** 2-3 word LLM-generated or static pinch label (e.g. 'Hold up.'). */
  pinchLabel:  string;
  /** Prompt count at the time the advisory fired. */
  promptCount: number;
  /** Ordered advisory options (1-3 entries). */
  options:     AdvisoryOption[];
}

// ── PanelEvent — what the UI sends back to the extension background ───────────

export type PanelEventType =
  | 'option_selected'    // user clicked an option
  | 'copy_to_clipboard'  // user chose clipboard-only path
  | 'dismissed';         // user dismissed the panel without selecting

export interface PanelEvent {
  type:           PanelEventType;
  /** Index of the selected option (present only when type === 'option_selected'). */
  optionIndex?:   number;
  /** Full text of the selected option (present only when type === 'option_selected'). */
  selectedText?:  string;
}

// ── Panel lifecycle — what the UI must export ─────────────────────────────────

/**
 * Controller returned by mountNexpathPanel.
 * The extension host uses this to tear down the panel.
 */
export interface PanelController {
  /** Remove the panel from the DOM and clean up all event listeners. */
  unmount(): void;
}

/**
 * Mount the nexpath advisory panel into the given root element.
 *
 * @param root     DOM element to mount into (the extension creates this).
 * @param payload  Advisory data from the pipeline.
 * @param onEvent  Callback the extension calls when the user acts.
 * @returns        Controller — call unmount() when done.
 */
export type MountNexpathPanel = (
  root:    HTMLElement,
  payload: AdvisoryPayload,
  onEvent: (event: PanelEvent) => void,
) => PanelController;
