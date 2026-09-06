import { existsSync, readFileSync } from 'node:fs';
import { LOG_PATH } from '../../logger.js';

/**
 * The most recent provider failure the log carries.
 *
 * `stage_classifier_provider_error` is written by `auto` when the classifier's call FAILED —
 * refused, timed out, or never reached the network — as opposed to answering unusably. Until
 * now it was only readable by opening the log, which is exactly what a user with a dead
 * credential does not know to do: guidance simply goes quiet.
 *
 * ⚠️ REPORTED, NOT INTERPRETED — the same rule the emitting site states and for the same
 * reason: which status an exhausted balance returns is not settled for every provider, and
 * naming a cause we have not confirmed would be worse than the silence it replaces. This
 * returns the status and code as written and draws no conclusion from them.
 */
export interface LastProviderFailure {
  /** ISO-8601 timestamp, exactly as the log line carries it. */
  at: string;
  /** HTTP status, when the call reached the network. Absent for a construction failure. */
  status?: number;
  /** The provider's own error code, when it sent one. */
  code?: string;
}

/** The event the emitting site writes (`auto.ts`, the classifier's `onProviderError`). */
export const PROVIDER_FAILURE_EVENT = 'stage_classifier_provider_error';

/**
 * Read the last provider failure out of the log, or `null` when there is none.
 *
 * Never throws: an unreadable, absent or malformed log yields `null`, because a diagnostic
 * that can break `nexpath status` is worse than one that is missing.
 *
 * Line shape (`logger.ts`): `[<iso>] [<LEVEL>] [<command>] <event> <json?>`
 */
export function readLastProviderFailure(logPath: string = LOG_PATH): LastProviderFailure | null {
  let raw: string;
  try {
    if (!existsSync(logPath)) return null;
    raw = readFileSync(logPath, 'utf8');
  } catch {
    return null;
  }

  // Last match wins — the log is append-only, so the last occurrence is the most recent.
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.includes(PROVIDER_FAILURE_EVENT)) continue;

    const at = /^\[([^\]]+)\]/.exec(line)?.[1];
    if (!at) continue;

    // The payload is the remainder after the event name. A line without one is still a
    // failure worth reporting — the timestamp alone answers "when did guidance go quiet".
    const payloadStart = line.indexOf('{', line.indexOf(PROVIDER_FAILURE_EVENT));
    if (payloadStart === -1) return { at };

    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(payloadStart));
    } catch {
      return { at };
    }
    if (!parsed || typeof parsed !== 'object') return { at };

    const data = parsed as Record<string, unknown>;
    return {
      at,
      ...(typeof data['status'] === 'number' ? { status: data['status'] } : {}),
      ...(typeof data['code'] === 'string' ? { code: data['code'] } : {}),
    };
  }
  return null;
}

/**
 * The parenthesised detail for the status line — `(status 401, invalid_api_key)`, or as much
 * of it as the record carries. Empty when it carries neither, which is the construction-
 * failure case: the call never reached a provider, so there is nothing to name.
 */
export function describeProviderFailure(failure: LastProviderFailure): string {
  const parts: string[] = [];
  if (failure.status !== undefined) parts.push(`status ${failure.status}`);
  if (failure.code !== undefined) parts.push(failure.code);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
