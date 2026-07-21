import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from '../store/db.js';
import { setConfig } from '../store/config.js';
import { isTelemetryEnabled } from './telemetry-enabled.js';

let store: Store;
beforeEach(async () => { store = await openStore(':memory:'); });
afterEach(() => closeStore(store));

describe('isTelemetryEnabled', () => {
  it('defaults to true when unset', () => {
    expect(isTelemetryEnabled(store)).toBe(true);
  });

  it('is false only when explicitly set to "false"', () => {
    setConfig(store, 'telemetry.enabled', 'false');
    expect(isTelemetryEnabled(store)).toBe(false);
  });

  it('is true when set to "true"', () => {
    setConfig(store, 'telemetry.enabled', 'true');
    expect(isTelemetryEnabled(store)).toBe(true);
  });
});
