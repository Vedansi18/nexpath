import { describe, it, expect, vi } from 'vitest';
import { BrowserClockAdapter } from './clock-browser.js';

describe('BrowserClockAdapter', () => {
  it('returns Date.now()', () => {
    const fixed = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(fixed);

    const clock = new BrowserClockAdapter();
    expect(clock.now()).toBe(fixed);
  });

  it('returns a number', () => {
    const clock = new BrowserClockAdapter();
    expect(typeof clock.now()).toBe('number');
  });
});
