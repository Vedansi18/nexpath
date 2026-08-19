/**
 * Env-fact trajectory: detect when a project's dev-environment facts CHANGE over time (e.g.
 * version control or a CI pipeline is added later) and emit a `probe`-channel change event that
 * the RIGHT&GOOD aggregator can read as forward movement.
 *
 * Flap damping (S4): a change is confirmed only when the new value is stable across TWO
 * consecutive probes — probes run per session, and an environment that alternates between, say,
 * host and devcontainer would otherwise spam change events. The stored state keeps a `baseline`
 * (the last confirmed values) and a `pending` (the most recent raw probe); a change is confirmed
 * only when the current probe both differs from the baseline AND matches the pending probe.
 *
 * A fact's FIRST observation (no prior baseline value) is initialization, not a movement, and is
 * skipped; an UNKNOWN value (a failed read, per the probe's never-false rule) is never a movement.
 */

import type { Store } from '../store/db.js';
import type { FactMap, FactValue } from './types.js';
import type { Stage } from '../classifier/types.js';
import { probeProject } from './env-probe.js';
import {
  getEnvTrajectory,
  setEnvTrajectory,
  isEnvProbeEnabled,
  type EnvTrajectoryState,
} from '../store/env-facts.js';
import { appendParamEvent, readParamEvents } from '../telemetry/param-events.js';

export type EnvChangeDirection = 'acquired' | 'lost' | 'changed';

/**
 * How far back a movement is still worth STATING in the enhanced prompt. Score credit has its
 * own (aggregation) window; this one is separate on purpose, because the two answer different
 * questions: "should this still count?" and "is this still news?". A change from three months
 * ago is neither news nor wrong — it is simply the project as it stands, and the probe already
 * states that.
 */
export const ENV_CHANGE_GROUNDING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** At most this many movements reach the grounding section — a section of history is not grounding. */
export const ENV_CHANGE_GROUNDING_MAX = 3;

const CHANGE_EVENT_RE = /^env_fact_changed:(.+):(acquired|lost|changed)$/;

/** A confirmed movement, recent enough to state rather than only credit. */
export interface RecentEnvChangeV1 {
  key: string;
  direction: EnvChangeDirection;
  /** The movement as a verb clause: "was acquired", "was removed", "changed to 22". */
  phrase: string;
  ts: number;
}

/**
 * The movements worth stating as project grounding, newest first.
 *
 * ⚠️ Reads BOTH of this module's outputs, and needs both: the emitted events say WHEN a fact
 * moved and in which direction, and the stored baseline says what the value settled on — the
 * event carries only the key and the direction, so "changed" without the baseline could say
 * that something moved but never to what.
 *
 * Consent-gated like every other read of probe-derived state.
 */
export function recentEnvChangesV1(
  store: Store,
  projectRoot: string,
  now: number = Date.now(),
): readonly RecentEnvChangeV1[] {
  if (!isEnvProbeEnabled(store.db)) return [];
  let events;
  try {
    events = readParamEvents(store, projectRoot);
  } catch {
    return []; // the event lane is disk-backed and best-effort — no movements is a valid answer
  }
  const baseline = getEnvTrajectory(store, projectRoot)?.baseline ?? {};

  // One movement per key: a fact that moved twice states where it landed, not its history.
  const newest = new Map<string, { direction: EnvChangeDirection; ts: number }>();
  for (const event of events) {
    const match = CHANGE_EVENT_RE.exec(event.signalKey);
    if (!match) continue;
    if (now - event.ts > ENV_CHANGE_GROUNDING_WINDOW_MS) continue;
    const prior = newest.get(match[1]!);
    if (!prior || event.ts > prior.ts) {
      newest.set(match[1]!, { direction: match[2] as EnvChangeDirection, ts: event.ts });
    }
  }

  return [...newest.entries()]
    .map(([key, { direction, ts }]) => ({ key, direction, ts, phrase: movementPhrase(direction, baseline[key]?.value) }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, ENV_CHANGE_GROUNDING_MAX);
}

/**
 * The verb clause for a movement. A boolean fact reads as a capability arriving or going; a
 * valued fact names what it settled on, and falls back to the bare verb when the baseline has
 * no value to name — never to a value it might not have.
 */
function movementPhrase(direction: EnvChangeDirection, settledValue: FactValue | undefined): string {
  if (direction === 'acquired') return 'was acquired';
  if (direction === 'lost') return 'was removed';
  return settledValue === undefined || settledValue === null || typeof settledValue === 'boolean'
    ? 'changed'
    : `changed to ${String(settledValue)}`;
}

export interface EnvFactChange {
  key: string;
  old: FactValue;
  new: FactValue;
  direction: EnvChangeDirection;
}

function directionOf(newValue: FactValue): EnvChangeDirection {
  if (typeof newValue === 'boolean') return newValue ? 'acquired' : 'lost';
  return 'changed';
}

/**
 * The changes confirmed against the baseline AND stable across the last two probes (S4). A key
 * qualifies only when its current value is real (non-UNKNOWN), differs from a real baseline value
 * (a first observation is skipped), and already matched the previous probe.
 */
export function confirmedEnvChanges(current: FactMap, baseline: FactMap, pending: FactMap): EnvFactChange[] {
  const out: EnvFactChange[] = [];
  for (const key of Object.keys(current)) {
    const cur  = current[key]?.value ?? null;
    const base = baseline[key]?.value ?? null;
    const pend = pending[key]?.value ?? null;
    if (cur === null || base === null) continue; // UNKNOWN or first observation → not a movement
    if (cur === base) continue;                  // unchanged
    if (cur !== pend) continue;                  // not yet stable across two consecutive probes
    out.push({ key, old: base, new: cur, direction: directionOf(cur) });
  }
  return out;
}

export interface TrajectorySessionContext {
  sessionId: string;
  promptIndex: number;
  stage: Stage | null;
  stageConfidence: number | null;
}

/**
 * Probe the project's env facts, confirm any flap-damped changes against the stored baseline,
 * emit one `env_fact_changed` event per confirmed change, and persist the updated baseline + the
 * raw probe. No-op when consent is off or the probe fails. Returns the confirmed changes.
 */
export function recordEnvTrajectory(
  store: Store,
  projectRoot: string,
  session: TrajectorySessionContext,
  now: number = Date.now(),
): EnvFactChange[] {
  if (!isEnvProbeEnabled(store.db)) return [];
  let current: FactMap;
  try {
    current = probeProject(projectRoot, now).facts;
  } catch {
    return []; // a probe failure is non-fatal — skip this session's trajectory
  }

  const prior = getEnvTrajectory(store, projectRoot);
  const baseline = prior?.baseline ?? {};
  const pending  = prior?.pending ?? {};
  const changes = confirmedEnvChanges(current, baseline, pending);

  for (const c of changes) {
    appendParamEvent(store, {
      projectRoot,
      sessionId: session.sessionId,
      promptIndex: session.promptIndex,
      signalKey: `env_fact_changed:${c.key}:${c.direction}`,
      channel: 'probe',
      stage: session.stage,
      stageConfidence: session.stageConfidence,
      source: 'live',
    });
  }

  // The baseline advances only for confirmed changes; the pending is always the latest raw probe.
  // On the first probe (no prior state) the baseline is seeded from the current probe — pure
  // initialization, so the very first values never emit a movement.
  const nextBaseline: FactMap = prior ? { ...baseline } : current;
  for (const c of changes) nextBaseline[c.key] = current[c.key]!;
  setEnvTrajectory(store, projectRoot, { baseline: nextBaseline, pending: current } satisfies EnvTrajectoryState);
  return changes;
}
