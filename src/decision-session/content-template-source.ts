/**
 * Content-template SOURCE lookup — the migrated-signal side of the §6.1 dual-source
 * resolver. Bridges a signalType to a source-cascade `RecordCandidateLookup` that the
 * content-template engine (`resolveRecord` / `composeAdvisory`) walks.
 *
 * Only the `shipped` tier is populated today (the 136 shipped preset records). The
 * `uploaded` / `autogen` / `default` tiers return undefined — per-user and
 * closest-default records are later phases (upload / AR-6 §4.E7). When no shipped
 * record exists for a signalType, every tier is undefined → the engine resolves
 * `null` → the live caller falls back to the static set (safe, no blank advisory).
 */

import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import type { RecordCandidateLookup } from './content-template-engine.js';
import type { ContentTemplateRecord } from './content-template-schema.js';

/** signalType → shipped content-template record (O(1) index over the shipped presets). */
const SHIPPED_BY_SIGNAL: ReadonlyMap<string, ContentTemplateRecord> = new Map(
  SHIPPED_CONTENT_TEMPLATES.map((r) => [r.signalType, r]),
);

/** True when a shipped content-template record exists for the signalType. */
export function hasShippedRecord(signalType: string): boolean {
  return SHIPPED_BY_SIGNAL.has(signalType);
}

/**
 * The content-template record signalType for a fired flagType, via the
 * `ABSENCE_<UPPER(key)>` convention (§6.1 item 10c coverage-map). Returns undefined for a
 * non-absence flagType (stage transitions etc. have no content-template mapping today).
 */
export function recordSignalTypeForFlag(flagType: string): string | undefined {
  return flagType.startsWith('absence:')
    ? `ABSENCE_${flagType.slice('absence:'.length).toUpperCase()}`
    : undefined;
}

/**
 * A source-cascade lookup for one signalType: the `shipped` tier yields that signal's
 * shipped record; the other tiers yield undefined (no per-user / closest-default
 * records ship yet). Handed to the engine's `resolveRecord` / `composeAdvisory`.
 */
export function shippedRecordLookup(signalType: string): RecordCandidateLookup {
  return (source) => (source === 'shipped' ? SHIPPED_BY_SIGNAL.get(signalType) : undefined);
}
