/**
 * UIPort — abstracts the advisory display surface.
 *
 * CLI implementation: TtyUIAdapter (wraps TtySelectFn + DecisionSession terminal popup).
 * Browser implementation: PanelUIAdapter (wraps mountNexpathPanel Shadow-DOM panel).
 *
 * The payload and event shapes mirror the frozen ui-contract.ts — UIPort is the
 * runtime bridge between the engine and whatever surface renders the panel.
 */

export interface AdvisoryOption {
  id: string;
  title: string;
  body: string;
  level: 'L1' | 'L2' | 'L3';
}

/** Per-level option lists — CLI parity (the CLI shows a LIST at each level). */
export interface AdvisoryLevels {
  L1: AdvisoryOption[];
  L2: AdvisoryOption[];
  L3: AdvisoryOption[];
}

export interface AdvisoryPayload {
  schemaVersion: 1;
  advisoryId: string;
  pinchLabel: string;
  stage: string;

  /** CLI question line (DecisionContent.question) — the actual ask. */
  question: string;

  /**
   * Pre-composed why-help block (composeWhyHelpBlock), or null when the stage has
   * none. Rendered verbatim by the panel; line breaks preserved.
   */
  whyHelp: string | null;

  /**
   * Per-level option ARRAYS — the CLI-parity shape (each level may hold >1 option).
   * The new CLI-parity panel renders `levels[currentLevel]`.
   */
  levels: AdvisoryLevels;

  /**
   * Flat first-of-each-level list [L1[0], L2[0], L3[0]] — retained for the shipped
   * (pre-CLI-parity) panel, which indexes `options` by level. Superset lives in
   * `levels`; drop once the CLI-parity panel is the only consumer.
   */
  options: AdvisoryOption[];

  meta: {
    agent: string;
    frequency: string;
  };
}

export type PanelEventType =
  | 'select'
  | 'show-simpler'
  | 'skip'
  | 'copy'
  | 'dismiss'
  | 'disable-project'
  | 'open-settings';

export interface PanelEvent {
  type: PanelEventType;
  advisoryId: string;
  selectedOptionId?: string;
}

export interface UIPort {
  showAdvisory(payload: AdvisoryPayload): Promise<PanelEvent>;
}
