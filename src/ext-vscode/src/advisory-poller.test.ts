import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdvisoryPoller } from './advisory-poller.js';
import type { StoredAdvisory } from './advisory-store-reader.js';

const advisory = (o: Partial<StoredAdvisory> = {}): StoredAdvisory => ({
  projectRoot: '/proj', stage: 'implementation', flagType: 'stage_transition',
  pinchLabel: 'Quick check.', createdAt: 5000, status: 'pending',
  l1: ['opt'], l2: [], l3: [], ...o,
});

describe('createAdvisoryPoller (windsurf delivery)', () => {
  let onSelection: ReturnType<typeof vi.fn>;
  let onArm: ReturnType<typeof vi.fn>;
  let readAdvisory: ReturnType<typeof vi.fn>;
  let readInjected: ReturnType<typeof vi.fn>;
  let t: number;
  const make = (over = {}) => createAdvisoryPoller({
    projectRoots: ['/proj'], readAdvisory, readInjected, onSelection, onArm,
    graceMs: 6000, now: () => t, setIntervalFn: () => 1, clearIntervalFn: () => {}, ...over,
  });

  beforeEach(() => {
    onSelection = vi.fn(); onArm = vi.fn();
    readAdvisory = vi.fn(); readInjected = vi.fn().mockResolvedValue(null);
    t = 4000;
  });

  it('injects the popup selection and does NOT arm the fallback (popup handled it)', async () => {
    readAdvisory.mockResolvedValue(advisory({ status: 'shown', createdAt: 5000 }));
    readInjected.mockResolvedValue('Run the full test suite.');
    const p = make(); p.start(); t = 7000;
    await p.pollOnce();
    expect(onSelection).toHaveBeenCalledWith('Run the full test suite.');
    expect(onArm).not.toHaveBeenCalled();
  });

  it('does NOT arm while the advisory is still pending (popup not run yet)', async () => {
    readAdvisory.mockResolvedValue(advisory({ status: 'pending', createdAt: 5000 }));
    const p = make(); p.start(); t = 100000;
    await p.pollOnce();
    expect(onArm).not.toHaveBeenCalled();
  });

  it('arms the fallback only after grace once shown + no selection (popup failed)', async () => {
    readAdvisory.mockResolvedValue(advisory({ status: 'shown', createdAt: 5000 }));
    const p = make(); p.start();          // startedAt = 4000
    t = 5000; await p.pollOnce();          // first sees "shown" → grace starts
    expect(onArm).not.toHaveBeenCalled();
    t = 9000; await p.pollOnce();          // 9000-5000 = 4000 < 6000 grace
    expect(onArm).not.toHaveBeenCalled();
    t = 11000; await p.pollOnce();         // 11000-5000 = 6000 ≥ grace → arm
    expect(onArm).toHaveBeenCalledWith('/proj');
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('does NOT arm if the selection arrives within the grace window', async () => {
    readAdvisory.mockResolvedValue(advisory({ status: 'shown', createdAt: 5000 }));
    const p = make(); p.start();
    t = 5000; await p.pollOnce();                       // shown, grace starts, no selection
    readInjected.mockResolvedValue('picked option');    // user selects in the popup
    t = 7000; await p.pollOnce();                       // before grace elapses
    expect(onSelection).toHaveBeenCalledWith('picked option');
    expect(onArm).not.toHaveBeenCalled();
    t = 20000; await p.pollOnce();                       // way past grace — still no arm (handled)
    expect(onArm).not.toHaveBeenCalled();
  });

  it('fires the selection once (dedup), then again after lastInjectedPrompt clears', async () => {
    readAdvisory.mockResolvedValue(advisory({ status: 'shown', createdAt: 5000 }));
    const p = make(); p.start(); t = 6000;
    readInjected.mockResolvedValue('A'); await p.pollOnce();
    await p.pollOnce();                                   // same value → no re-fire
    expect(onSelection).toHaveBeenCalledTimes(1);
    readInjected.mockResolvedValue(null); await p.pollOnce();   // auto cleared it
    readInjected.mockResolvedValue('B'); await p.pollOnce();    // a new selection
    expect(onSelection).toHaveBeenNthCalledWith(2, 'B');
  });

  it('ignores advisories parked before start() (no replay)', async () => {
    readAdvisory.mockResolvedValue(advisory({ status: 'shown', createdAt: 3000 }));
    t = 10000; const p = make(); p.start();   // startedAt = 10000
    t = 30000; await p.pollOnce();
    expect(onArm).not.toHaveBeenCalled();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it('picks the newest advisory across candidate roots', async () => {
    readAdvisory.mockImplementation(async (root: string) =>
      root === '/b' ? advisory({ projectRoot: '/b', status: 'shown', createdAt: 7000 })
                     : advisory({ projectRoot: '/a', status: 'shown', createdAt: 6000 }));
    const p = createAdvisoryPoller({
      projectRoots: ['/a', '/b'], readAdvisory, readInjected, onSelection, onArm,
      graceMs: 0, now: () => t, setIntervalFn: () => 1, clearIntervalFn: () => {},
    });
    p.start(); t = 8000; await p.pollOnce();
    expect(onArm).toHaveBeenCalledWith('/b');
  });

  it('tolerates a reader that rejects for one root', async () => {
    readAdvisory.mockImplementation(async (root: string) => {
      if (root === '/bad') throw new Error('locked');
      return advisory({ projectRoot: root, status: 'shown', createdAt: 9000 });
    });
    const p = createAdvisoryPoller({
      projectRoots: ['/bad', '/good'], readAdvisory, readInjected, onSelection, onArm,
      graceMs: 0, now: () => t, setIntervalFn: () => 1, clearIntervalFn: () => {},
    });
    p.start(); t = 12000; await p.pollOnce();
    expect(onArm).toHaveBeenCalledWith('/good');
  });

  it('start() schedules on the injected timer; stop() clears it; start() is idempotent', () => {
    const setIntervalFn = vi.fn(() => 42); const clearIntervalFn = vi.fn();
    const p = make({ setIntervalFn, clearIntervalFn, intervalMs: 1500 });
    p.start();
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 1500);
    p.start();
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    p.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(42);
  });
});

/**
 * readPeEventMeta — the PE-only-turn selection bridge (owner ruling 2026-08-11,
 * popup-first on Windsurf). A PE-only turn stores NO advisory row, so without
 * this dep the freshness gate never opens and "Use enhanced" never bridges.
 * The dep must widen step 1 ONLY — a PE event must never arm the fallback.
 */
describe('createAdvisoryPoller — PE-event selection bridge', () => {
  let onSelection: ReturnType<typeof vi.fn>;
  let onArm: ReturnType<typeof vi.fn>;
  let readAdvisory: ReturnType<typeof vi.fn>;
  let readInjected: ReturnType<typeof vi.fn>;
  let readPeEventMeta: ReturnType<typeof vi.fn>;
  let t: number;
  const make = (over = {}) => createAdvisoryPoller({
    projectRoots: ['/proj'], readAdvisory, readInjected, onSelection, onArm,
    readPeEventMeta,
    graceMs: 6000, now: () => t, setIntervalFn: () => 1, clearIntervalFn: () => {}, ...over,
  });

  beforeEach(() => {
    onSelection = vi.fn(); onArm = vi.fn();
    readAdvisory = vi.fn().mockResolvedValue(null);
    readInjected = vi.fn().mockResolvedValue(null);
    readPeEventMeta = vi.fn().mockResolvedValue(null);
    t = 4000;
  });

  it('⭐ PE-only turn: fresh PE row opens the gate and the selection bridges', async () => {
    readPeEventMeta.mockResolvedValue({ createdAt: 5000 });
    readInjected.mockResolvedValue('Enhanced body from Use enhanced');
    const p = make(); p.start(); t = 7000;
    await p.pollOnce();
    expect(onSelection).toHaveBeenCalledWith('Enhanced body from Use enhanced');
    expect(onArm).not.toHaveBeenCalled();
  });

  it('⭐ a PE event NEVER arms the fallback — even shown-shaped, far past grace', async () => {
    readPeEventMeta.mockResolvedValue({ createdAt: 5000, status: 'shown' });
    readInjected.mockResolvedValue(null);
    const p = make(); p.start(); t = 100000;
    await p.pollOnce();
    await p.pollOnce();
    expect(onArm).not.toHaveBeenCalled();
  });

  it('a stale PE row (from before start) does not open the gate', async () => {
    readPeEventMeta.mockResolvedValue({ createdAt: 3000 });
    readInjected.mockResolvedValue('stale leftover');
    const p = make(); p.start(); t = 7000;
    await p.pollOnce();
    expect(onSelection).not.toHaveBeenCalled();
    expect(readInjected).not.toHaveBeenCalled();
  });

  it('⭐ with a fresh advisory present, PE meta is not consulted (shipped flow untouched)', async () => {
    readAdvisory.mockResolvedValue(advisory({ status: 'shown', createdAt: 5000 }));
    readInjected.mockResolvedValue('DS selection');
    const p = make(); p.start(); t = 7000;
    await p.pollOnce();
    expect(onSelection).toHaveBeenCalledWith('DS selection');
    expect(readPeEventMeta).not.toHaveBeenCalled();
  });

  it('the same bridged value is not re-injected on the next poll (dedup holds on the PE path)', async () => {
    readPeEventMeta.mockResolvedValue({ createdAt: 5000 });
    readInjected.mockResolvedValue('Enhanced body');
    const p = make(); p.start(); t = 7000;
    await p.pollOnce();
    await p.pollOnce();
    expect(onSelection).toHaveBeenCalledTimes(1);
  });

  it('a throwing readPeEventMeta is treated as no event — no crash, nothing bridged', async () => {
    readPeEventMeta.mockRejectedValue(new Error('db locked'));
    readInjected.mockResolvedValue('x');
    const p = make(); p.start(); t = 7000;
    await expect(p.pollOnce()).resolves.toBeUndefined();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it('multi-root: the newest PE event wins and its root is used for the injected read', async () => {
    readPeEventMeta.mockImplementation(async (root: string) =>
      root === '/b' ? { createdAt: 7000 } : { createdAt: 6000 });
    readInjected.mockResolvedValue('Enhanced from /b');
    const p = make({ projectRoots: ['/a', '/b'] }); p.start(); t = 8000;
    await p.pollOnce();
    expect(readInjected).toHaveBeenCalledWith('/b');
    expect(onSelection).toHaveBeenCalledWith('Enhanced from /b');
  });

  it('absent dep (shipped wiring): a PE-only turn stays un-bridged exactly as before', async () => {
    readInjected.mockResolvedValue('would-be selection');
    const p = make({ readPeEventMeta: undefined }); p.start(); t = 7000;
    await p.pollOnce();
    expect(onSelection).not.toHaveBeenCalled();
    expect(readInjected).not.toHaveBeenCalled();
  });
});
