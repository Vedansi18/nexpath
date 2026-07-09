import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bringPopupToFront, POPUP_WINDOW_TITLE, FEEDBACK_WINDOW_TITLE } from './popup-foreground.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Kick off bringPopupToFront with real (faked) timers + injected env/tools. */
function setup(opts: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  tools?: string[];                 // which of wmctrl/xdotool are "installed"
  activateSucceedsOnTry?: number;   // 1-based try on which activate returns true
  maxTries?: number;
}): { calls: () => number; tool: () => string | null } {
  const tools = new Set(opts.tools ?? []);
  let activateCalls = 0;
  let usedTool: string | null = null;

  bringPopupToFront({
    platform: opts.platform ?? 'linux',
    env: opts.env ?? { DISPLAY: ':0' },
    hasCommand: (c) => tools.has(c),
    activate: (tool) => {
      usedTool = tool;
      activateCalls += 1;
      return opts.activateSucceedsOnTry ? activateCalls >= opts.activateSucceedsOnTry : false;
    },
    intervalMs: 500,
    maxTries: opts.maxTries ?? 12,
  });

  return { calls: () => activateCalls, tool: () => usedTool };
}

describe('bringPopupToFront', () => {
  it('exports the title Layer C gives the popup window', () => {
    expect(POPUP_WINDOW_TITLE).toBe('Nexpath — Action Required');
  });

  it('no-ops on macOS (already foregrounds at launch)', () => {
    const h = setup({ platform: 'darwin', tools: ['wmctrl'] });
    vi.advanceTimersByTime(10_000);
    expect(h.calls()).toBe(0);
  });

  it('no-ops on Windows (already foregrounds at launch)', () => {
    const h = setup({ platform: 'win32', tools: ['wmctrl'] });
    vi.advanceTimersByTime(10_000);
    expect(h.calls()).toBe(0);
  });

  it('no-ops on Linux with no display', () => {
    const h = setup({ env: {}, tools: ['wmctrl'] });
    vi.advanceTimersByTime(10_000);
    expect(h.calls()).toBe(0);
  });

  it('no-ops gracefully when neither wmctrl nor xdotool is installed', () => {
    const h = setup({ tools: [] });
    vi.advanceTimersByTime(10_000);
    expect(h.calls()).toBe(0);
  });

  it('uses wmctrl when present and stops as soon as activation succeeds', () => {
    const h = setup({ tools: ['wmctrl', 'xdotool'], activateSucceedsOnTry: 3 });
    vi.advanceTimersByTime(10_000);
    expect(h.tool()).toBe('wmctrl');   // wmctrl preferred over xdotool
    expect(h.calls()).toBe(3);         // stopped on success, not all 12 tries
  });

  it('falls back to xdotool when wmctrl is absent', () => {
    const h = setup({ tools: ['xdotool'], activateSucceedsOnTry: 1 });
    vi.advanceTimersByTime(10_000);
    expect(h.tool()).toBe('xdotool');
    expect(h.calls()).toBe(1);
  });

  it('gives up after maxTries when activation never succeeds', () => {
    const h = setup({ tools: ['wmctrl'], maxTries: 5 }); // never succeeds
    vi.advanceTimersByTime(10_000);
    // 2 titles (advisory + feedback) attempted per tick × 5 ticks = 10 calls.
    expect(h.calls()).toBe(10);
  });

  it('tries to raise BOTH the advisory and the feedback popup titles', () => {
    const titles: string[] = [];
    bringPopupToFront({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      hasCommand: () => true,
      activate: (_tool, title) => { titles.push(title); return false; }, // never succeeds → tries both
      intervalMs: 500,
      maxTries: 1,
    });
    vi.advanceTimersByTime(1_000);
    expect(titles).toContain(POPUP_WINDOW_TITLE);
    expect(titles).toContain(FEEDBACK_WINDOW_TITLE);
  });

  // ── Requirement: raise WHICHEVER popup is open (advisory OR feedback) ──────────

  it('raises the FEEDBACK popup when only the feedback window exists', () => {
    const attempted: string[] = [];
    let raised: string | null = null;
    bringPopupToFront({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      hasCommand: () => true,
      activate: (_tool, title) => {
        attempted.push(title);
        if (title === FEEDBACK_WINDOW_TITLE) { raised = title; return true; }
        return false; // advisory window not present this turn
      },
      intervalMs: 500,
      maxTries: 12,
    });
    vi.advanceTimersByTime(10_000);
    expect(raised).toBe(FEEDBACK_WINDOW_TITLE);        // the feedback popup was raised
    expect(attempted).toEqual([POPUP_WINDOW_TITLE, FEEDBACK_WINDOW_TITLE]); // advisory tried first, then feedback → stopped
  });

  it('still raises the ADVISORY popup when the advisory window exists (regression)', () => {
    const attempted: string[] = [];
    let raised: string | null = null;
    bringPopupToFront({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      hasCommand: () => true,
      activate: (_tool, title) => {
        attempted.push(title);
        if (title === POPUP_WINDOW_TITLE) { raised = title; return true; }
        return false;
      },
      intervalMs: 500,
      maxTries: 12,
    });
    vi.advanceTimersByTime(10_000);
    expect(raised).toBe(POPUP_WINDOW_TITLE);           // advisory still foregrounded
    expect(attempted).toEqual([POPUP_WINDOW_TITLE]);   // advisory found first → feedback not attempted (short-circuit)
  });

  it('honours WAYLAND_DISPLAY as a valid display', () => {
    const h = setup({ env: { WAYLAND_DISPLAY: 'wayland-0' }, tools: ['wmctrl'], activateSucceedsOnTry: 1 });
    vi.advanceTimersByTime(10_000);
    expect(h.calls()).toBe(1);
  });
});
