import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockSet } = vi.hoisted(() => ({ mockGet: vi.fn(), mockSet: vi.fn() }));

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: mockGet, set: mockSet } } },
}));

import { PersistentLogAdapter, RECENT_EVENTS_KEY, RECENT_EVENTS_CAP } from './log-persistent.js';
import type { LogPort } from '../../core/ports/log.port.js';

function makeInner(): LogPort & { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function lastWrittenEvents(): Array<{ level: string; key: string; data?: unknown }> {
  const lastCall = mockSet.mock.calls.at(-1)![0] as Record<string, string>;
  return JSON.parse(lastCall[RECENT_EVENTS_KEY]!) as Array<{ level: string; key: string; data?: unknown }>;
}

describe('PersistentLogAdapter', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue({});
    mockSet.mockReset().mockResolvedValue(undefined);
  });

  it('forwards every level to the wrapped adapter unchanged', async () => {
    const inner = makeInner();
    const log = new PersistentLogAdapter(inner);
    log.debug('a', { x: 1 });
    log.info('b');
    log.warn('c', { y: 2 });
    await log.flush();

    expect(inner.debug).toHaveBeenCalledWith('a', { x: 1 });
    expect(inner.info).toHaveBeenCalledWith('b', undefined);
    expect(inner.warn).toHaveBeenCalledWith('c', { y: 2 });
  });

  it('appends events to the storage buffer with level, key, data, and timestamp', async () => {
    const log = new PersistentLogAdapter(makeInner());
    log.debug('prompt_classified', { stage: 'release' });
    await log.flush();

    const events = lastWrittenEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'debug', key: 'prompt_classified', data: { stage: 'release' } });
    expect(typeof (events[0] as { at?: unknown }).at).toBe('number');
  });

  it('serializes same-tick appends so both events land in the buffer in order', async () => {
    // Each get sees whatever the previous chained write stored.
    let stored = '';
    mockGet.mockImplementation(async () => (stored ? { [RECENT_EVENTS_KEY]: stored } : {}));
    mockSet.mockImplementation(async (obj: Record<string, string>) => { stored = obj[RECENT_EVENTS_KEY]!; });

    const log = new PersistentLogAdapter(makeInner());
    log.debug('first');
    log.warn('second');
    await log.flush();

    const events = lastWrittenEvents();
    expect(events.map((e) => e.key)).toEqual(['first', 'second']);
  });

  it('trims the buffer to the cap, dropping the oldest events', async () => {
    const full = Array.from({ length: RECENT_EVENTS_CAP }, (_, i) => ({ at: i, level: 'debug', key: `old-${i}` }));
    mockGet.mockResolvedValue({ [RECENT_EVENTS_KEY]: JSON.stringify(full) });

    const log = new PersistentLogAdapter(makeInner());
    log.debug('newest');
    await log.flush();

    const events = lastWrittenEvents();
    expect(events).toHaveLength(RECENT_EVENTS_CAP);
    expect(events.at(-1)!.key).toBe('newest');
    expect(events[0]!.key).toBe('old-1'); // old-0 dropped
  });

  it('recovers from a corrupted buffer by starting fresh', async () => {
    mockGet.mockResolvedValue({ [RECENT_EVENTS_KEY]: 'not-json{{{' });
    const log = new PersistentLogAdapter(makeInner());
    log.debug('after-corruption');
    await log.flush();

    const events = lastWrittenEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.key).toBe('after-corruption');
  });

  it('never throws when storage itself fails — console logging already happened', async () => {
    mockGet.mockRejectedValue(new Error('storage gone'));
    const inner = makeInner();
    const log = new PersistentLogAdapter(inner);
    log.debug('still-logged');
    await expect(log.flush()).resolves.toBeUndefined();
    expect(inner.debug).toHaveBeenCalledWith('still-logged', undefined);
  });
});
