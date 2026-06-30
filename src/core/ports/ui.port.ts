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

export interface AdvisoryPayload {
  schemaVersion: 1;
  advisoryId: string;
  pinchLabel: string;
  stage: string;
  options: AdvisoryOption[];
  meta: {
    agent: string;
    frequency: string;
  };
}

export type PanelEventType = 'select' | 'show-simpler' | 'skip' | 'copy' | 'dismiss';

export interface PanelEvent {
  type: PanelEventType;
  advisoryId: string;
  selectedOptionId?: string;
}

export interface UIPort {
  showAdvisory(payload: AdvisoryPayload): Promise<PanelEvent>;
}
