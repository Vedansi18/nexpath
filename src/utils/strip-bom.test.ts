/**
 * ⭐ RC48 — the Windows/Cursor BOM blocker (Bhavnesh's 2026-08-23 report).
 * `JSON.parse('\uFEFF{...}')` throws; every hook parser swallowed it as {}.
 */
import { describe, it, expect } from 'vitest';
import { stripBom, headBytesHex } from './strip-bom.js';

describe('⭐ RC48 — stripBom', () => {
  it('strips exactly one leading BOM', () => {
    expect(stripBom('\uFEFF{"a":1}')).toBe('{"a":1}');
  });
  it('leaves clean input untouched (same string)', () => {
    const s = '{"a":1}';
    expect(stripBom(s)).toBe(s);
  });
  it('does not touch an interior BOM (only the lead byte breaks JSON.parse)', () => {
    expect(stripBom('{"a":"\uFEFF"}')).toBe('{"a":"\uFEFF"}');
  });
  it('⭐ the exact failing class now parses: BOM + compact + CRLF', () => {
    expect(() => JSON.parse(stripBom('\uFEFF{"prompt":"hi"}\r\n'))).not.toThrow();
  });
  it('headBytesHex names the BOM on sight', () => {
    expect(headBytesHex('\uFEFF{"a"')).toMatch(/^efbbbf/);
  });
});
