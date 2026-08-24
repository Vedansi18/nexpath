// ============================================================================
// D6 — the interaction layer. One controller, four surfaces.
// ----------------------------------------------------------------------------
// The keyboard grammar is the CLI's, read out of the reducers rather than
// guessed (`cli-submit-popup.ts:990-1080`, PEF `:1141-1176`, MPS keyboard
// contracts in `first-popup.ts`/`continuation-popup.ts`):
//
//   ↑ / ↓        move row focus — CLAMPED, never wrapped, exactly the CLI's
//                Math.max(0,…)/Math.min(len-1,…). Plain arrows move ROWS even
//                while a field is focused; the CLI's editor has no plain-arrow
//                caret movement (only ←/→ by character, Ctrl+↑/↓ by line).
//   Enter        activate the focused row. In a field this SENDS — it never
//                inserts a newline; Ctrl+J is the newline, which is why the
//                hint says so.
//   Escape       per-surface, and deliberately NOT one handler (D1.4): PE
//                cancels (and cancel is where PEF opens — §8.3 wires feedback
//                to Use-original-or-Esc, never to send); MPS-1 only leaves
//                editor focus, or declines when no editor is focused; MPS-2
//                cancels the whole remaining sequence; PEF skips.
//   Space        in a field, types (native). On an action row the CLI toggles
//                help expansion — no row of these four surfaces carries help
//                (owner removed the descriptions), so here it is consumed and
//                does nothing, which also stops the page scrolling.
//   Ctrl/Cmd+J   newline at the caret.
//   Ctrl/Cmd+↑/↓ caret up/down one line inside the field, hand-built — a
//                textarea has none, and the hint promises it. The CLI moves by
//                VISUAL (wrapped) line; this moves by logical line, which is
//                what is implementable reliably on both browsers. Recorded as
//                the one knowing divergence.
//
// THE THREE PANEL FIXES (A4.6), re-applied rather than rediscovered:
//   1. keydown is ELEMENT-scoped on the controller's own wrapper — a document
//      listener cannot see into the closed shadow root (`composedPath` hides
//      its internals), which is exactly how the panel's keys went dead.
//   2. pointerdown anywhere in the wrapper re-takes focus — agent pages
//      aggressively steal it, and once blurred an element-scoped listener
//      never fires again.
//   3. stopPropagation (with preventDefault) on EVERY handled key — the host
//      page binds its own document-level ArrowUp (prompt history recall), and
//      preventDefault alone does not stop the event leaving the shadow root.
//
// STATIC-BUILD ACTIVATION (A4.3): never a silent no-op. Every activation both
// emits a typed SurfaceEvent and leaves a visible trace — a surface switch, the
// CLI's own local details-merge, or a notice line in the CLI's publicNotice
// slot. The one deliberate exception is the CLI's own guards (blank body, empty
// details), which the CLI refuses silently and so does this.
//
// REFINEMENT IS A HOOK, NOT A BRANCH: directional rows and Go back reach this
// controller only through `resolveActivation`. The shape was forced by C-4 (D5
// had to stay uncommitted while this landed) and kept afterwards on its own
// merit — this file has no opinion about what a row means, which is why a
// surface can add behaviour without editing the controller.
// ============================================================================

import type { SurfaceId, SurfaceModel, SurfaceRow } from './surface-model.js';
import { renderSurface } from './surface-view.js';

/** What the surfaces report upward. The dock's own union stays `dismiss`-only —
 * window furniture and surface semantics are different layers. */
export type SurfaceEvent =
  | { type: 'send'; surface: SurfaceId; text: string }
  | { type: 'apply-details'; surface: SurfaceId; mergedBody: string }
  | { type: 'use-original'; surface: SurfaceId }
  | { type: 'cancelled'; surface: SurfaceId }
  | { type: 'cancel-sequence'; surface: SurfaceId }
  | { type: 'interruption'; surface: SurfaceId }
  | { type: 'declined'; surface: SurfaceId }
  | { type: 'feedback'; surface: SurfaceId; category?: string; text?: string }
  | { type: 'feedback-skipped'; surface: SurfaceId }
  | { type: 'activate'; surface: SurfaceId; label: string };

/**
 * The pluggable activation hook (held D5 wiring plugs in here).
 * Return a transition to switch models, `'refuse'` for a CLI-style silent
 * guard, or null to fall through to the controller's own routing.
 */
export type ResolveActivation = (
  model: SurfaceModel,
  row: SurfaceRow,
  bodyText: string,
) => { model: SurfaceModel; focusIndex?: number } | 'refuse' | null;

export interface SurfaceControllerOptions {
  registry: Partial<Record<SurfaceId, SurfaceModel>>;
  initial: SurfaceId;
  doc?: Document;
  onEvent?: (event: SurfaceEvent) => void;
  resolveActivation?: ResolveActivation;
}

export interface SurfaceController {
  readonly element: HTMLElement;
  getModel(): SurfaceModel;
  getFocusIndex(): number;
  setSurface(id: SurfaceId): void;
  destroy(): void;
}

/** The CLI's one details-merge heading (`cli-submit-popup.ts:1041`). */
export const DETAILS_MERGE_HEADING = 'Additional details to incorporate:';

/**
 * The CLI's local, deterministic details-merge (owner request 2026-08-07, "MPS
 * parity"): merged verbatim under ONE heading — a second apply extends the
 * block instead of adding a second heading (live iMac report 2026-08-07).
 */
export function mergeDetailsIntoBody(body: string, details: string): string {
  return body.includes(DETAILS_MERGE_HEADING)
    ? `${body}\n${details.trim()}`
    : `${body}\n\n${DETAILS_MERGE_HEADING}\n${details.trim()}`;
}

/** Caret one logical line up or down, column preserved where the line allows. */
export function moveCaretLine(field: HTMLTextAreaElement, direction: -1 | 1): void {
  const text = field.value;
  const pos = field.selectionStart ?? 0;
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const column = pos - lineStart;

  if (direction < 0) {
    if (lineStart === 0) { field.setSelectionRange(0, 0); return; }
    const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLength = lineStart - 1 - prevStart;
    const target = prevStart + Math.min(column, prevLength);
    field.setSelectionRange(target, target);
    return;
  }

  const lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) { field.setSelectionRange(text.length, text.length); return; }
  const nextStart = lineEnd + 1;
  const nextEndRaw = text.indexOf('\n', nextStart);
  const nextEnd = nextEndRaw === -1 ? text.length : nextEndRaw;
  const target = nextStart + Math.min(column, nextEnd - nextStart);
  field.setSelectionRange(target, target);
}

/** Interactive rows (the ones focus can reach), in order. Notes never count. */
function interactiveRows(model: SurfaceModel): SurfaceRow[] {
  return model.rows.filter((r) => r.kind !== 'note');
}

export function createSurfaceController(
  host: HTMLElement,
  options: SurfaceControllerOptions,
): SurfaceController {
  const doc = options.doc ?? document;
  const emit = options.onEvent;

  const initialModel = options.registry[options.initial];
  if (!initialModel) throw new Error(`createSurfaceController: no model registered for "${options.initial}"`);
  let model: SurfaceModel = initialModel;
  let focusIndex = 0;
  let notice: string | undefined;
  /** The user's live edits, by field ordinal. The DOM owns them between renders. */
  let fieldValues: string[] = [];
  let destroyed = false;

  const wrapper = doc.createElement('div');
  wrapper.className = 'np-surface-root';
  wrapper.tabIndex = -1;
  host.appendChild(wrapper);

  // ── state helpers ─────────────────────────────────────────────────────────

  function fields(): HTMLTextAreaElement[] {
    return [...wrapper.querySelectorAll('textarea')];
  }

  function harvest(): void {
    fieldValues = fields().map((f) => f.value);
  }

  /** Field ordinal of an interactive row index, or -1 when it is not a field. */
  function fieldOrdinalOf(interactiveIndex: number): number {
    const rows = interactiveRows(model);
    let ordinal = -1;
    for (let i = 0; i <= interactiveIndex && i < rows.length; i++) {
      if (rows[i]!.kind === 'field') ordinal += 1;
    }
    return rows[interactiveIndex]?.kind === 'field' ? ordinal : -1;
  }

  function bodyText(): string {
    // Field ordinal 0 is the body on every surface that has one.
    return fieldValues[0] ?? '';
  }

  function render(): void {
    wrapper.replaceChildren(renderSurface(doc, model, { focusIndex, notice }));

    // Re-apply the user's edits — the freshly built textareas carry model text.
    const rendered = fields();
    fieldValues.forEach((value, i) => { if (rendered[i]) rendered[i]!.value = value; });

    // Row-focus and DOM-focus stay in step: a focused field row means its
    // textarea really has the keyboard, caret parked at the end (the CLI parks
    // it at the end when it rebuilds a field too).
    const ordinal = fieldOrdinalOf(focusIndex);
    if (ordinal >= 0 && rendered[ordinal]) {
      const field = rendered[ordinal]!;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    } else {
      wrapper.focus({ preventScroll: true });
    }

    // Clicking a row moves focus there; an ACTION row also activates, the way
    // the old panel's rows did. A field row must not activate on click —
    // clicking a textarea to type must never send.
    let interactiveIndex = -1;
    for (const rowEl of wrapper.querySelectorAll('.np-row')) {
      const bullet = rowEl.querySelector('.np-bullet');
      if (!bullet) continue;
      interactiveIndex += 1;
      const idx = interactiveIndex;
      rowEl.addEventListener('click', () => {
        if (destroyed) return;
        const row = interactiveRows(model)[idx];
        harvest();
        focusIndex = idx;
        notice = undefined;
        render();
        if (row && row.kind === 'action') activate(row);
      });
    }

    // A click into a details field must retarget Enter to the details row.
    rendered.forEach((field, ordinal) => {
      field.addEventListener('focus', () => {
        if (destroyed) return;
        const rows = interactiveRows(model);
        let seen = -1;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]!.kind === 'field') seen += 1;
          if (seen === ordinal) {
            if (focusIndex !== i) {
              harvest();
              const caret = field.selectionStart;
              focusIndex = i;
              render();
              const again = fields()[ordinal];
              if (again && caret !== null) again.setSelectionRange(caret, caret);
            }
            break;
          }
        }
      });
    });
  }

  function show(next: SurfaceModel, nextFocus = 0): void {
    model = next;
    focusIndex = nextFocus;
    fieldValues = interactiveRows(next)
      .filter((r) => r.kind === 'field')
      .map((r) => (r.kind === 'field' ? r.text : ''));
    render();
  }

  function say(text: string): void {
    notice = text;
    render();
  }

  // ── activation ────────────────────────────────────────────────────────────

  function activate(row: SurfaceRow): void {
    if (row.kind === 'note') return;

    // The held D5 hook first — directionals and Go back live behind it.
    const resolved = options.resolveActivation?.(model, row, bodyText());
    if (resolved === 'refuse') return;                         // a CLI-style silent guard
    if (resolved) {
      harvest();
      show(resolved.model, resolved.focusIndex ?? 0);
      return;
    }

    const surface = model.id;
    const pef = surface === 'prompt_enhancement_feedback';

    if (row.kind === 'field') {
      const ordinal = interactiveRows(model).filter((r, i) => r.kind === 'field'
        && i <= interactiveRows(model).indexOf(row)).length - 1;

      if (pef) {
        // PEF's Other: a reason typed freehand. Empty is refused, silently —
        // the CLI's reducer returns `pending` (`cli-submit-popup.ts:1166`).
        const text = (fieldValues[ordinal] ?? '').trim();
        if (text.length === 0) return;
        emit?.({ type: 'feedback', surface, text });
        say('Feedback recorded — static build.');
        return;
      }

      if (ordinal === 0) {
        // The body. BF-1: never send an empty or whitespace body — stay.
        const text = fieldValues[0] ?? '';
        if (text.trim().length === 0) return;
        emit?.({ type: 'send', surface, text });
        say('Sent — static build; no agent is wired.');
        return;
      }

      // The details field: the CLI's LOCAL merge, not an engine call. Blank
      // body or empty details cannot drive an apply (BF-1 / bug B); otherwise
      // the details land in the body under one heading, the field clears, and
      // focus returns to the body row so the next Enter sends the merged text.
      const details = (fieldValues[ordinal] ?? '').trim();
      const body = fieldValues[0] ?? '';
      if (body.trim().length === 0 || details.length === 0) return;
      const merged = mergeDetailsIntoBody(body, details);
      fieldValues[0] = merged;
      fieldValues[ordinal] = '';
      focusIndex = interactiveRows(model).findIndex((r) => r.kind === 'field');
      emit?.({ type: 'apply-details', surface, mergedBody: merged });
      render();
      return;
    }

    // Action rows.
    if (pef) {
      // A fixed reason submits directly.
      emit?.({ type: 'feedback', surface, category: row.label });
      say('Feedback recorded — static build.');
      return;
    }
    switch (row.act) {
      case 'use-original':
        // Cancel is where feedback opens (§8.3): Use original or Esc, never send.
        emit?.({ type: 'use-original', surface });
        switchTo('prompt_enhancement_feedback');
        return;
      case 'cancel-sequence':
        emit?.({ type: 'cancel-sequence', surface });
        say('Sequence cancelled — static build.');
        return;
      case 'interruption':
        emit?.({ type: 'interruption', surface });
        say('Interruption noted — static build; the sequence prompt would return after the response.');
        return;
      default:
        // Unknown rows are never a silent no-op (A4.3).
        emit?.({ type: 'activate', surface, label: row.label });
        say(`No action wired for "${row.label}" (static build).`);
    }
  }

  function switchTo(id: SurfaceId): void {
    const next = options.registry[id];
    if (!next) return;
    show(next);
  }

  // ── escape, per surface ───────────────────────────────────────────────────

  function onEscape(): void {
    const surface = model.id;
    switch (surface) {
      case 'prompt_enhancement':
        // The CLI's `close` → closed_no_send, and feedback is wired to cancel.
        emit?.({ type: 'cancelled', surface });
        switchTo('prompt_enhancement_feedback');
        return;
      case 'mps_first': {
        // Leave editor focus, preserving the draft; with no editor focused,
        // Esc declines the offer (nothing activated, so nothing to cancel).
        const root = wrapper.getRootNode() as Document | ShadowRoot;
        const active = root.activeElement;
        if (active instanceof HTMLTextAreaElement && wrapper.contains(active)) {
          active.blur();
          wrapper.focus({ preventScroll: true });
          return;
        }
        emit?.({ type: 'declined', surface });
        say('Declined — static build.');
        return;
      }
      case 'mps_continuation':
        // The footer says so: Esc cancels the whole remaining sequence.
        emit?.({ type: 'cancel-sequence', surface });
        say('Sequence cancelled — static build.');
        return;
      case 'prompt_enhancement_feedback':
        emit?.({ type: 'feedback-skipped', surface });
        say('Feedback skipped.');
        return;
    }
  }

  // ── keys ──────────────────────────────────────────────────────────────────

  function onKeyDown(e: KeyboardEvent): void {
    if (destroyed) return;
    const inField = e.target instanceof HTMLTextAreaElement;
    // The chord is EXACTLY Ctrl/Cmd — the hint names Cmd on macOS. Shift and Alt
    // disqualify it: Ctrl+Shift+J is the browser's own DevTools console,
    // Ctrl+Shift+arrows extend a selection by line, and Ctrl+Alt is AltGr on
    // many layouts. A terminal never sees those combinations, so the CLI grammar
    // has no claim on them — they stay native.
    const chord = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    // Row navigation is PLAIN arrows only: Shift+arrow inside a field is the
    // browser's select-by-line, which stealing the key would silently break.
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

    // Ctrl/Cmd+↑/↓ — caret line movement inside a field. Physical codes, the
    // D1.3 precedent: e.key is layout- and modifier-dependent.
    if (chord && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      if (inField) moveCaretLine(e.target as HTMLTextAreaElement, e.code === 'ArrowUp' ? -1 : 1);
      e.preventDefault(); e.stopPropagation();
      return;
    }

    // Ctrl/Cmd+J — the newline. Enter is send, so this is the only way in.
    if (chord && e.code === 'KeyJ') {
      if (inField) {
        const field = e.target as HTMLTextAreaElement;
        field.setRangeText('\n', field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));   // auto-grow listens here
      }
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (plain && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const last = interactiveRows(model).length - 1;
      const next = e.key === 'ArrowUp'
        ? Math.max(0, focusIndex - 1)
        : Math.min(last, focusIndex + 1);
      harvest();
      focusIndex = next;
      notice = undefined;
      render();
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (e.key === 'Enter') {
      harvest();
      const row = interactiveRows(model)[focusIndex];
      if (row) activate(row);
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (e.key === 'Escape') {
      harvest();
      onEscape();
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (e.key === ' ' && !inField) {
      // The CLI toggles help expansion here; none of these rows carries help
      // (the owner removed the descriptions), and unconsumed Space scrolls the
      // page.
      e.preventDefault(); e.stopPropagation();
    }
  }

  function onPointerDown(e: Event): void {
    if (destroyed) return;
    // Fix #2: re-take focus so the element-scoped keydown keeps firing. A
    // click on a textarea keeps its own focus; anything else focuses the
    // wrapper.
    if (!(e.target instanceof HTMLTextAreaElement)) {
      wrapper.focus({ preventScroll: true });
    }
  }

  wrapper.addEventListener('keydown', onKeyDown);
  wrapper.addEventListener('pointerdown', onPointerDown);

  show(model);

  return {
    element: wrapper,
    getModel: () => model,
    getFocusIndex: () => focusIndex,
    setSurface(id: SurfaceId): void {
      if (destroyed) return;
      switchTo(id);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      wrapper.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('pointerdown', onPointerDown);
      wrapper.remove();
    },
  };
}
