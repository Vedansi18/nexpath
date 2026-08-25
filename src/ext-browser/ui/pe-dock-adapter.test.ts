// @vitest-environment jsdom
/**
 * The bridge between the engine popup flow and the UI developer's dock —
 * tested with the REAL dock, REAL surface controller, and REAL surface view
 * (no mocks of PR #1's code), so these are integration-grade: my producers
 * must satisfy their renderer, their keyboard/click grammar must come back
 * out as my commands, and the PEF-backed-by-signals flow must hold together.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountNexpathPeDock, mpsSurfaceModel, peSurfaceModel, pefSurfaceModel } from './pe-dock-adapter.js';
import { NEXPATH_DOCK_HOST_ID } from './surfaces/dock.js';
import type { PePanelControllerV1, PePanelEventV1, PeSequenceOfferViewV1, PePanelViewV1 } from './pe-contract.js';

let events: PePanelEventV1[];
let adapter: PePanelControllerV1;

const commands = () => events.filter((e) => e.type === 'command').map((e) => (e.type === 'command' ? e.command : null));

function view(overrides: Partial<PePanelViewV1> = {}): PePanelViewV1 {
  return {
    schemaVersion: 1, viewSeq: 1,
    title: 'Nexpath · Prompt enhancement',
    editorHeading: 'Use enhanced prompt',
    bodyText: 'Enhanced body text',
    bodyEditable: true,
    hasAdditionalDetails: true,
    additionalDetailsText: '',
    directional: [
      { actionType: 'shorter', label: 'Shorter', availability: 'available' },
      { actionType: 'more_thorough', label: 'More thorough', availability: 'requires_llm_budget' },
    ],
    refinement: false, hasFeedback: false, trustCues: ['Your original request is kept.'],
    pinchLabel: 'Shipping something?', whyHelp: 'Risky step — confirm first.',
    ...overrides,
  };
}

function offer(overrides: Partial<PeSequenceOfferViewV1> = {}): PeSequenceOfferViewV1 {
  return {
    schemaVersion: 1, kind: 'sequence_offer', viewSeq: 1,
    title: 'Nexpath · Multi-prompt sequence', heading: 'First prompt of your sequence',
    bodyText: 'build the login page first', remainingTaskCount: 2,
    taskSummaryLines: ['add a database', 'deploy'], cancelLabel: 'Use original prompt',
    ...overrides,
  };
}

/** The dock's shadow is closed — reach the surface DOM via the wrapper the
 * controller focuses (document.activeElement pierces to the host; for tests we
 * use the adapter-internal route: the dock host exists in light DOM, and the
 * REAL renderer parks focus inside, so we drive by keyboard + activeElement,
 * plus querying through the mount element captured from mountNexpathDock…
 * simplest honest route: grab the shadow root at attach time. */
let shadowRoots: ShadowRoot[];
const realAttachShadow = HTMLElement.prototype.attachShadow;

beforeEach(() => {
  document.body.innerHTML = '';
  shadowRoots = [];
  HTMLElement.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    const root = realAttachShadow.call(this, init);
    shadowRoots.push(root);
    return root;
  };
  events = [];
  adapter = mountNexpathPeDock({ onEvent: (e) => events.push(e) });
});

afterEach(() => {
  adapter.destroy();
  HTMLElement.prototype.attachShadow = realAttachShadow;
});

function surfaceEl(): HTMLElement {
  const root = shadowRoots.at(-1)!;
  return root.querySelector('.np-surface-root') as HTMLElement;
}
function bodyField(): HTMLTextAreaElement {
  return surfaceEl().querySelector('textarea') as HTMLTextAreaElement;
}
function rowByLabel(label: string): HTMLElement {
  const rows = [...surfaceEl().querySelectorAll('.np-row')];
  const hit = rows.find((r) => r.textContent?.includes(label));
  if (!hit) throw new Error(`no row containing "${label}"`);
  return hit as HTMLElement;
}
function pressOn(el: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init }));
}

describe('producers (my views → their models)', () => {
  it('the PE model carries body, details, directionals, Use-original, header rows', () => {
    const m = peSurfaceModel(view());
    expect(m.id).toBe('prompt_enhancement');
    expect(m.pinch).toBe('Shipping something?');
    expect(m.rows.filter((r) => r.kind === 'field')).toHaveLength(2);
    expect(m.rows.some((r) => r.kind === 'action' && r.act === 'use-original')).toBe(true);
    expect(m.rows.some((r) => r.kind === 'action' && r.label === 'Shorter')).toBe(true);
  });

  it('the MPS model carries the first prompt, the plan notes, and the engine cancel label', () => {
    const m = mpsSurfaceModel(offer());
    expect(m.id).toBe('mps_first');
    expect(m.rows.filter((r) => r.kind === 'note').map((r) => (r.kind === 'note' ? r.text : ''))).toEqual([
      'Sequence plan', 'add a database', 'deploy',
    ]);
    expect(m.rows.some((r) => r.kind === 'action' && r.act === 'cancel-sequence' && r.label === 'Use original prompt')).toBe(true);
  });

  it('the v1 PEF model has ONLY the two fixed categories — no free-text row', () => {
    const m = pefSurfaceModel();
    expect(m.rows).toHaveLength(2);
    expect(m.rows.every((r) => r.kind === 'action')).toBe(true);
  });
});

describe('PE surface flows (real dock + controller)', () => {
  it('show() renders in the dock; Enter on the body sends use_current with the LIVE text — no fixture notice', () => {
    adapter.show(view());
    expect(document.getElementById(NEXPATH_DOCK_HOST_ID)).toBeTruthy();
    expect(adapter.isOpen()).toBe(true);
    const body = bodyField();
    expect(body.value).toBe('Enhanced body text');
    body.value = 'edited live';
    pressOn(body, 'Enter');
    expect(commands()).toEqual([{ type: 'use_current', bodyText: 'edited live' }]);
    expect(surfaceEl().textContent).not.toContain('static build');
  });

  it('an EMPTY body Enter is the BF-1 silent guard — nothing emitted', () => {
    adapter.show(view());
    const body = bodyField();
    body.value = '   ';
    pressOn(body, 'Enter');
    expect(commands()).toHaveLength(0);
  });

  it('details Enter runs the CLI local merge and reports edit_body with the merged text', () => {
    adapter.show(view());
    (surfaceEl().querySelectorAll('textarea')[1] as HTMLTextAreaElement).focus();
    // The controller re-renders on row-focus change — re-query the LIVE node.
    const details = surfaceEl().querySelectorAll('textarea')[1] as HTMLTextAreaElement;
    details.value = 'keep the retry helper';
    pressOn(details, 'Enter');
    const cmd = commands()[0];
    expect(cmd).toMatchObject({ type: 'edit_body' });
    expect((cmd as { bodyText: string }).bodyText).toContain('Enhanced body text');
    expect((cmd as { bodyText: string }).bodyText).toContain('Additional details to incorporate:');
    expect((cmd as { bodyText: string }).bodyText).toContain('keep the retry helper');
    expect(bodyField().value).toContain('keep the retry helper'); // visible merge
  });

  it('an available directional row emits its command with the live body; an unavailable one is silently refused', () => {
    adapter.show(view());
    rowByLabel('Shorter').click();
    expect(commands()).toEqual([{ type: 'shorter', bodyText: 'Enhanced body text' }]);
    events.length = 0;
    adapter.setBusy(false); // pe-inject would re-enable on the next view; simulate
    rowByLabel('More thorough').click();
    expect(commands()).toHaveLength(0);
  });

  it('Go back renders on refinement views and emits go_back', () => {
    adapter.show(view({ refinement: true }));
    rowByLabel('Go back').click();
    expect(commands()).toEqual([{ type: 'go_back', }]);
  });

  it('setBusy(true) suppresses commands until the next show()', () => {
    adapter.show(view());
    adapter.setBusy(true);
    pressOn(bodyField(), 'Enter');
    expect(commands()).toHaveLength(0);
    adapter.show(view({ viewSeq: 2 }));
    pressOn(bodyField(), 'Enter');
    expect(commands()).toHaveLength(1);
  });
});

describe('PEF-backed-by-signals (owner decision 2026-08-25)', () => {
  it('Esc on PE opens the PEF surface; a category click records the signal THEN closes', () => {
    adapter.show(view());
    pressOn(surfaceEl(), 'Escape');
    expect(surfaceEl().textContent).toContain('Not relevant enough'); // PEF visible
    expect(commands()).toHaveLength(0); // nothing terminal yet
    rowByLabel('Too much or too long').click();
    expect(commands()).toEqual([
      { type: 'feedback_suggested', category: 'too_much_or_too_long' },
      { type: 'close' },
    ]);
  });

  it('Esc on PEF skips feedback and completes the remembered terminal', () => {
    adapter.show(view());
    pressOn(surfaceEl(), 'Escape'); // → PEF, pending close
    pressOn(surfaceEl(), 'Escape'); // skip
    expect(commands()).toEqual([{ type: 'close' }]);
  });

  it('Use-original opens PEF; skip completes with use_original', () => {
    adapter.show(view());
    rowByLabel('Use original prompt').click();
    expect(surfaceEl().textContent).toContain('Too much or too long');
    pressOn(surfaceEl(), 'Escape');
    expect(commands()).toEqual([{ type: 'use_original' }]);
  });
});

describe('MPS offer flows', () => {
  it('Enter on the offer body sends mps_send with the live text', () => {
    adapter.show(offer());
    const body = bodyField();
    body.value = 'edited first prompt';
    pressOn(body, 'Enter');
    expect(commands()).toEqual([{ type: 'mps_send', bodyText: 'edited first prompt' }]);
  });

  it('Esc with no editor focused declines; the cancel row goes through PEF then mps_cancel', () => {
    adapter.show(offer());
    pressOn(surfaceEl(), 'Escape'); // editor focused → blur only
    pressOn(surfaceEl(), 'Escape'); // now declines
    expect(commands()).toEqual([{ type: 'mps_decline' }]);

    events.length = 0;
    adapter.show(offer({ viewSeq: 2 }));
    rowByLabel('Use original prompt').click(); // the engine-labeled cancel row
    expect(surfaceEl().textContent).toContain('Not relevant enough'); // PEF
    rowByLabel('Not relevant enough').click();
    expect(commands()).toEqual([
      { type: 'feedback_suggested', category: 'not_relevant_enough' },
      { type: 'mps_cancel' },
    ]);
  });
});

describe('dock furniture', () => {
  it('the dock ✕ maps to plain close (window dismissal skips PEF) and hides', () => {
    adapter.show(view());
    const root = shadowRoots.find((r) => r.querySelector('[data-nexpath-dock-close], .np-dock-close, button'));
    const closeBtn = [...(root?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent?.includes('✕') || b.getAttribute('aria-label')?.toLowerCase().includes('close'));
    expect(closeBtn, 'dock close button').toBeTruthy();
    closeBtn!.click();
    expect(commands()).toEqual([{ type: 'close' }]);
    expect(adapter.isOpen()).toBe(false);
  });

  it('hide()/isOpen()/destroy() drive the dock', () => {
    adapter.show(view());
    expect(adapter.isOpen()).toBe(true);
    adapter.hide();
    expect(adapter.isOpen()).toBe(false);
    adapter.destroy();
    expect(document.getElementById(NEXPATH_DOCK_HOST_ID)).toBeNull();
  });
});

describe('chrome styles (live-caught 2026-08-25: unstyled transparent dock)', () => {
  it('show() installs the CLI frame stylesheet into the dock shadow root exactly once', () => {
    adapter.show(view());
    const dockShadow = shadowRoots.find((r) => r.querySelector('.np-surface-root'))!;
    const styleNodes = [...dockShadow.querySelectorAll('style')]
      .filter((s) => s.textContent?.includes('.np-frame'));
    expect(styleNodes.length).toBeGreaterThanOrEqual(1);
    adapter.show(view({ viewSeq: 2 }));
    const after = [...dockShadow.querySelectorAll('style')]
      .filter((s) => s.textContent?.includes('.np-frame'));
    expect(after.length).toBe(styleNodes.length); // once per dock lifetime, not per show
  });
});
