/**
 * The prompt-enhancement panel's view/command contract — the browser rendering
 * of the CLI popup's locked layout (analysis §7 / cli-submit-popup's target
 * frame). The service worker runs the ENGINE'S OWN popup state machine
 * (`runPromptEnhancementCliSubmitPopupV1`) and bridges it to the panel through
 * these two types:
 *
 *   SW ── PePanelViewV1 ──▶ panel      (one message per render of the loop)
 *   panel ── PePanelCommandV1 ──▶ SW   (one short-lived message per user action)
 *
 * The view is a WHITELISTED projection of the engine's render model — never the
 * full prepare result (ids, session internals, and validation graphs stay in
 * the SW). The command set mirrors `PromptEnhancementCliPopupCommandV1` minus
 * the feedback pair: the v1 browser surface has no feedback store, so the
 * feedback flow is not rendered (PE-BR-11 — deferred, not dropped).
 *
 * The advisory panel's frozen `ui-contract.ts` is deliberately NOT extended —
 * that file is the UI developer's contract for panel.js; this one is
 * engine-side (decision D-5) and owned with the popup host.
 */

export const PE_PANEL_SCHEMA_VERSION = 1 as const;

/** One directional/adjust control row (Shorter / More thorough / More project-grounded). */
export interface PePanelDirectionalV1 {
  actionType: 'shorter' | 'more_thorough' | 'more_project_grounded';
  label: string;
  /** Engine availability verbatim; the panel disables anything not 'available'. */
  availability: string;
}

export interface PePanelViewV1 {
  schemaVersion: typeof PE_PANEL_SCHEMA_VERSION;
  /** Monotonic render counter within one popup run — commands echo it back. */
  viewSeq: number;
  /** 'Nexpath · Prompt enhancement' (the engine's locked title, passed through). */
  title: string;
  /** 'Use enhanced prompt' — the editor heading above the body. */
  editorHeading: string;
  /** Header strip (collapse absent rows — never manufactured). */
  pinchLabel?: string;
  whyHelp?: string;
  /** The ONE editable enhanced body — current text including prior edits. */
  bodyText: string;
  bodyEditable: boolean;
  /** Additional-details field state (present only when the engine offers the action). */
  hasAdditionalDetails: boolean;
  additionalDetailsText: string;
  directional: readonly PePanelDirectionalV1[];
  /** True on a directional refinement view — renders the Go back row. */
  refinement: boolean;
  /** Public-safe notices (engine copy verbatim; absent = not rendered). */
  publicNotice?: string;
  providerFailureNotice?: string;
  trustCues: readonly string[];
}

export type PePanelCommandV1 =
  | { type: 'use_current'; bodyText: string }
  | { type: 'use_original' }
  | { type: 'apply_details'; bodyText: string; detailsText: string }
  | { type: 'shorter'; bodyText: string }
  | { type: 'more_thorough'; bodyText: string }
  | { type: 'more_project_grounded'; bodyText: string }
  | { type: 'go_back' }
  | { type: 'close' };

/** Panel → host events (same driving pattern as the advisory panel's onEvent). */
export type PePanelEventV1 =
  | { type: 'command'; viewSeq: number; command: PePanelCommandV1 }
  | { type: 'move'; dx: number; dy: number };

export interface PePanelControllerV1 {
  show(view: PePanelViewV1): void;
  /** Disable inputs while a command round-trips (the next show() re-enables). */
  setBusy(busy: boolean): void;
  hide(): void;
  destroy(): void;
  /** True while the panel is visible (drives the content-side keepalive). */
  isOpen(): boolean;
}

const COMMAND_TYPES = new Set([
  'use_current', 'use_original', 'apply_details', 'shorter',
  'more_thorough', 'more_project_grounded', 'go_back', 'close',
]);

export function isPePanelCommandV1(value: unknown): value is PePanelCommandV1 {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['type'] !== 'string' || !COMMAND_TYPES.has(v['type'])) return false;
  if (v['type'] === 'use_original' || v['type'] === 'go_back' || v['type'] === 'close') return true;
  if (typeof v['bodyText'] !== 'string') return false;
  if (v['type'] === 'apply_details') return typeof v['detailsText'] === 'string';
  return true;
}
