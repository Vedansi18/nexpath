/**
 * Closed, serializable diagnostic records for error logging.
 *
 * Logging a raw `Error` publishes far more than the message: the stack, every
 * enumerable property an upstream layer attached, and the whole nested `cause`
 * chain — any of which can carry a delivered prompt body or the user's prompt
 * text. The delivery channel (`nexpath stop` stdout → `{decision:'block',
 * reason:<body>}`) is delivery-only; its contents must never reach a log,
 * telemetry event, or error payload.
 *
 * So diagnostics are built here into a fixed, closed shape. Nothing is copied
 * from the error except a small allowlist, and the `cause` chain is counted
 * rather than serialized so its removal is visible instead of silent.
 */

/** Fixed-shape, always-serializable description of a caught error. */
export interface SafeErrorRecord {
  /** Constructor name, e.g. `NexpathMalformedPayloadError`. */
  name: string;
  /** The error's own message. Never the stack, never a cause message. */
  message: string;
  /** Node errno-style code (`ENOENT`, …) when present — a fixed vocabulary. */
  code?: string;
  /** Number of `cause` links stripped. Non-zero means detail was dropped. */
  causeChainDepth: number;
}

/** Depth cap — also terminates a self-referential `cause` chain. */
const MAX_CAUSE_DEPTH = 16;

/** `String(x)` can itself throw if `toString` is hostile. */
function safeStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unstringifiable value]';
  }
}

function causeChainDepth(err: Error): number {
  let depth = 0;
  let current: unknown = (err as { cause?: unknown }).cause;
  const seen = new Set<unknown>([err]);

  while (current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH) {
    if (seen.has(current)) break;
    seen.add(current);
    depth += 1;
    current = (current as { cause?: unknown }).cause;
  }
  return depth;
}

/**
 * Reduce any thrown value to a closed record safe to log.
 *
 * Note on `message`: it is kept because it is the diagnostic's whole value, and
 * the extension already surfaced it in the Output channel. That places a duty
 * on error *constructors* not to embed payload in their messages — which is why
 * `NexpathMalformedPayloadError` was changed to a redacted shape at its source.
 */
export function toSafeErrorRecord(err: unknown): SafeErrorRecord {
  if (!(err instanceof Error)) {
    return { name: 'NonError', message: safeStringify(err), causeChainDepth: 0 };
  }

  const rawCode = (err as { code?: unknown }).code;

  return {
    name: err.name,
    message: safeStringify(err.message),
    ...(typeof rawCode === 'string' ? { code: rawCode } : {}),
    causeChainDepth: causeChainDepth(err),
  };
}
