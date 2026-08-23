// ============================================================================
// Typed model for a CLI-parity surface.
// ----------------------------------------------------------------------------
// Sub-phase D3.1. Types only — no DOM, no rendering, no imports. What a surface
// IS, separate from how it is drawn.
//
// WHY TYPED AT ALL, when the content is static (D-5). Because it will not stay
// static. A literal-DOM build would have to be rewritten the day live data
// arrives; a typed model means the fixture is swapped for a producer and nothing
// else moves. The cost now is this file.
//
// The shape follows the CLI's own line grammar rather than any one surface, so
// MPS-1, MPS-2 and PEF (D4) describe themselves with the same vocabulary.
// ============================================================================

/** Which surface a model describes. Drives nothing here; it is for callers. */
export type SurfaceId =
  | 'prompt_enhancement'
  | 'mps_first'
  | 'mps_continuation'
  | 'prompt_enhancement_feedback';

/**
 * The hint lines under an editable field.
 *
 * Order is `always` then `whenFocused`, which is exactly what the CLI emits and
 * why two lists are needed rather than one. The body row shows its hint only
 * while focused; the details row shows "Enter applies these details" at all
 * times and adds the edit-keys line beneath it when focused
 * (`cli-submit-popup.ts:800-818`).
 */
export interface FieldHints {
  /** Shown whether or not the row has focus. */
  always?: readonly string[];
  /** Appended below `always`, only while the row has focus. */
  whenFocused?: readonly string[];
}

/**
 * One row of a surface.
 *
 * Every row is a radio option in the CLI — filled bullet when focused, hollow
 * otherwise — and an editable row additionally renders its field beneath the
 * label. That is the whole distinction, so it is the whole union.
 */
export type SurfaceRow =
  | {
      kind: 'field';
      label: string;
      /** Current text of the field. Static today; a producer fills it later. */
      text: string;
      hints?: FieldHints;
      /** The CLI opens some blocks with a blank line; the model says which. */
      blankBefore?: boolean;
    }
  | {
      kind: 'action';
      label: string;
      blankBefore?: boolean;
    };

/**
 * A whole surface, in the order the CLI renders it: header, pinch label, trust
 * cues, why-help, an optional provider-failure notice, the rows, then the footer.
 *
 * Optional fields are optional in the CLI too — it omits the pinch label when a
 * surface has none, and emits the provider-failure notice only on a real
 * provider failure, never on a no-key or invalid-output run.
 */
export interface SurfaceModel {
  id: SurfaceId;
  /** Header suffix: the frame reads `◆ NEXPATH CLI · <label>`. */
  label: string;
  pinch?: string;
  trustCues?: readonly string[];
  /** Multi-line. Rendered one row per line, as the CLI does. */
  whyHelp?: string;
  /** Present only on a real provider failure. Rendered in the caution tone. */
  providerFailure?: string;
  rows: readonly SurfaceRow[];
  footer: string;
}

/** Which row currently has focus. Not part of the model — it changes, the model does not. */
export interface SurfaceState {
  focusIndex: number;
}
