/**
 * The backward-compatibility proof for this phase.
 *
 * The switch exists but must be INERT: no existing code path may consult it, and
 * the page's `fetch` patch — the one piece of shipped code that sits directly in
 * the user's submit path — must be byte-for-byte the fire-and-forget it is today.
 *
 * These are STRUCTURAL pins, deliberately. Once `main-world.ts` is modified at
 * all, "the bundle hash is unchanged" stops being available as a proof and has to
 * be replaced rather than claimed. A unit test cannot observe "patchedFetch did
 * not read a variable", so the source itself is asserted; the pins are written
 * against behaviour-bearing lines, not formatting, so they fail on a real change
 * and survive a reflow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mainWorld = readFileSync(join(here, 'main-world.ts'), 'utf8');

/** The body of `window.fetch = function patchedFetch(...)`, source-exact. */
function patchedFetchBody(): string {
  const start = mainWorld.indexOf('window.fetch = function patchedFetch(');
  expect(start).toBeGreaterThan(-1);
  const end = mainWorld.indexOf('\n};', start);
  expect(end).toBeGreaterThan(start);
  return mainWorld.slice(start, end);
}

describe('the submit-flow switch is inert in this phase', () => {
  it('patchedFetch still calls the native fetch unconditionally, with the original arguments', () => {
    const body = patchedFetchBody();
    expect(body).toContain('void maybeCaptureFetch(input, init).catch(() => {});');
    expect(body).toContain('return _nativeFetch(input, init);');
  });

  it('patchedFetch does not consult the switch — no arming, no awaiting, no branch', () => {
    const body = patchedFetchBody();
    for (const forbidden of ['isArmed', 'submitFlow', 'SUBMIT_FLOW', 'await ']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('patchedFetch is still synchronous — an async signature would change every caller\'s timing', () => {
    expect(mainWorld).toContain('window.fetch = function patchedFetch(');
    expect(mainWorld).not.toContain('window.fetch = async function patchedFetch(');
  });

  it('the switch is installed AFTER the fetch patch, so nothing delays the patch', () => {
    const patchAt = mainWorld.indexOf('window.fetch = function patchedFetch(');
    const setupAt = mainWorld.indexOf('setupSubmitFlowPage()');
    expect(setupAt).toBeGreaterThan(patchAt);
  });

  it('no shipped module reads the page-world switch yet (the HB2 seam is unused)', () => {
    // The handle is exposed for the next phase and for live read-back; if this
    // starts failing, the consuming phase has landed and this pin should move
    // with it rather than be deleted.
    const consumers = ['__nexpath_submit_flow__', 'isArmed()'];
    const capture = readFileSync(join(here, '..', 'content', 'agents', 'capture-kit.ts'), 'utf8');
    for (const c of consumers) expect(capture).not.toContain(c);
  });
});

describe('the composer capture path is untouched in this phase', () => {
  const captureKit = readFileSync(join(here, '..', 'content', 'agents', 'capture-kit.ts'), 'utf8');

  it('Replit\'s capture-phase listeners still only observe — no preventDefault, no stopPropagation', () => {
    // HB5 is what adds these under the switch. Until then their absence is the
    // proof that today's submit path is unchanged.
    expect(captureKit).not.toContain('preventDefault');
    expect(captureKit).not.toContain('stopPropagation');
  });
});
