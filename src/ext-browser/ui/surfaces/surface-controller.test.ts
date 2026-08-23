// @vitest-environment jsdom
//
// D6 — the interaction layer, driven with real KeyboardEvents.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSurfaceController,
  mergeDetailsIntoBody,
  moveCaretLine,
  DETAILS_MERGE_HEADING,
  type SurfaceController,
  type SurfaceEvent,
} from './surface-controller.js';
import { PE_FIXTURE } from './fixtures/pe.js';
import { MPS_FIRST_FIXTURE, MPS_CONTINUATION_FIXTURE, MPS_CANCEL_LABEL } from './fixtures/mps.js';
import { PEF_FIXTURE } from './fixtures/pef.js';
import type { SurfaceModel } from './surface-model.js';

const REGISTRY = {
  prompt_enhancement: PE_FIXTURE,
  mps_first: MPS_FIRST_FIXTURE,
  mps_continuation: MPS_CONTINUATION_FIXTURE,
  prompt_enhancement_feedback: PEF_FIXTURE,
};

let host: HTMLElement;
let events: SurfaceEvent[];
let controller: SurfaceController | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  events = [];
});

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  document.body.innerHTML = '';
});

function mount(initial: keyof typeof REGISTRY = 'prompt_enhancement', extra: object = {}): SurfaceController {
  controller = createSurfaceController(host, {
    registry: REGISTRY,
    initial,
    onEvent: (e) => events.push(e),
    ...extra,
  });
  return controller;
}

function key(target: Element, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code: init.code ?? key, bubbles: true, cancelable: true, ...init }));
}

function bodyField(): HTMLTextAreaElement {
  return host.querySelector('textarea')!;
}

// ── construction ─────────────────────────────────────────────────────────────

describe('construction', () => {
  it('renders the initial surface into a focusable np-surface-root wrapper', () => {
    const c = mount();

    expect(c.element.className).toBe('np-surface-root');
    expect(c.element.tabIndex).toBe(-1);
    expect(host.textContent).toContain('◆ NEXPATH CLI · Prompt enhancement');
  });

  it('refuses an initial surface that is not registered', () => {
    expect(() => createSurfaceController(host, { registry: {}, initial: 'prompt_enhancement' }))
      .toThrow('no model registered');
  });

  it('DOM-focuses the body field when the focused row is a field', () => {
    mount();

    expect(document.activeElement).toBe(bodyField());
  });
});

// ── navigation ───────────────────────────────────────────────────────────────

describe('navigation — the CLI clamp, never a wrap', () => {
  it('ArrowDown walks the interactive rows and clamps at the last', () => {
    const c = mount();                       // PE: body, details, use-original

    key(c.element, 'ArrowDown');
    expect(c.getFocusIndex()).toBe(1);
    key(c.element, 'ArrowDown');
    expect(c.getFocusIndex()).toBe(2);
    key(c.element, 'ArrowDown');
    expect(c.getFocusIndex()).toBe(2);       // clamped, not wrapped to 0
  });

  it('ArrowUp clamps at the first row', () => {
    const c = mount();

    key(c.element, 'ArrowUp');

    expect(c.getFocusIndex()).toBe(0);
  });

  it('moving focus onto a field row hands it the real keyboard', () => {
    const c = mount();
    key(c.element, 'ArrowDown');             // details

    expect(document.activeElement).toBe(host.querySelectorAll('textarea')[1]);
    key(c.element, 'ArrowDown');             // Use original — an action row
    expect(document.activeElement).toBe(c.element);
  });

  it('plain arrows move ROWS even while a field is focused — the CLI has no plain-arrow caret', () => {
    const c = mount();

    key(bodyField(), 'ArrowDown');           // dispatched from inside the textarea

    expect(c.getFocusIndex()).toBe(1);
  });

  it('preserves the user\'s edits across the re-render a focus move causes', () => {
    const c = mount();
    bodyField().value = 'edited by the user';

    key(c.element, 'ArrowDown');
    key(c.element, 'ArrowUp');

    expect(bodyField().value).toBe('edited by the user');
  });
});

// ── Enter on the body ────────────────────────────────────────────────────────

describe('Enter on the body — send', () => {
  it('emits the EDITED text and says so', () => {
    mount();
    bodyField().value = 'the edited prompt';

    key(bodyField(), 'Enter');

    expect(events).toEqual([{ type: 'send', surface: 'prompt_enhancement', text: 'the edited prompt' }]);
    expect(host.textContent).toContain('Sent — static build');
  });

  it('refuses a blank body, silently — BF-1', () => {
    mount();
    bodyField().value = '   \n  ';

    key(bodyField(), 'Enter');

    expect(events).toEqual([]);
  });
});

// ── Enter on the details — the CLI local merge ───────────────────────────────

describe('Enter on the details — the CLI\'s local merge', () => {
  it('merges under the one heading, clears the field, and returns focus to the body', () => {
    const c = mount();
    const details = host.querySelectorAll('textarea')[1]!;
    key(c.element, 'ArrowDown');             // focus details

    key(host.querySelectorAll('textarea')[1]!, 'Enter');

    const body = bodyField().value;
    expect(body).toContain(`\n\n${DETAILS_MERGE_HEADING}\nKeep the existing retry helper — do not rewrite it.`);
    expect(host.querySelectorAll('textarea')[1]!.value).toBe('');
    expect(c.getFocusIndex()).toBe(0);
    expect(events[0]!.type).toBe('apply-details');
    void details;
  });

  it('a second apply extends the ONE block — no second heading (live iMac report)', () => {
    const c = mount();
    key(c.element, 'ArrowDown');
    key(host.querySelectorAll('textarea')[1]!, 'Enter');      // first apply

    key(c.element, 'ArrowDown');
    host.querySelectorAll('textarea')[1]!.value = 'and one more thing';
    key(host.querySelectorAll('textarea')[1]!, 'Enter');      // second apply

    const body = bodyField().value;
    expect(body.split(DETAILS_MERGE_HEADING)).toHaveLength(2);  // exactly one heading
    expect(body).toContain('and one more thing');
  });

  it('refuses empty details and a blank body, silently', () => {
    const c = mount();
    key(c.element, 'ArrowDown');             // focus stays on details throughout
    host.querySelectorAll('textarea')[1]!.value = '   ';
    key(host.querySelectorAll('textarea')[1]!, 'Enter');
    expect(events).toEqual([]);

    bodyField().value = '';
    host.querySelectorAll('textarea')[1]!.value = 'details';
    key(host.querySelectorAll('textarea')[1]!, 'Enter');
    expect(events).toEqual([]);
  });

  it('mergeDetailsIntoBody matches the CLI character for character', () => {
    expect(mergeDetailsIntoBody('body', ' details ')).toBe(`body\n\n${DETAILS_MERGE_HEADING}\ndetails`);
    expect(mergeDetailsIntoBody(`body\n\n${DETAILS_MERGE_HEADING}\nfirst`, 'second'))
      .toBe(`body\n\n${DETAILS_MERGE_HEADING}\nfirst\nsecond`);
  });
});

// ── cancel paths — where PEF opens ───────────────────────────────────────────

describe('cancel is where feedback opens (§8.3)', () => {
  it('Use original prompt switches to PEF and reports it', () => {
    const c = mount();
    key(c.element, 'ArrowDown');
    key(c.element, 'ArrowDown');             // Use original prompt

    key(c.element, 'Enter');

    expect(events).toEqual([{ type: 'use-original', surface: 'prompt_enhancement' }]);
    expect(c.getModel().id).toBe('prompt_enhancement_feedback');
    expect(host.textContent).toContain('Prompt enhancement feedback');
  });

  it('Escape on PE cancels into PEF', () => {
    const c = mount();

    key(c.element, 'Escape');

    expect(events).toEqual([{ type: 'cancelled', surface: 'prompt_enhancement' }]);
    expect(c.getModel().id).toBe('prompt_enhancement_feedback');
  });
});

// ── the other Escapes, per surface ───────────────────────────────────────────

describe('Escape is per-surface — never one handler', () => {
  it('MPS-1: leaves editor focus first, preserving the draft', () => {
    const c = mount('mps_first');
    bodyField().value = 'a draft the user typed';
    expect(document.activeElement).toBe(bodyField());

    key(bodyField(), 'Escape');

    expect(document.activeElement).toBe(c.element);   // editor left, nothing emitted
    expect(events).toEqual([]);
    expect(bodyField().value).toBe('a draft the user typed');
  });

  it('MPS-1: with no editor focused, Esc declines the offer', () => {
    const c = mount('mps_first');
    key(bodyField(), 'Escape');              // first Esc: leave the editor

    key(c.element, 'Escape');                // second Esc: decline

    expect(events).toEqual([{ type: 'declined', surface: 'mps_first' }]);
    expect(host.textContent).toContain('Declined — static build.');
  });

  it('MPS-2: Esc cancels the whole remaining sequence — the footer says so', () => {
    const c = mount('mps_continuation');

    key(c.element, 'Escape');

    expect(events).toEqual([{ type: 'cancel-sequence', surface: 'mps_continuation' }]);
    expect(host.textContent).toContain('Sequence cancelled — static build.');
  });

  it('PEF: Esc skips', () => {
    const c = mount('prompt_enhancement_feedback');

    key(c.element, 'Escape');

    expect(events).toEqual([{ type: 'feedback-skipped', surface: 'prompt_enhancement_feedback' }]);
  });
});

// ── PEF activation ───────────────────────────────────────────────────────────

describe('PEF', () => {
  it('a fixed reason submits on Enter', () => {
    const c = mount('prompt_enhancement_feedback');

    key(c.element, 'Enter');                 // focus 0 = Not relevant enough

    expect(events).toEqual([{
      type: 'feedback', surface: 'prompt_enhancement_feedback', category: 'Not relevant enough',
    }]);
  });

  it('Other requires text — empty is refused, as the CLI\'s reducer refuses it', () => {
    const c = mount('prompt_enhancement_feedback');
    key(c.element, 'ArrowDown');
    key(c.element, 'ArrowDown');             // Other (the field row)

    key(bodyField(), 'Enter');
    expect(events).toEqual([]);

    bodyField().value = 'my own reason';
    key(bodyField(), 'Enter');
    expect(events).toEqual([{
      type: 'feedback', surface: 'prompt_enhancement_feedback', text: 'my own reason',
    }]);
  });
});

// ── MPS action rows ──────────────────────────────────────────────────────────

describe('MPS action rows', () => {
  it('Cancel emits cancel-sequence with an echo', () => {
    const c = mount('mps_first');
    key(c.element, 'ArrowDown');
    key(c.element, 'ArrowDown');             // Cancel

    key(c.element, 'Enter');

    expect(events).toEqual([{ type: 'cancel-sequence', surface: 'mps_first' }]);
    expect(host.textContent).toContain('Sequence cancelled');
  });

  it('the interruption row emits and echoes', () => {
    const c = mount('mps_continuation');
    key(c.element, 'ArrowDown');
    key(c.element, 'ArrowDown');             // interruption

    key(c.element, 'Enter');

    expect(events).toEqual([{ type: 'interruption', surface: 'mps_continuation' }]);
    expect(host.textContent).toContain('Interruption noted');
  });
});

// ── the editor chords ────────────────────────────────────────────────────────

describe('Ctrl/Cmd+J — the newline, because Enter is send', () => {
  it('inserts at the caret and triggers auto-grow via input', () => {
    mount();
    const field = bodyField();
    field.value = 'ab';
    field.setSelectionRange(1, 1);
    let grew = false;
    field.addEventListener('input', () => { grew = true; });

    key(field, 'j', { code: 'KeyJ', ctrlKey: true });

    expect(field.value).toBe('a\nb');
    expect(field.selectionStart).toBe(2);
    expect(grew).toBe(true);
  });

  it('accepts the Cmd spelling the macOS hint names', () => {
    mount();
    const field = bodyField();
    field.value = 'x';
    field.setSelectionRange(1, 1);

    key(field, 'j', { code: 'KeyJ', metaKey: true });

    expect(field.value).toBe('x\n');
  });
});

describe('Ctrl/Cmd+↑/↓ — caret line movement, hand-built', () => {
  it('moves the caret a logical line, preserving the column where it can', () => {
    const field = document.createElement('textarea');
    field.value = 'first line\nsecond\nthird line';
    document.body.appendChild(field);

    field.setSelectionRange(9, 9);           // column 9 on line 1
    moveCaretLine(field, 1);
    expect(field.selectionStart).toBe(17);   // clamped to the end of 'second'

    moveCaretLine(field, 1);
    expect(field.selectionStart).toBe(24);   // column 6 restored on 'third line'

    moveCaretLine(field, -1);
    expect(field.selectionStart).toBe(17);
  });

  it('clamps the column when moving UP onto a shorter line', () => {
    // The downward cases never exercise this branch — a long line above a short
    // one is the input that does. Without the clamp the caret lands mid-way
    // through the WRONG line.
    const field = document.createElement('textarea');
    field.value = 'ab\na much longer line';
    document.body.appendChild(field);

    field.setSelectionRange(11, 11);         // column 8 on the long line

    moveCaretLine(field, -1);

    expect(field.selectionStart).toBe(2);    // clamped to the end of 'ab'
  });

  it('clamps at the first and last line', () => {
    const field = document.createElement('textarea');
    field.value = 'one\ntwo';
    document.body.appendChild(field);

    field.setSelectionRange(1, 1);
    moveCaretLine(field, -1);
    expect(field.selectionStart).toBe(0);

    field.setSelectionRange(5, 5);
    moveCaretLine(field, 1);
    expect(field.selectionStart).toBe(7);
  });

  it('is wired to the chord inside a field, and the row focus does not move', () => {
    const c = mount();
    const field = bodyField();
    field.setSelectionRange(0, 0);

    key(field, 'ArrowDown', { code: 'ArrowDown', ctrlKey: true });

    expect(c.getFocusIndex()).toBe(0);       // caret moved, row focus did not
  });
});

// ── the three panel fixes ────────────────────────────────────────────────────

describe('the three panel fixes (A4.6)', () => {
  it('stops every handled key from reaching the page — the ArrowUp hijack', () => {
    const c = mount();
    let leaked = 0;
    const listener = (): void => { leaked += 1; };
    document.addEventListener('keydown', listener);

    key(c.element, 'ArrowDown');
    key(c.element, 'Enter');
    key(c.element, 'Escape');
    key(c.element, ' ', { code: 'Space' });

    document.removeEventListener('keydown', listener);
    expect(leaked).toBe(0);
  });

  it('lets unhandled keys pass — only handled keys are stopped', () => {
    const c = mount();
    let seen = 0;
    const listener = (): void => { seen += 1; };
    document.addEventListener('keydown', listener);

    key(c.element, 'a', { code: 'KeyA' });

    document.removeEventListener('keydown', listener);
    expect(seen).toBe(1);
  });

  it('pointerdown outside a field re-takes focus, so the scoped listener keeps firing', () => {
    const c = mount('prompt_enhancement_feedback');   // focus 0 is an action row
    (document.activeElement as HTMLElement | null)?.blur?.();

    c.element.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(document.activeElement).toBe(c.element);
  });

  it('the keydown listener is scoped to the wrapper — a stray key elsewhere does nothing', () => {
    const c = mount();

    key(document.body, 'ArrowDown');

    expect(c.getFocusIndex()).toBe(0);
  });
});

// ── clicks ───────────────────────────────────────────────────────────────────

describe('clicks', () => {
  it('an action row activates on click, as the old panel\'s rows did', () => {
    const c = mount();
    const useOriginal = [...host.querySelectorAll('.np-label')]
      .find((el) => el.textContent === 'Use original prompt')!;

    useOriginal.closest('.np-row')!.dispatchEvent(new Event('click', { bubbles: true }));

    expect(events).toEqual([{ type: 'use-original', surface: 'prompt_enhancement' }]);
    expect(c.getModel().id).toBe('prompt_enhancement_feedback');
  });

  it('a field row focuses on click and does NOT activate — clicking to type must never send', () => {
    const c = mount();
    key(c.element, 'ArrowDown');
    key(c.element, 'ArrowDown');             // park focus away from the body

    const bodyLabel = [...host.querySelectorAll('.np-label')]
      .find((el) => el.textContent === 'Use enhanced prompt')!;
    bodyLabel.closest('.np-row')!.dispatchEvent(new Event('click', { bubbles: true }));

    expect(c.getFocusIndex()).toBe(0);
    expect(events).toEqual([]);
  });

  it('focusing the details textarea retargets Enter to the details row', () => {
    const c = mount();
    const details = host.querySelectorAll('textarea')[1]!;

    details.dispatchEvent(new Event('focus', { bubbles: true }));

    expect(c.getFocusIndex()).toBe(1);
    key(host.querySelectorAll('textarea')[1]!, 'Enter');
    expect(events[0]!.type).toBe('apply-details');   // applied, not sent
  });
});

// ── the pluggable hook (held D5 wiring plugs in here) ────────────────────────

describe('resolveActivation', () => {
  const other: SurfaceModel = {
    id: 'mps_first', label: 'Other', footer: 'f',
    rows: [{ kind: 'action', label: 'only' }],
  };

  it('a returned transition switches the model', () => {
    const c = mount('prompt_enhancement', {
      resolveActivation: () => ({ model: other }),
    });

    key(c.element, 'Enter');

    expect(c.getModel()).toBe(other);
    expect(events).toEqual([]);              // the hook consumed the activation
  });

  it("'refuse' is the CLI-style silent guard", () => {
    mount('prompt_enhancement', { resolveActivation: () => 'refuse' });
    bodyField().value = 'text';

    key(bodyField(), 'Enter');

    expect(events).toEqual([]);
  });

  it('null falls through to the controller\'s own routing', () => {
    mount('prompt_enhancement', { resolveActivation: () => null });
    bodyField().value = 'text';

    key(bodyField(), 'Enter');

    expect(events[0]!.type).toBe('send');
  });

  it('an unknown action row is never a silent no-op (A4.3)', () => {
    const registry = {
      ...REGISTRY,
      mps_first: {
        ...MPS_FIRST_FIXTURE,
        rows: [{ kind: 'action', label: 'Mystery row' }],
      } as SurfaceModel,
    };
    controller = createSurfaceController(host, {
      registry, initial: 'mps_first', onEvent: (e) => events.push(e),
    });

    key(controller.element, 'Enter');

    expect(events).toEqual([{ type: 'activate', surface: 'mps_first', label: 'Mystery row' }]);
    expect(host.textContent).toContain('No action wired for "Mystery row"');
  });
});

// ── notices ──────────────────────────────────────────────────────────────────

describe('the notice slot', () => {
  it('renders in the CLI\'s publicNotice position: blank, notice, blank, footer', () => {
    mount('mps_continuation');
    key(controller!.element, 'Escape');

    const footerRows = [...host.querySelectorAll('.np-footer .np-row')]
      .map((r) => [...r.children].map((c2) => c2.textContent ?? '').join(' ').trim());

    expect(footerRows).toEqual(['', 'Sequence cancelled — static build.', '', 'Enter send · Esc cancels sequence']);
  });

  it('clears on the next focus move, like the CLI clears publicNotice each loop', () => {
    const c = mount('mps_continuation');
    key(c.element, 'Escape');
    expect(host.textContent).toContain('Sequence cancelled');

    key(c.element, 'ArrowDown');

    expect(host.textContent).not.toContain('Sequence cancelled');
  });
});

// ── lifecycle ────────────────────────────────────────────────────────────────

describe('lifecycle', () => {
  it('setSurface switches; an unregistered id is ignored', () => {
    const c = mount();

    c.setSurface('mps_continuation');
    expect(c.getModel().id).toBe('mps_continuation');

    const before = c.getModel();
    c.setSurface('prompt_enhancement');
    expect(c.getModel().id).toBe('prompt_enhancement');
    void before;
  });

  it('destroy removes the wrapper and deadens every key', () => {
    const c = mount();
    c.destroy();

    expect(host.querySelector('.np-surface-root')).toBeNull();
    expect(() => key(document.body, 'ArrowDown')).not.toThrow();
    expect(events).toEqual([]);
  });
});
