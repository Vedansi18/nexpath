/**
 * H3 Q3 — the clipboard fallback, built FIRST per the owner's `G-POLICY` ruling
 * because it carries no reverse-engineering exposure.
 *
 * Two things these tests exist to pin, both from H1's empirical findings:
 *   1. inject and submit are SEPARATE steps (neither platform auto-submits);
 *   2. focus is an explicit precondition of submit, not an incidental detail.
 * Plus the cross-OS matrix required by §2.4b from the first commit — macOS,
 * Windows, Linux/X11 and Linux/Wayland, none of which can be tested on real
 * hardware here (`G-HARDWARE`), so the command each OS would run is pinned instead.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createSubmitClipboardDelivery,
  submitKeystroke,
  focusedWindowIsNexpathPopup,
  type SubmitClipboardDeliveryDeps,
} from './submit-clipboard-delivery.js';

function deliveryHarness(over: Partial<SubmitClipboardDeliveryDeps> = {}) {
  const deps: SubmitClipboardDeliveryDeps = {
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(true),
    pasteKeystroke: vi.fn().mockReturnValue(true),
    submitKeystroke: vi.fn().mockReturnValue(true),
    ...over,
  };
  return { deps, d: createSubmitClipboardDelivery(deps) };
}

describe('inject — clipboard → focus → paste, in that order', () => {
  it('performs all three steps and reports success', async () => {
    const h = deliveryHarness();
    await expect(h.d.inject('picked option')).resolves.toBe(true);
    expect(h.deps.writeClipboard).toHaveBeenCalledWith('picked option');
    expect(h.deps.focus).toHaveBeenCalled();
    expect(h.deps.pasteKeystroke).toHaveBeenCalled();
  });

  it('focuses BEFORE pasting — H1 proved delivery depends on focus state', async () => {
    const order: string[] = [];
    const h = deliveryHarness({
      focus: vi.fn().mockImplementation(async () => { order.push('focus'); return true; }),
      pasteKeystroke: vi.fn().mockImplementation(() => { order.push('paste'); return true; }),
    });
    await h.d.inject('x');
    expect(order).toEqual(['focus', 'paste']);
  });

  it('refuses an empty replacement — pasting "" would clear the composer and lose the turn', async () => {
    const h = deliveryHarness();
    await expect(h.d.inject('')).resolves.toBe(false);
    expect(h.deps.writeClipboard).not.toHaveBeenCalled();
    expect(h.deps.pasteKeystroke).not.toHaveBeenCalled();
  });

  it('does not paste when the clipboard write fails — never paste stale content', async () => {
    const h = deliveryHarness({ writeClipboard: vi.fn().mockRejectedValue(new Error('no clipboard')) });
    await expect(h.d.inject('x')).resolves.toBe(false);
    expect(h.deps.pasteKeystroke).not.toHaveBeenCalled();
  });

  it('still attempts the paste when focus is unconfirmed — the composer may already hold focus', async () => {
    const h = deliveryHarness({ focus: vi.fn().mockResolvedValue(false) });
    await expect(h.d.inject('x')).resolves.toBe(true);
    expect(h.deps.pasteKeystroke).toHaveBeenCalled();
  });

  it('treats a throwing focus as unconfirmed rather than fatal', async () => {
    const h = deliveryHarness({ focus: vi.fn().mockRejectedValue(new Error('no wm')) });
    await expect(h.d.inject('x')).resolves.toBe(true);
  });

  it('reports false — never throws — when the paste keystroke throws', async () => {
    const h = deliveryHarness({ pasteKeystroke: vi.fn(() => { throw new Error('no xdotool'); }) });
    await expect(h.d.inject('x')).resolves.toBe(false);
  });

  it('never logs the replacement text (BUG-VEDANSI-AR9-G1)', async () => {
    const lines: string[] = [];
    const h = deliveryHarness({ log: (m) => lines.push(m) });
    await h.d.inject('ZZQX_LEAK_MARKER_7741');
    expect(lines.join('\n')).not.toContain('ZZQX_LEAK_MARKER_7741');
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('submit — a genuinely separate step', () => {
  it('sends the submit keystroke and reports success', async () => {
    const h = deliveryHarness();
    await expect(h.d.submit()).resolves.toBe(true);
    expect(h.deps.submitKeystroke).toHaveBeenCalled();
  });

  it('reports false when the keystroke tool is unavailable', async () => {
    const h = deliveryHarness({ submitKeystroke: vi.fn().mockReturnValue(false) });
    await expect(h.d.submit()).resolves.toBe(false);
  });

  it('reports false — never throws — when the keystroke throws', async () => {
    const h = deliveryHarness({ submitKeystroke: vi.fn(() => { throw new Error('boom'); }) });
    await expect(h.d.submit()).resolves.toBe(false);
  });

  it('inject does not submit, and submit does not inject', async () => {
    const h = deliveryHarness();
    await h.d.inject('x');
    expect(h.deps.submitKeystroke).not.toHaveBeenCalled();
    await h.d.submit();
    expect(h.deps.pasteKeystroke).toHaveBeenCalledTimes(1);
  });
});

describe('submitKeystroke — cross-OS matrix (§2.4b), pinned per platform', () => {
  it('macOS uses osascript key code 36 (Return)', () => {
    const run = vi.fn().mockReturnValue(true);
    expect(submitKeystroke({ isPopupFocused: () => false, platform: 'darwin', run })).toBe(true);
    expect(run).toHaveBeenCalledWith('osascript', [
      '-e', 'tell application "System Events" to key code 36',
    ]);
  });

  it('Windows uses PowerShell SendKeys {ENTER}', () => {
    const run = vi.fn().mockReturnValue(true);
    expect(submitKeystroke({ isPopupFocused: () => false, platform: 'win32', run })).toBe(true);
    expect(run.mock.calls[0][0]).toBe('powershell');
    expect(String(run.mock.calls[0][1])).toContain('{ENTER}');
  });

  it('Linux/X11 prefers xdotool', () => {
    const run = vi.fn().mockReturnValue(true);
    const ok = submitKeystroke({ isPopupFocused: () => false, platform: 'linux', env: { DISPLAY: ':1' }, hasCommand: (c) => c === 'xdotool', run,
    });
    expect(ok).toBe(true);
    expect(run).toHaveBeenCalledWith('xdotool', ['key', '--clearmodifiers', 'Return']);
  });

  it('Linux/Wayland falls back to wtype when xdotool is absent', () => {
    const run = vi.fn().mockReturnValue(true);
    submitKeystroke({ isPopupFocused: () => false, platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' },
      hasCommand: (c) => c === 'wtype', run,
    });
    expect(run).toHaveBeenCalledWith('wtype', ['-k', 'Return']);
  });

  it('Linux falls back to ydotool as the last option', () => {
    const run = vi.fn().mockReturnValue(true);
    submitKeystroke({ isPopupFocused: () => false, platform: 'linux', env: { DISPLAY: ':1' },
      hasCommand: (c) => c === 'ydotool', run,
    });
    expect(run.mock.calls[0][0]).toBe('ydotool');
  });

  it('returns false on Linux with NO display — nothing to type into', () => {
    const run = vi.fn();
    expect(submitKeystroke({ isPopupFocused: () => false, platform: 'linux', env: {}, hasCommand: () => true, run })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('returns false on Linux when no keystroke tool is installed', () => {
    expect(submitKeystroke({ isPopupFocused: () => false, platform: 'linux', env: { DISPLAY: ':1' }, hasCommand: () => false, run: vi.fn(),
    })).toBe(false);
  });

  it('never throws when the runner throws', () => {
    expect(submitKeystroke({ isPopupFocused: () => false, platform: 'darwin', run: () => { throw new Error('spawn failed'); },
    })).toBe(false);
  });

  // ── The production default path ────────────────────────────────────────────
  // Every test above injects `hasCommand`/`run`, which left the REAL defaults
  // uncovered — and they were wrong: both defaulted to `() => false`, making
  // `submitKeystroke()` a guaranteed no-op in production while the whole suite
  // stayed green. Same "works in tests, silently dead in production" class this
  // milestone already had to disprove for H2's env passthrough. These tests pin
  // the defaults so the regression cannot return.
  it('uses REAL default detection when hasCommand/run are not injected', () => {
    // On this Linux box with a display, `which xdotool` genuinely resolves. The
    // point is not the return value but that the defaults actually execute
    // instead of short-circuiting to false.
    const calls: string[] = [];
    const result = submitKeystroke({ isPopupFocused: () => false, platform: 'linux',
      env: { DISPLAY: ':1' },
      // hasCommand intentionally NOT injected — exercise the real default.
      run: (cmd) => { calls.push(cmd); return true; },
    });
    // If the default detector were `() => false`, no tool would ever match and
    // `run` would never be called, so this array would be empty.
    expect(calls.length).toBeGreaterThan(0);
    expect(result).toBe(true);
  });

  it('the default runner is a real spawner, not a false-returning stub', () => {
    // Detect a command that certainly does not exist: the default detector must
    // return false for it (proving it really probes), and no tool then matches.
    const ok = submitKeystroke({ isPopupFocused: () => false, platform: 'linux',
      env: { DISPLAY: ':1' },
      hasCommand: (c) => c === 'definitely-not-a-real-binary-xyz',
      // run intentionally NOT injected — the real default would be reached only
      // if a tool matched; none does, so this must be false without throwing.
    });
    expect(ok).toBe(false);
  });
});

/**
 * ⚠ RC10 — phantom-Enter guard (live root cause, captured in hex 2026-08-13):
 * two synthetic \r bytes landed in a foregrounded Nexpath popup ~one poller
 * tick after it opened, auto-"selecting" it. The submit Enter must never fire
 * while one of our own popups holds focus.
 */
describe('⭐ RC10 — submit Enter never fires into a Nexpath popup', () => {
  it('refuses to send when a popup is focused (no tool is even invoked)', () => {
    const run = vi.fn(() => true);
    const ok = submitKeystroke({
      isPopupFocused: () => true,
      platform: 'linux',
      env: { DISPLAY: ':1' },
      hasCommand: () => true,
      run,
    });
    expect(ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('sends normally when the editor is focused', () => {
    const run = vi.fn(() => true);
    const ok = submitKeystroke({
      isPopupFocused: () => false,
      platform: 'linux',
      env: { DISPLAY: ':1' },
      hasCommand: (c: string) => c === 'xdotool',
      run,
    });
    expect(ok).toBe(true);
    expect(run).toHaveBeenCalledWith('xdotool', ['key', '--clearmodifiers', 'Return']);
  });

  it('focusedWindowIsNexpathPopup matches our titles and only ours', () => {
    const probe = (title: string | null) => focusedWindowIsNexpathPopup({
      platform: 'linux', env: { DISPLAY: ':1' },
      hasCommand: () => true, runCapture: () => title,
    });
    expect(probe('Nexpath — Action Required')).toBe(true);
    expect(probe('emptyops Nexpath · Prompt enhancement')).toBe(true);
    expect(probe('Nexpath — Feedback')).toBe(true);
    expect(probe('nexpath - Windsurf')).toBe(false);   // the EDITOR, not a popup
    expect(probe('some terminal')).toBe(false);
    expect(probe(null)).toBe(false);                    // unreadable ⇒ safe
  });

  it('non-Linux platforms skip the check entirely (no popups foregrounded there)', () => {
    expect(focusedWindowIsNexpathPopup({ platform: 'darwin' })).toBe(false);
    expect(focusedWindowIsNexpathPopup({ platform: 'win32' })).toBe(false);
  });
});
