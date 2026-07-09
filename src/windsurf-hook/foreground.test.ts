import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bringPopupToFront } from './foreground.js';

// Must match the titles the helper duplicates (Layer C TtySelectFn / feedback-tty).
const ADVISORY_TITLE = 'Nexpath — Action Required';
const FEEDBACK_TITLE = 'Nexpath — Feedback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(opts: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  tools?: string[];
  activateSucceedsOnTry?: number;
  maxTries?: number;
}): { calls: () => number } {
  const tools = new Set(opts.tools ?? []);
  let activateCalls = 0;
  bringPopupToFront({
    platform: opts.platform ?? 'linux',
    env: opts.env ?? { DISPLAY: ':0' },
    hasCommand: (c) => tools.has(c),
    activate: () => {
      activateCalls += 1;
      return opts.activateSucceedsOnTry ? activateCalls >= opts.activateSucceedsOnTry : false;
    },
    intervalMs: 500,
    maxTries: opts.maxTries ?? 12,
  });
  return { calls: () => activateCalls };
}

describe('bringPopupToFront (windsurf-hook)', () => {
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

  it('stops as soon as activation succeeds', () => {
    const h = setup({ tools: ['wmctrl'], activateSucceedsOnTry: 1 });
    vi.advanceTimersByTime(10_000);
    expect(h.calls()).toBe(1);
  });

  it('raises the FEEDBACK popup when only the feedback window exists', () => {
    const attempted: string[] = [];
    let raised: string | null = null;
    bringPopupToFront({
      platform: 'linux', env: { DISPLAY: ':0' }, hasCommand: () => true,
      activate: (_tool, title) => {
        attempted.push(title);
        if (title === FEEDBACK_TITLE) { raised = title; return true; }
        return false; // advisory window not present this turn
      },
      intervalMs: 500, maxTries: 12,
    });
    vi.advanceTimersByTime(10_000);
    expect(raised).toBe(FEEDBACK_TITLE);
    expect(attempted).toEqual([ADVISORY_TITLE, FEEDBACK_TITLE]); // advisory tried first, then feedback
  });

  it('still raises the ADVISORY popup when the advisory window exists (regression)', () => {
    const attempted: string[] = [];
    let raised: string | null = null;
    bringPopupToFront({
      platform: 'linux', env: { DISPLAY: ':0' }, hasCommand: () => true,
      activate: (_tool, title) => {
        attempted.push(title);
        if (title === ADVISORY_TITLE) { raised = title; return true; }
        return false;
      },
      intervalMs: 500, maxTries: 12,
    });
    vi.advanceTimersByTime(10_000);
    expect(raised).toBe(ADVISORY_TITLE);
    expect(attempted).toEqual([ADVISORY_TITLE]); // short-circuit — feedback not attempted
  });
});
