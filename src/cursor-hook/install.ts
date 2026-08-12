/**
 * `.cursor/hooks.json` writer (hook milestone H5).
 *
 * Mirrors `windsurf-hook/install.ts`'s **proven** shape rather than inventing a
 * second one: idempotent, preserves other tools' hooks, identifies our own
 * entries by a command substring, and writes **no marker field**. That writer is
 * already shipping and has survived real installs; the failure modes it handles
 * (stale entries from an older install, a hand-edited file, an event left empty)
 * are the same ones here.
 *
 * ── ⚠ R4: `timeout` IS WRITTEN IN SECONDS ────────────────────────────────────
 * Cursor multiplies the value by 1000 internally — a measured finding, not a
 * guess: `"timeout": 180000` was logged as `180000000ms`. Writing milliseconds
 * here would produce a timeout ~1000x too long, so a hung hook would appear to
 * hang forever. The constant therefore carries the unit **in its name**, and a
 * test pins the emitted number.
 *
 * ── ⚠ R3: NEVER RELY ON CURSOR'S DEFAULT TIMEOUT ─────────────────────────────
 * The default is 60 s and is a **silent fail-open cliff** — a hook that exceeds
 * it is simply abandoned, with no error surfaced. H4's hold budget is 60–90 s, so
 * the default could fire *while we are legitimately holding the prompt*. We
 * therefore write an explicit timeout comfortably above H4's ceiling.
 *
 * ── `failClosed` STAYS AT ITS DEFAULT (`false`) ───────────────────────────────
 * Amendment `A3`, now evidence-backed: fail-open is the observed behaviour, and a
 * failure while holding the user's prompt is strictly worse than no advisory. We
 * do not write the field at all — writing `false` explicitly would imply we had
 * a reason to override something.
 *
 * ── CONFIG LOCATIONS ─────────────────────────────────────────────────────────
 * Cursor merges three paths (measured; its service logs each at startup):
 * `<project>/.cursor/hooks.json`, `~/.cursor/hooks.json`, and enterprise
 * `/etc/cursor/hooks.json`. We only ever write the first two — the enterprise
 * path is not ours to touch.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setSubmitFlowFlag } from '../cli/commands/submit-flow-config.js';

/**
 * Hook timeout in SECONDS. **The unit is in the name deliberately (`R4`).**
 *
 * 120 s sits above H4's 60–90 s hold budget with headroom, so Cursor never reaps
 * us while we are legitimately holding a prompt (`R3`), and well under anything a
 * user would call hung.
 */
export const CURSOR_HOOK_TIMEOUT_SECONDS = 120;

/**
 * The events we register.
 *
 * **Only `beforeSubmitPrompt` is listed, because only it is EVIDENCED.** The
 * analysis §4.1 measured it directly (default timeout logged verbatim, fail-open
 * at 60.002 s, orphaned process, `continue:false` blocks). No post-response
 * Cursor event name has been measured — Windsurf's `post_cascade_response` has no
 * confirmed Cursor counterpart in our evidence.
 *
 * An invented event name would be written into a real user's config and silently
 * never fire, so the post-response event stays **unregistered until the live
 * `getCommands`/hook sweep names it**. The array is iterated everywhere, so
 * adding it later is a one-line change.
 */
export const CURSOR_HOOK_EVENTS = ['beforeSubmitPrompt'] as const;
export type CursorHookEvent = (typeof CURSOR_HOOK_EVENTS)[number];

export interface CursorHookEntry {
  command: string;
  timeout?: number;
}

/** `<home>/.cursor/hooks.json` — the user-level config. */
export function getCursorUserHooksPath(home: string): string {
  return join(home, '.cursor', 'hooks.json');
}

/** `<project>/.cursor/hooks.json` — the project-level config. */
export function getCursorProjectHooksPath(projectRoot: string): string {
  return join(projectRoot, '.cursor', 'hooks.json');
}

/** The command string nexpath writes for a given event. */
export function buildCursorHookCommand(cliPath: string, event: CursorHookEvent): string {
  return `node ${JSON.stringify(cliPath)} cursor-hook ${event}`;
}

/**
 * True if an entry is one nexpath wrote.
 *
 * Identified by the `cursor-hook` command substring — **no marker field**, same
 * as the Windsurf writer. A marker key would be a second source of truth that a
 * hand-edit could desynchronise from the command it is supposed to describe.
 */
export function isNexpathCursorHook(entry: CursorHookEntry): boolean {
  return typeof entry?.command === 'string' && entry.command.includes('cursor-hook');
}

/** Build one entry, with the explicit seconds timeout (`R3`/`R4`). */
export function buildCursorHookEntry(cliPath: string, event: CursorHookEvent): CursorHookEntry {
  return {
    command: buildCursorHookCommand(cliPath, event),
    // SECONDS. See CURSOR_HOOK_TIMEOUT_SECONDS.
    timeout: CURSOR_HOOK_TIMEOUT_SECONDS,
    // `failClosed` deliberately omitted — see the file header.
  };
}

export function buildCursorHooksConfig(cliPath: string): Record<CursorHookEvent, CursorHookEntry[]> {
  return {
    beforeSubmitPrompt: [buildCursorHookEntry(cliPath, 'beforeSubmitPrompt')],
  };
}

function readJsonSafe(filePath: string): Record<string, unknown> {
  try {
    if (!existsSync(filePath)) return {};
    const txt = readFileSync(filePath, 'utf8').trim();
    if (!txt) return {};
    const v: unknown = JSON.parse(txt);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    // A malformed file must not crash `nexpath install`; we rewrite it rather
    // than abort, exactly as the Windsurf writer does.
    return {};
  }
}

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Write nexpath's hooks into `.cursor/hooks.json`, preserving other tools' hooks
 * and replacing any prior nexpath entries (idempotent).
 */
export function writeCursorHooks(filePath: string, cliPath: string): void {
  const data = readJsonSafe(filePath);
  const hooks = (data.hooks && typeof data.hooks === 'object' ? data.hooks : {}) as Record<string, CursorHookEntry[]>;
  const cfg = buildCursorHooksConfig(cliPath) as Record<string, CursorHookEntry[]>;
  // Iterate ALL events so a stale entry from an older install is dropped even if
  // we no longer write that event today.
  for (const event of CURSOR_HOOK_EVENTS) {
    const kept = Array.isArray(hooks[event]) ? hooks[event].filter((h) => !isNexpathCursorHook(h)) : [];
    const merged = [...kept, ...(cfg[event] ?? [])];
    if (merged.length === 0) delete hooks[event];
    else hooks[event] = merged;
  }
  data.hooks = hooks;
  writeJson(filePath, data);
  // Owner ruling 2026-08-12: ship the new submit-flow ON via the config-backed
  // flag (`~/.nexpath/submit-flow.json`), read by both the hook and the
  // extension. Registering the Cursor hook enables Cursor's new flow; flip the
  // flag (or set the env var to '0') to revert. Best-effort; never breaks install.
  try { setSubmitFlowFlag('cursor', true); } catch { /* best-effort */ }
}

/**
 * Remove nexpath's hooks; preserve everything else. Returns true if anything of
 * ours was removed.
 */
export function removeCursorHooks(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const data = readJsonSafe(filePath);
  const hooks = data.hooks && typeof data.hooks === 'object' ? (data.hooks as Record<string, CursorHookEntry[]>) : null;
  if (!hooks) return false;
  let removed = false;
  for (const event of CURSOR_HOOK_EVENTS) {
    if (Array.isArray(hooks[event])) {
      const before = hooks[event].length;
      const kept = hooks[event].filter((h) => !isNexpathCursorHook(h));
      if (kept.length !== before) removed = true;
      if (kept.length === 0) delete hooks[event];
      else hooks[event] = kept;
    }
  }
  data.hooks = hooks;
  writeJson(filePath, data);
  return removed;
}
