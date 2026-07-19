import { describe, expect, it } from 'vitest';
import { combineOptionWithWhyDesc, deliverSelectedPrompt, WHYDESC_DELIVERY_ENABLED } from './whydesc-delivery.js';

describe('whydesc-delivery — combine (Decision 1: plain, no label)', () => {
  it('joins option + why-desc with a blank line', () => {
    expect(combineOptionWithWhyDesc('Write one test.', 'Just the most important behaviour.'))
      .toBe('Write one test.\n\nJust the most important behaviour.');
  });
  it('returns the option unchanged when the why-desc is empty', () => {
    expect(combineOptionWithWhyDesc('Write one test.', '')).toBe('Write one test.');
  });
  it('returns the option unchanged when the why-desc is undefined', () => {
    expect(combineOptionWithWhyDesc('Write one test.', undefined)).toBe('Write one test.');
  });
  it('trims a whitespace-only why-desc to nothing', () => {
    expect(combineOptionWithWhyDesc('Write one test.', '   \n  ')).toBe('Write one test.');
  });
});

describe('whydesc-delivery — gate (Decision 2: OFF until the voice pass is done)', () => {
  it('defaults to OFF', () => {
    expect(WHYDESC_DELIVERY_ENABLED).toBe(false);
  });
  it('delivers the option alone when the gate is OFF', () => {
    expect(deliverSelectedPrompt('Write one test.', 'Just the most important behaviour.', false))
      .toBe('Write one test.');
  });
  it('delivers option + why-desc when the gate is ON', () => {
    expect(deliverSelectedPrompt('Write one test.', 'Just the most important behaviour.', true))
      .toBe('Write one test.\n\nJust the most important behaviour.');
  });
  it('uses the default gate (OFF) — current behaviour is the option alone', () => {
    expect(deliverSelectedPrompt('Write one test.', 'Just the most important behaviour.'))
      .toBe('Write one test.');
  });
});
