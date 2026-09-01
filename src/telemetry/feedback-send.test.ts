import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from '../store/db.js';
import { setConfig } from '../store/config.js';
import { getInstallationId } from './identity.js';
import {
  FEEDBACK_EVENT,
  FEEDBACK_DISMISSED_EVENT,
  FEEDBACK_RATING_EVENTS,
  feedbackRatingEvent,
  sendFeedback,
  sendFeedbackDismissed,
} from './feedback-send.js';
import { FEEDBACK_OPTIONS } from '../decision-session/feedback-popup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLike } from './TelemetryClient.js';
import type { PostHogSingleEnvelope } from './types.js';

interface Captured { url?: string; envelope?: PostHogSingleEnvelope; calls: number }

function okFetch(cap: Captured): FetchLike {
  return async (url, init) => {
    cap.calls++;
    cap.url = url;
    cap.envelope = JSON.parse(init.body) as PostHogSingleEnvelope;
    return { ok: true, status: 200, headers: { get: () => null } };
  };
}
function failFetch(cap: Captured): FetchLike {
  return async () => { cap.calls++; return { ok: false, status: 500, headers: { get: () => null } }; };
}
function rateLimitedFetch(cap: Captured): FetchLike {
  return async () => { cap.calls++; return { ok: false, status: 429, headers: { get: (n) => (n === 'Retry-After' ? '120' : null) } }; };
}
function throwFetch(cap: Captured): FetchLike {
  return async () => { cap.calls++; throw new Error('network down'); };
}

let store: Store;
let cap: Captured;

beforeEach(async () => {
  store = await openStore(':memory:');
  setConfig(store, 'telemetry_sync_api_key', 'phc_test');
  cap = { calls: 0 };
});
afterEach(() => closeStore(store));

describe('sendFeedback', () => {
  it('posts even when telemetry.enabled is false (the crux)', async () => {
    setConfig(store, 'telemetry.enabled', 'false');
    const ok = await sendFeedback(store, 3, { fetch: okFetch(cap) });
    expect(ok).toBe(true);
    expect(cap.calls).toBe(1);
    expect(cap.envelope?.event).toBe(FEEDBACK_EVENT);
    expect(cap.envelope?.properties.rating).toBe(3);
  });

  it('builds a lean payload: rating + feedback timestamp + installation id', async () => {
    await sendFeedback(store, 4, { fetch: okFetch(cap), now: 9_000 });

    const env = cap.envelope!;
    const installId = getInstallationId(store);
    expect(env.distinct_id).toBe(installId);
    expect(env.properties.installation_id).toBe(installId);
    expect(env.properties.rating).toBe(4);
    expect(env.properties.feedback_at).toBe(9_000);
    expect(env.timestamp).toBe(new Date(9_000).toISOString());
  });

  it('does not carry install or advisory context (those are their own events)', async () => {
    await sendFeedback(store, 2, { fetch: okFetch(cap) });
    const keys = Object.keys(cap.envelope!.properties).sort();
    expect(keys).toEqual(['$lib', '$lib_version', 'feedback_at', 'installation_id', 'rating'].sort());
    expect(cap.envelope?.properties.installed_at).toBeUndefined();
    expect(cap.envelope?.properties.advisory_fire_ts).toBeUndefined();
    expect(cap.envelope?.properties.option_select_ts).toBeUndefined();
  });

  it('defaults feedback_at to now when not provided', async () => {
    const before = Date.now();
    await sendFeedback(store, 1, { fetch: okFetch(cap) });
    const fa = cap.envelope?.properties.feedback_at as number;
    expect(fa).toBeGreaterThanOrEqual(before);
    expect(fa).toBeLessThanOrEqual(Date.now());
  });

  it('returns false on an HTTP failure', async () => {
    expect(await sendFeedback(store, 3, { fetch: failFetch(cap) })).toBe(false);
  });

  it('swallows network errors and returns false', async () => {
    expect(await sendFeedback(store, 3, { fetch: throwFetch(cap) })).toBe(false);
  });

  it('returns false and does not post when the api key is empty', async () => {
    setConfig(store, 'telemetry_sync_api_key', '');
    const ok = await sendFeedback(store, 3, { fetch: okFetch(cap) });
    expect(ok).toBe(false);
    expect(cap.calls).toBe(0);
  });

  it('carries the configured api key and PostHog lib metadata', async () => {
    await sendFeedback(store, 2, { fetch: okFetch(cap) });
    expect(cap.envelope?.api_key).toBe('phc_test');
    expect(cap.envelope?.properties.$lib).toBeDefined();
    expect(cap.envelope?.properties.$lib_version).toBeDefined();
  });

  it('posts to the configured endpoint', async () => {
    setConfig(store, 'telemetry_sync_endpoint', 'https://custom.example/capture/');
    await sendFeedback(store, 2, { fetch: okFetch(cap) });
    expect(cap.url).toBe('https://custom.example/capture/');
  });

  it('returns false on a 429 rate-limit', async () => {
    expect(await sendFeedback(store, 3, { fetch: rateLimitedFetch(cap) })).toBe(false);
  });
});

/**
 * The per-option event names against the popup that defines the options.
 *
 * The list in `feedback-send.ts` is a COPY — importing `feedback-popup.ts` from
 * telemetry would close a cycle (it imports `DecisionSession.js`, which imports
 * `telemetry/`). Same problem `submit-hold-budget.ts` has, same answer: keep the
 * copy and pin it here, so a reworded label fails a test instead of silently
 * renaming an event that dashboards are built on.
 */
describe('per-option event names — pinned to FEEDBACK_OPTIONS', () => {
  it('there is exactly one name per option, and no extras', () => {
    expect(Object.keys(FEEDBACK_RATING_EVENTS).map(Number).sort())
      .toEqual(FEEDBACK_OPTIONS.map((o) => o.rating).sort());
  });

  it('⭐ each name is its own label, lowercased', () => {
    for (const opt of FEEDBACK_OPTIONS) {
      expect(feedbackRatingEvent(opt.rating), opt.label)
        .toBe(`feedback_rating_${opt.label.toLowerCase()}`);
    }
  });

  it('the four names are distinct, and none collides with the two existing events', () => {
    const names = Object.values(FEEDBACK_RATING_EVENTS);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain(FEEDBACK_EVENT);
    expect(names).not.toContain(FEEDBACK_DISMISSED_EVENT);
  });

  it('a rating outside the scale has no event', () => {
    for (const r of [0, 5, -1, 1.5, Number.NaN]) {
      expect(feedbackRatingEvent(r), String(r)).toBeUndefined();
    }
  });

  it('⭐ Phase 1 is naming only — nothing sends these yet', () => {
    // The senders arrive in Phase 2 (CLI) and Phase 3 (browser). If this starts
    // failing, a sender landed without the phase that was meant to bring its
    // tests and its documentation with it.
    const src = readFileSync(join(process.cwd(), 'src', 'telemetry', 'feedback-send.ts'), 'utf8');
    // No sender for them yet, and no envelope built from one.
    expect(src).not.toMatch(/export (async )?function sendFeedbackRating/);
    expect(src).not.toMatch(/event: *feedbackRatingEvent/);
    // And nothing calls them from the stop hook.
    const stop = readFileSync(join(process.cwd(), 'src', 'cli', 'commands', 'stop.ts'), 'utf8');
    expect(stop).not.toContain('feedbackRatingEvent');
    expect(stop).not.toContain('FEEDBACK_RATING_EVENTS');
  });
});
