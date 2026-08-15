/**
 * Cursor `beforeSubmitPrompt` payload parsing (hook milestone H5).
 *
 * ── REUSE, NOT REIMPLEMENTATION ──────────────────────────────────────────────
 * The measured Cursor payload is:
 *   { prompt, session_id, hook_event_name, cursor_version, workspace_roots,
 *     user_email, transcript_path }
 *
 * **Two of the three fields we need map by identical key name** to Claude's:
 * `prompt` and `transcript_path`. So `parseAutoHookPayload` (`auto.ts:513`) is
 * **reused verbatim** for those rather than a second parser being written.
 *
 * `auto.ts` is NOT Vedansi-owned (`bhavnesh75` 35 / `harshil480` 28 /
 * `hi0001234d` 23) — it is **imported and consumed here, never modified**.
 *
 * This module adds only what Cursor has and Claude does not:
 *   - `composer_mode` **alongside** the existing `permission_mode` (not instead
 *     of it — a Cursor payload may carry either, and `parseAutoHookPayload`
 *     already handles `permission_mode`)
 *   - `workspace_roots[0]` as the project root, which Claude's payload lacks
 *     entirely (it is resolved separately there). Free here — no DB or cwd lookup.
 *
 * ── ⚠ §4.3 — `user_email` MUST NEVER BE LOGGED ───────────────────────────────
 * Cursor's payload carries the user's email address. It is **not** copied into
 * the parsed result at all, so no downstream logger can reach it even by
 * accident — the safest form of redaction is not having the value. A test pins
 * that neither the parsed object nor the debug description ever contains it.
 */
import { parseAutoHookPayload } from '../cli/commands/auto.js';

export interface CursorHookPayload {
  /** Trimmed prompt text, or undefined when absent/blank. */
  promptText?: string;
  /**
   * Agent mode. Cursor reports `composer_mode`; Claude reports
   * `permission_mode`. Whichever is present wins, `composer_mode` first, since
   * on a Cursor payload it is the more specific field.
   */
  currentAgentMode?: string;
  /** Session transcript path — identical key name across both platforms. */
  transcriptPath?: string;
  /** From `workspace_roots[0]`. Claude's payload has no equivalent. */
  projectRoot?: string;
  /** Cursor's own session id, used only for correlation. Never a prompt. */
  sessionId?: string;
}

/**
 * Parse a Cursor hook payload.
 *
 * Never throws and never rejects: malformed JSON yields an empty object, exactly
 * as `parseAutoHookPayload` does, because a hook must not break the host.
 *
 * **`user_email` is deliberately never read.**
 */
export function parseCursorHookPayload(raw: string): CursorHookPayload {
  // Reused verbatim for `prompt` + `transcript_path` (identical key names).
  const base = parseAutoHookPayload(raw);

  let extra: {
    composer_mode?: unknown;
    workspace_roots?: unknown;
    session_id?: unknown;
  } = {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') extra = v as typeof extra;
  } catch {
    // Malformed JSON: `base` is already empty, so fall through with no extras.
    return {};
  }

  const roots = Array.isArray(extra.workspace_roots) ? extra.workspace_roots : [];
  const firstRoot = roots.find((r): r is string => typeof r === 'string' && r.length > 0);

  return {
    promptText: base.promptText,
    // composer_mode first: on a Cursor payload it is the more specific field,
    // but permission_mode is still honoured so one parser serves both shapes.
    currentAgentMode:
      typeof extra.composer_mode === 'string' && extra.composer_mode.length > 0
        ? extra.composer_mode
        : base.currentAgentMode,
    transcriptPath: base.transcriptPath,
    projectRoot: firstRoot,
    sessionId: typeof extra.session_id === 'string' ? extra.session_id : undefined,
    // user_email intentionally absent — see the file header (§4.3).
  };
}

/**
 * A log-safe description of a parsed payload.
 *
 * Reports **lengths and presence, never content**: the prompt is user data and
 * `user_email` is PII. Anything added here must keep that property.
 */
export function describeCursorPayloadSafely(p: CursorHookPayload): {
  promptLength: number;
  hasTranscript: boolean;
  hasProjectRoot: boolean;
  agentMode?: string;
} {
  return {
    promptLength: p.promptText?.length ?? 0,
    hasTranscript: Boolean(p.transcriptPath),
    hasProjectRoot: Boolean(p.projectRoot),
    agentMode: p.currentAgentMode,
  };
}
