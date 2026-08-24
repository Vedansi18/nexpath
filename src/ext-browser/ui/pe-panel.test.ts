// @vitest-environment jsdom
/**
 * PB4 — PE panel DOM behaviour: the locked layout renders from a view, the
 * dirty-details rule gates Use-enhanced, every control emits the right
 * command with the LIVE body text, Esc closes without sending, and busy
 * blocks input. The panel is logic-free by design — everything else is
 * pinned in pe-popup-host.test.ts against the real engine.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountNexpathPePanel } from './pe-panel.js';
import type { PePanelEventV1, PePanelViewV1 } from './pe-contract.js';

function view(overrides: Partial<PePanelViewV1> = {}): PePanelViewV1 {
  return {
    schemaVersion: 1,
    viewSeq: 1,
    title: 'Nexpath · Prompt enhancement',
    editorHeading: 'Use enhanced prompt',
    bodyText: 'Enhanced body text',
    bodyEditable: true,
    hasAdditionalDetails: true,
    additionalDetailsText: '',
    directional: [
      { actionType: 'shorter', label: 'Shorter', availability: 'available' },
      { actionType: 'more_thorough', label: 'More thorough', availability: 'available' },
      { actionType: 'more_project_grounded', label: 'More project-grounded', availability: 'requires_llm_budget' },
    ],
    refinement: false,
    hasFeedback: false,
    trustCues: [],
    pinchLabel: 'Final Review',
    whyHelp: 'This is a risky release step.',
    ...overrides,
  };
}

let root: HTMLDivElement;
let events: PePanelEventV1[];
let panel: ReturnType<typeof mountNexpathPePanel>;

function byText<T extends HTMLElement>(selector: string, text: string): T {
  const found = [...root.querySelectorAll<T>(selector)].find((el) => el.textContent === text);
  if (!found) throw new Error(`no ${selector} with text "${text}"`);
  return found;
}
const commands = () => events.filter((e) => e.type === 'command');

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  events = [];
  panel = mountNexpathPePanel(root, { onEvent: (e) => events.push(e) });
});

describe('locked layout rendering', () => {
  it('renders wordmark, title, pinch, why-help, heading, ONE body, adjust row, footer', () => {
    panel.show(view());
    expect(root.textContent).toContain('NEXPATH CLI');
    expect(root.textContent).toContain('Nexpath · Prompt enhancement');
    expect(root.textContent).toContain('Final Review');
    expect(root.textContent).toContain('This is a risky release step.');
    expect(root.textContent).toContain('Use enhanced prompt');
    expect(root.querySelectorAll('textarea.npe-body')).toHaveLength(1);
    expect((root.querySelector('textarea.npe-body') as HTMLTextAreaElement).value).toBe('Enhanced body text');
    expect(root.textContent).toContain('Adjust this version:');
    expect(byText('button', 'Use original prompt')).toBeTruthy();
    expect(byText('button', 'Use enhanced prompt')).toBeTruthy();
    expect(panel.isOpen()).toBe(true);
  });

  it('collapses absent header rows and hides the details block when the engine offers no action', () => {
    panel.show(view({ pinchLabel: undefined, whyHelp: undefined, hasAdditionalDetails: false }));
    expect(root.querySelector('.npe-pinch')).toBeNull();
    expect(root.querySelector('.npe-whyhelp')).toBeNull();
    expect(root.querySelector('textarea.npe-details')).toBeNull();
  });

  it('honours engine availability — a non-available directional renders disabled, never hidden', () => {
    panel.show(view());
    expect(byText<HTMLButtonElement>('button', 'Shorter').disabled).toBe(false);
    expect(byText<HTMLButtonElement>('button', 'More project-grounded').disabled).toBe(true);
  });

  it('renders the Go back row only on refinement views', () => {
    panel.show(view());
    expect(root.textContent).not.toContain('Go back');
    panel.show(view({ refinement: true, viewSeq: 2 }));
    byText('button', '← Go back to the previous version').click();
    expect(commands().at(-1)).toMatchObject({ viewSeq: 2, command: { type: 'go_back' } });
  });
});

describe('commands carry the LIVE body text', () => {
  it('Use enhanced sends use_current with the edited textarea value', () => {
    panel.show(view());
    const body = root.querySelector('textarea.npe-body') as HTMLTextAreaElement;
    body.value = 'Edited by the user';
    byText('button', 'Use enhanced prompt').click();
    expect(commands()).toEqual([
      { type: 'command', viewSeq: 1, command: { type: 'use_current', bodyText: 'Edited by the user' } },
    ]);
  });

  it('directional actions send their command with the live body', () => {
    panel.show(view());
    (root.querySelector('textarea.npe-body') as HTMLTextAreaElement).value = 'live text';
    byText('button', 'Shorter').click();
    expect(commands().at(-1)).toMatchObject({ command: { type: 'shorter', bodyText: 'live text' } });
  });

  it('Apply to prompt sends apply_details with body + details text', () => {
    panel.show(view());
    const details = root.querySelector('textarea.npe-details') as HTMLTextAreaElement;
    details.value = 'use OAuth, not passwords';
    details.dispatchEvent(new Event('input'));
    byText('button', 'Apply to prompt').click();
    expect(commands().at(-1)).toMatchObject({
      command: { type: 'apply_details', bodyText: 'Enhanced body text', detailsText: 'use OAuth, not passwords' },
    });
  });

  it('Use original sends use_original; ✕ sends close', () => {
    panel.show(view());
    byText('button', 'Use original prompt').click();
    byText('button', '✕').click();
    expect(commands().map((c) => c.command.type)).toEqual(['use_original', 'close']);
  });
});

describe('dirty-details rule', () => {
  it('typing details disables Use enhanced until applied or cleared — never silently sent or dropped', () => {
    panel.show(view());
    const details = root.querySelector('textarea.npe-details') as HTMLTextAreaElement;
    const useEnhanced = byText<HTMLButtonElement>('button', 'Use enhanced prompt');
    const apply = byText<HTMLButtonElement>('button', 'Apply to prompt');
    expect(useEnhanced.disabled).toBe(false);
    expect(apply.disabled).toBe(true);

    details.value = 'dirty';
    details.dispatchEvent(new Event('input'));
    expect(useEnhanced.disabled).toBe(true);
    expect(apply.disabled).toBe(false);

    details.value = '';
    details.dispatchEvent(new Event('input'));
    expect(useEnhanced.disabled).toBe(false);
  });
});

describe('keys and busy state', () => {
  it('Esc inside the panel emits close and stops propagation to the host page', () => {
    panel.show(view());
    const body = root.querySelector('textarea.npe-body') as HTMLTextAreaElement;
    const hostSpy = vi.fn();
    document.body.addEventListener('keydown', hostSpy);
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(commands().at(-1)).toMatchObject({ command: { type: 'close' } });
    expect(hostSpy).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', hostSpy);
  });

  it('busy suppresses commands until the next show() re-enables', () => {
    panel.show(view());
    panel.setBusy(true);
    byText('button', 'Use enhanced prompt').click();
    expect(commands()).toHaveLength(0);
    panel.show(view({ viewSeq: 2 }));
    byText('button', 'Use enhanced prompt').click();
    expect(commands().at(-1)).toMatchObject({ viewSeq: 2 });
  });

  it('hide closes; destroy removes the DOM and listeners', () => {
    panel.show(view());
    panel.hide();
    expect(panel.isOpen()).toBe(false);
    panel.destroy();
    expect(root.querySelector('.npe-root')).toBeNull();
  });
});

describe('MPS-1 sequence offer view (PB6)', () => {
  const offer = (overrides: Partial<import('./pe-contract.js').PeSequenceOfferViewV1> = {}) => ({
    schemaVersion: 1 as const,
    kind: 'sequence_offer' as const,
    viewSeq: 1,
    title: 'Nexpath · Multi-prompt sequence',
    heading: 'First prompt of your sequence',
    bodyText: 'build the login page first',
    remainingTaskCount: 2,
    taskSummaryLines: ['add a database', 'deploy to production'],
    cancelLabel: 'Use original prompt',
    ...overrides,
  });

  it('renders title, first prompt, plan lines, and the Send/cancel footer', () => {
    panel.show(offer());
    expect(root.textContent).toContain('Nexpath · Multi-prompt sequence');
    expect((root.querySelector('textarea.npe-body') as HTMLTextAreaElement).value).toBe('build the login page first');
    expect(root.textContent).toContain('Then 2 more prompts in this sequence:');
    expect(root.textContent).toContain('add a database');
    expect(byText('button', 'Use original prompt')).toBeTruthy();
    expect(byText('button', 'Send first prompt')).toBeTruthy();
  });

  it('Send carries the live edited text; cancel and ✕/Esc emit their MPS outcomes', () => {
    panel.show(offer());
    const body = root.querySelector('textarea.npe-body') as HTMLTextAreaElement;
    body.value = 'edited first prompt';
    byText('button', 'Send first prompt').click();
    byText('button', 'Use original prompt').click();
    byText('button', '✕').click();
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(commands().map((c) => c.command)).toEqual([
      { type: 'mps_send', bodyText: 'edited first prompt' },
      { type: 'mps_cancel' },
      { type: 'mps_decline' },
      { type: 'mps_decline' },
    ]);
  });

  it('a singular remaining task renders without a plural and zero renders no plan block', () => {
    panel.show(offer({ remainingTaskCount: 1, taskSummaryLines: ['deploy'] }));
    expect(root.textContent).toContain('Then 1 more prompt in this sequence:');
    panel.show(offer({ viewSeq: 2, remainingTaskCount: 0, taskSummaryLines: [] }));
    expect(root.textContent).not.toContain('more prompt');
  });
});

describe('feedback v1 (PB5 — suggested categories as content-free signals)', () => {
  it('renders the two suggested categories only when the engine offers feedback', () => {
    panel.show(view());
    expect(root.textContent).not.toContain('Feedback:');
    panel.show(view({ viewSeq: 2, hasFeedback: true }));
    expect(root.textContent).toContain('Feedback:');
    expect(byText('button', 'Not relevant enough')).toBeTruthy();
    expect(byText('button', 'Too much / too long')).toBeTruthy();
    // No free-text field anywhere in the row (typed feedback rows deferred).
    expect(root.querySelectorAll('textarea')).toHaveLength(2); // body + details only
  });

  it('a category click emits the content-free command, acknowledges, and the popup STAYS interactive', () => {
    panel.show(view({ hasFeedback: true }));
    byText('button', 'Too much / too long').click();
    expect(commands().at(-1)).toMatchObject({
      command: { type: 'feedback_suggested', category: 'too_much_or_too_long' },
    });
    expect(root.textContent).toContain('thanks — noted');
    expect(byText<HTMLButtonElement>('button', 'Not relevant enough').disabled).toBe(true);
    // Non-terminal: other controls still work (panel not busy).
    byText('button', 'Use original prompt').click();
    expect(commands().at(-1)).toMatchObject({ command: { type: 'use_original' } });
  });
});
