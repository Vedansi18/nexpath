// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSurface } from './surface-view.js';
import { PE_FIXTURE, PE_FOOTER, DETAILS_HINT, EDIT_KEYS_HINT, BODY_HINT } from './fixtures/pe.js';
import { MPS_FIRST_FIXTURE, MPS_CONTINUATION_FIXTURE } from './fixtures/mps.js';
import { PEF_FIXTURE } from './fixtures/pef.js';
import type { SurfaceModel } from './surface-model.js';

/** Cells joined with a space — the gap between bullet and label is a column, not a character. */
function rowText(row: Element): string {
  return [...row.children].map((cell) => cell.textContent ?? '').join(' ').trim();
}

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

describe('what the parity test cannot see', () => {
  // Parity compares CONTENT: both sides are trimmed, because the rail is a
  // border here and the indents are padding, and it reads text, which carries no
  // colour. So indent columns and tones need asserting directly — mutation
  // testing found all three of these surviving the parity suite untouched.

  function classesOn(model: SurfaceModel, selector: string): string[] {
    return [...renderSurface(document, model, { focusIndex: 0 }).querySelectorAll(selector)]
      .flatMap((el) => [...el.classList]);
  }

  it('indents each surface\'s hints to the column the CLI uses', () => {
    // PE puts hints at four; MPS and PEF at six.
    expect(classesOn(PE_FIXTURE, '.np-hint')).toContain('np-ind-4');
    expect(classesOn(MPS_FIRST_FIXTURE, '.np-hint')).toContain('np-ind-6');
    expect(classesOn(MPS_CONTINUATION_FIXTURE, '.np-hint')).toContain('np-ind-6');
    expect(classesOn(PEF_FIXTURE, '.np-hint')).not.toContain('np-ind-4');
  });

  it('indents each surface\'s field content to the column the CLI uses', () => {
    // PE and MPS keep content at four; PEF puts it at six.
    expect(classesOn(PE_FIXTURE, 'textarea')).toContain('np-ind-4');
    expect(classesOn(MPS_FIRST_FIXTURE, 'textarea')).toContain('np-ind-4');
    expect(classesOn(PEF_FIXTURE, 'textarea')).toContain('np-ind-6');
  });

  it('renders the interruption helper dim, as the CLI does', () => {
    // "label, then dim helper" — the CLI's own comment (`cli-mps-popup.ts:398`).
    // Tone is invisible to parity; this drifted to plain and nothing failed.
    const frame = renderSurface(document, MPS_CONTINUATION_FIXTURE, { focusIndex: 0 });
    const helper = [...frame.querySelectorAll('.np-content')]
      .find((el) => el.textContent?.startsWith('Write directly in the coding agent'));

    expect(helper, 'the helper line must render').toBeDefined();
    expect(helper!.classList.contains('np-dim')).toBe(true);
  });

  it('pins one placeholder colour for both browsers', () => {
    // Chrome and Firefox default ::placeholder differently; C-3 wants one look.
    const src = readFileSync(resolve(process.cwd(), 'src/ext-browser/ui/surfaces/chrome.ts'), 'utf8');

    expect(src).toMatch(/\.np-field::placeholder \{ color: #9ba7a7; opacity: 1; \}/);
  });

  it('tints the Cancel row, and nothing else', () => {
    // The one label the CLI colours — paleYellow, so ending a sequence does not
    // look like every other option.
    const mps = renderSurface(document, MPS_FIRST_FIXTURE, { focusIndex: 0 });
    const cancel = [...mps.querySelectorAll('.np-label')].find((el) => el.textContent?.startsWith('Cancel'));

    expect(cancel!.classList.contains('np-cancel')).toBe(true);
    expect(mps.querySelectorAll('.np-cancel')).toHaveLength(1);
    expect(renderSurface(document, PE_FIXTURE, { focusIndex: 0 }).querySelector('.np-cancel')).toBeNull();
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
    // Two stylesheets style this layer: the frame's CHROME_STYLES and the
    // dock's own DOCK_CHROME_STYLES. A class is satisfied by a rule in either.
    const styleBlock = (src: string, marker: string): string => {
      const from = src.indexOf(marker);
      return src.slice(from, src.indexOf('\n`;', from));
    };
    const sheets = styleBlock(chrome, 'export const CHROME_STYLES = `')
      + styleBlock(read('dock.ts'), 'const DOCK_CHROME_STYLES = `');
    const styled = new Set([...sheets.matchAll(/\.(np-[\w-]+)/g)].map((m) => m[1]!));

    const used = new Set<string>();
    // Comment lines are dropped before scanning: prose like dock.ts's mention of
    // "the panel's .np-hidden" names classes this layer never applies.
    const withoutComments = (src: string): string =>
      src.split('\n').filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')).join('\n');
    // EVERY non-test module in the layer is globbed, not listed. A hard-coded
    // list already went stale twice — first missing the fixtures, then missing
    // refinement.ts — and a file that escapes this guard can apply a class no
    // rule styles, which jsdom cannot see. chrome.ts contributes only its
    // builder half, since its class names also appear inside the stylesheet.
    const surfacesDir = resolve(process.cwd(), 'src/ext-browser/ui/surfaces');
    const moduleFiles = [
      ...readdirSync(surfacesDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'chrome.ts'),
      ...readdirSync(resolve(surfacesDir, 'fixtures')).filter((f) => f.endsWith('.ts')).map((f) => `fixtures/${f}`),
    ];
    const sources = [chrome.slice(chrome.indexOf('// ── D2.3')), ...moduleFiles.map((f) => read(f))];
    for (const src of sources) {
      for (const m of withoutComments(src).matchAll(/np-[\w-]+/g)) used.add(m[0]);
    }

    // A name ending in `-` came from a template like `np-ind-${indent}`: the
    // class is completed at runtime, so it is satisfied by any rule sharing the
    // prefix. Anything else has to match a rule exactly.
    const unstyled = [...used].filter((name) => (name.endsWith('-')
      ? ![...styled].some((rule) => rule.startsWith(name))
      : !styled.has(name)));

    expect(unstyled).toEqual([]);
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
