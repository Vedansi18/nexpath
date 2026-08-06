import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB4AcceptanceFixturePacketV1,
  runPromptEnhancementB4AcceptanceFixtureV1,
} from './acceptance-fixtures.js';

describe('B4.4 configuration/tweak UI acceptance fixtures', () => {
  it('defines every required local UI-only state fixture without readiness claim', () => {
    const packet = buildPromptEnhancementB4AcceptanceFixturePacketV1();
    expect(packet.packetId).toBe('b4-ui-owner-acceptance-fixtures-v1');
    expect(packet.status).toBe('local_source_backed');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.rows).toHaveLength(11);
    expect(new Set(packet.rows.map((row) => row.fixtureId)).size).toBe(11);
    expect(packet.rows.map((row) => row.kind)).toEqual([
      'enabled', 'disabled', 'unavailable', 'unsupported', 'policy_disabled', 'fallback',
      'malformed', 'stale', 'provider_api_unavailable', 'outside_v1', 'legacy_isolation',
    ]);
  });

  it('passes every expected visible state/event with safe non-interactive output', () => {
    const packet = buildPromptEnhancementB4AcceptanceFixturePacketV1();
    const observations = packet.rows.map(runPromptEnhancementB4AcceptanceFixtureV1);
    expect(observations.every((observation) => observation.passFail === 'pass')).toBe(true);
    expect(observations.every((observation) => observation.observedEvent === 'render_status_only')).toBe(true);
    expect(observations.every((observation) => observation.interactive === false)).toBe(true);
    expect(observations.every((observation) => observation.action === null)).toBe(true);
  });

  it('keeps malformed, stale, provider-unavailable, and outside-v1 states safe', () => {
    const packet = buildPromptEnhancementB4AcceptanceFixturePacketV1();
    const observations = packet.rows.map(runPromptEnhancementB4AcceptanceFixtureV1);
    const byId = new Map(observations.map((observation) => [observation.fixtureId, observation]));
    expect(byId.get('LOCAL-B4.4-07')?.observedStatus).toBe('unavailable');
    expect(byId.get('LOCAL-B4.4-08')?.observedStatus).toBe('fallback');
    expect(byId.get('LOCAL-B4.4-09')?.observedStatus).toBe('unavailable');
    expect(byId.get('LOCAL-B4.4-10')?.observedStatus).toBe('outside_v1');
  });

  it('proves legacy chooser-like values cannot control PE presentation or leak', () => {
    const packet = buildPromptEnhancementB4AcceptanceFixturePacketV1();
    const observation = runPromptEnhancementB4AcceptanceFixtureV1(packet.rows[10]);
    expect(observation.observedStatus).toBe('enabled');
    expect(observation.leakageDetected).toEqual([]);
    expect(observation.passFail).toBe('pass');
  });
});
