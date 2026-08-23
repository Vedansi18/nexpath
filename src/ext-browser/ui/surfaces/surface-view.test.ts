// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSurface } from './surface-view.js';
import { PE_FIXTURE, PE_FOOTER, DETAILS_HINT, EDIT_KEYS_HINT, BODY_HINT } from './fixtures/pe.js';
import type { SurfaceModel } from './surface-model.js';

// The CLI's own renderer, imported for the parity test below. Test-only: nothing
// that ships crosses this boundary, and C-5 forbids MODIFYING other modules and
// WIRING them into the extension — neither of which reading a reference does.
import { renderPromptEnhancementPopupFrameV1 } from '../../../prompt-enhancement/cli-submit-popup.js';

/**
 * The visible lines of a rendered surface.
 *
 * A textarea's content is its `value`, not its text node, and a multi-line value
 * is several CLI lines — so it is split. Trailing space is dropped on both sides
 * of the comparison; the CLI pads, CSS does not.
 */
function rowText(row: Element): string {
  // Cells are joined with a space. A bullet row is two flex cells and the gap
  // between them is the bullet column's width, not a character — so reading
  // `textContent` straight off the row would yield "●Use enhanced prompt" and
  // compare a layout detail rather than what the user reads.
  return [...row.children].map((cell) => cell.textContent ?? '').join(' ').trimEnd();
}

function domLines(frame: HTMLElement): string[] {
  const out: string[] = [];
  for (const row of frame.querySelectorAll('.np-row')) {
    const field = row.querySelector('textarea');
    if (field) {
      for (const line of field.value.split('\n')) out.push(line.trimEnd());
      continue;
    }
    out.push(rowText(row));
  }
  return out;
}

/**
 * The visible lines of a CLI frame, with the parts CSS provides removed: the
 * `│` rail is a border here, and the 4-column indent is padding. Both are
 * verified in `chrome.test.ts`; what this comparison is about is the CONTENT.
 */
function cliLines(frame: string): string[] {
  return frame.split('\n').map((line) => line.replace(/^│ ?/, '').trim());
}

/** A CLI render model mirroring PE_FIXTURE, so the two sides describe one popup. */
function cliModel(): unknown {
  return {
    title: 'Nexpath · Prompt enhancement',
    editorHeading: PE_FIXTURE.rows[0]!.label,
    identity: { enhancementId: 'e1', currentBodyId: 'b1', bodyRevision: 1, validationDecisionId: 'v1' },
    body: { editable: true },
    pinchLabel: { text: PE_FIXTURE.pinch!, derivedFrom: 'family' },
    whyHelp: { text: PE_FIXTURE.whyHelp!, reasonKind: 'risk_or_rollback' },
    publicCopy: { trustCues: PE_FIXTURE.trustCues!.map((t) => ({ publicSafeText: t })), diagnostics: [] },
    controls: {
      additionalDetails: { availability: 'available' },
      directional: [],
      feedback: { availability: 'available' },
      original: { availability: 'available' },
      currentBody: { availability: 'available' },
      close: { availability: 'available' },
    },
  };
}

function cliFrame(focusIndex: number, over: { detailsText?: string } = {}): string[] {
  const bodyRow = PE_FIXTURE.rows[0]!;
  const detailsRow = PE_FIXTURE.rows[1]!;
  return cliLines(
    renderPromptEnhancementPopupFrameV1(
      {
        model: cliModel(),
        editedBodyText: bodyRow.kind === 'field' ? bodyRow.text : '',
        additionalDetailsText: over.detailsText ?? (detailsRow.kind === 'field' ? detailsRow.text : ''),
      } as never,
      { focusIndex, helpExpanded: false } as never,
    ),
  );
}

function ourFrame(focusIndex: number): string[] {
  return domLines(renderSurface(document, PE_FIXTURE, { focusIndex })).map((l) => l.trim());
}

describe('PE surface — parity with the CLI (D3.5)', () => {
  // The point of this test. D-2 chose fluid CSS, which means the captured CLI
  // frames cannot be shipped as the payload and the DOM had to be authored
  // separately. Two authorings drift. This is what stops them: the reference is
  // the CLI's live renderer, not a copy of its output, so it cannot go stale.

  it.each([
    ['body', 0],
    ['additional details', 1],
    ['use original prompt', 2],
  ])('renders line-for-line what the CLI renders — focus on %s', (_label, focusIndex) => {
    expect(ourFrame(focusIndex)).toEqual(cliFrame(focusIndex));
  });

  it('is comparing something — the frames are not accidentally empty', () => {
    const lines = cliFrame(0);

    expect(lines.length).toBeGreaterThan(10);
    expect(lines).toContain('◆ NEXPATH CLI · Prompt enhancement');
  });

  it('differs between focus states, so the comparison has teeth', () => {
    expect(ourFrame(0)).not.toEqual(ourFrame(1));
  });

  it.each([
    ['below the first row', -1, 0],
    ['past the last row', 99, 2],
    ['fractional', 1.7, 1],
  ])('clamps an out-of-range focus the way the CLI does — %s', (_label, given, settled) => {
    // The CLI clamps and truncates. Without the same guard an out-of-range index
    // focuses nothing at all: no filled bullet, no hint line, a frame that reads
    // as broken rather than mis-focused. D6 drives this index.
    expect(ourFrame(given)).toEqual(cliFrame(given));
    expect(ourFrame(given)).toEqual(ourFrame(settled));
  });

  it('matches with an empty details field — a real CLI branch', () => {
    const emptied: SurfaceModel = {
      ...PE_FIXTURE,
      rows: PE_FIXTURE.rows.map((r, i) => (i === 1 && r.kind === 'field' ? { ...r, text: '' } : r)),
    };

    expect(domLines(renderSurface(document, emptied, { focusIndex: 1 })).map((l) => l.trim()))
      .toEqual(cliFrame(1, { detailsText: '' }));
  });
});

describe('PE surface — structure', () => {
  it('orders the rows as the CLI does', () => {
    const labels = [...renderSurface(document, PE_FIXTURE, { focusIndex: 0 }).querySelectorAll('.np-label')]
      .map((el) => el.textContent);

    expect(labels).toEqual(['Use enhanced prompt', 'Additional details', 'Use original prompt']);
  });

  it('puts the header block above the scroll band and the footer below it', () => {
    const frame = renderSurface(document, PE_FIXTURE, { focusIndex: 0 });

    expect(frame.querySelector('.np-fixed-top')!.textContent).toContain('◆ NEXPATH CLI · Prompt enhancement');
    expect(frame.querySelector('.np-scroll')!.textContent).toContain('Use enhanced prompt');
    expect(frame.querySelector('.np-footer')!.textContent).toContain(PE_FOOTER);
  });

  it('marks exactly one row focused, whichever it is', () => {
    for (const focusIndex of [0, 1, 2]) {
      const frame = renderSurface(document, PE_FIXTURE, { focusIndex });
      const focused = frame.querySelectorAll('.np-row.np-focused');

      expect(focused, `focus ${focusIndex}`).toHaveLength(1);
      expect(focused[0]!.querySelector('.np-bullet')!.textContent).toBe('●');
    }
  });

  it('renders editable fields as textareas carrying their text', () => {
    const fields = [...renderSurface(document, PE_FIXTURE, { focusIndex: 0 }).querySelectorAll('textarea')];

    expect(fields).toHaveLength(2);                       // body and details; not the action row
    expect(fields[0]!.value).toContain('Add a Stripe webhook handler');
    expect(fields[1]!.value).toBe('Keep the existing retry helper — do not rewrite it.');
  });

  it('the action row has no field', () => {
    const frame = renderSurface(document, PE_FIXTURE, { focusIndex: 2 });
    const labels = [...frame.querySelectorAll('.np-label')].map((el) => el.textContent);

    expect(labels[2]).toBe('Use original prompt');
    expect(frame.querySelectorAll('textarea')).toHaveLength(2);
  });
});

describe('PE surface — hints follow focus (D3.4)', () => {
  function hints(focusIndex: number): string[] {
    return [...renderSurface(document, PE_FIXTURE, { focusIndex }).querySelectorAll('.np-hint')]
      .map((el) => el.textContent ?? '');
  }

  it('shows the send hint only while the body is focused', () => {
    // Off-focus it would be a lie: Enter acts on whichever row IS focused.
    expect(hints(0)).toContain(`${EDIT_KEYS_HINT} · ${BODY_HINT}`);
    expect(hints(1).some((h) => h.includes(BODY_HINT))).toBe(false);
    expect(hints(2).some((h) => h.includes(BODY_HINT))).toBe(false);
  });

  it('shows the details hint always, and adds the edit keys when details is focused', () => {
    expect(hints(0)).toContain(DETAILS_HINT);
    expect(hints(2)).toContain(DETAILS_HINT);

    expect(hints(1)).toEqual([DETAILS_HINT, EDIT_KEYS_HINT]);   // order matters
  });
});

describe('no class escapes the stylesheet', () => {
  it('every np- class any surface file writes is styled in CHROME_STYLES', () => {
    // The guard for a whole class of bug that jsdom cannot see: a class applied
    // in TS but never given a rule renders as the browser's default. It caught
    // `np-field`, where an unstyled textarea would have arrived with its own
    // font, a white ground, a border and a resize grip inside a CLI frame.
    const read = (rel: string): string => readFileSync(resolve(process.cwd(), `src/ext-browser/ui/surfaces/${rel}`), 'utf8');
    const chrome = read('chrome.ts');
    const styles = chrome.slice(chrome.indexOf('export const CHROME_STYLES = `'));
    const styled = new Set([...styles.slice(0, styles.indexOf('\n`;')).matchAll(/\.(np-[\w-]+)/g)].map((m) => m[1]!));

    const used = new Set<string>();
    // chrome.ts's own class names appear inside the stylesheet too, so only its
    // builder half is scanned; the other files are all builder code.
    for (const src of [chrome.slice(chrome.indexOf('// ── D2.3')), read('surface-view.ts'), read('fixtures/pe.ts')]) {
      for (const m of src.matchAll(/np-[\w-]+/g)) used.add(m[0]);
    }

    expect([...used].filter((c) => !styled.has(c))).toEqual([]);
  });
});

describe('auto-grow (D3.3)', () => {
  it('resets the height before measuring, or the field only ever ratchets up', () => {
    // Asserted against the source, not the behaviour: jsdom reports scrollHeight
    // as 0, so nothing here can observe a field growing. Without the reset,
    // scrollHeight includes the slack of an already-tall box and the height can
    // never come back down when content shrinks. The live proof is D7's sweep;
    // this stops the line being deleted before then.
    const src = readFileSync(resolve(process.cwd(), 'src/ext-browser/ui/surfaces/surface-view.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function autoGrow'), src.indexOf('/** The editable field'));

    expect(body).toMatch(/height\s*=\s*'auto'/);
    expect(body.indexOf("'auto'")).toBeLessThan(body.indexOf('scrollHeight'));
  });

  it('grows the field on input, not only when it is built', () => {
    const frame = renderSurface(document, PE_FIXTURE, { focusIndex: 0 });
    const field = frame.querySelector('textarea')!;
    let grew = 0;
    Object.defineProperty(field, 'scrollHeight', { get: () => ++grew * 10 });

    field.dispatchEvent(new Event('input'));

    expect(grew).toBeGreaterThan(0);
  });
});

describe('renderSurface — the model drives everything', () => {
  const bare: SurfaceModel = {
    id: 'prompt_enhancement',
    label: 'Bare',
    rows: [{ kind: 'action', label: 'Only row' }],
    footer: 'footer',
  };

  it('omits the pinch, cues and why-help when the model has none', () => {
    const frame = renderSurface(document, bare, { focusIndex: 0 });

    expect(frame.querySelector('.np-pinch')).toBeNull();
    expect(frame.querySelector('.np-why')).toBeNull();
    expect(frame.querySelector('.np-caution')).toBeNull();
  });

  it('renders a provider-failure notice in the caution tone, only when present', () => {
    expect(renderSurface(document, bare, { focusIndex: 0 }).querySelector('.np-caution')).toBeNull();

    const failing = { ...bare, providerFailure: 'AI wording was unavailable (provider issue).' };
    expect(renderSurface(document, failing, { focusIndex: 0 }).querySelector('.np-caution')!.textContent)
      .toBe('AI wording was unavailable (provider issue).');
  });

  it('splits a multi-line why-help into one row per line, as the CLI does', () => {
    const multi = { ...bare, whyHelp: 'first line\nsecond line\nthird line' };

    const why = [...renderSurface(document, multi, { focusIndex: 0 }).querySelectorAll('.np-why')]
      .map((el) => el.textContent);

    expect(why).toEqual(['first line', 'second line', 'third line']);
  });

  it('opens a block with a blank row when the model asks for one', () => {
    const rows = renderSurface(document, PE_FIXTURE, { focusIndex: 0 }).querySelector('.np-scroll')!.children;
    const texts = [...rows].map((r) => rowText(r).trim());

    // The blank sits immediately before Additional details.
    const at = texts.indexOf('○ Additional details');
    expect(at, 'the details row must be found').toBeGreaterThan(0);
    expect(texts[at - 1]).toBe('');
  });
});
