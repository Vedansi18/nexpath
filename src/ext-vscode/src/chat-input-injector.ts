import * as vscode from 'vscode';
import type { Host } from './host-detector.js';

/**
 * Chat-input injector (fills the B4 contract from
 * `project_b4_prompt_injection_contract` memory).
 *
 * Each host has an ordered list of candidate `vscode.commands.*` IDs that write
 * text to the AI chat input, with the exact argument shape each expects. The
 * function lists the host's real commands (`getCommands(true)`), then executes
 * the first available candidate; the first that doesn't throw wins.
 *
 * **CORRECTED 2026-08-10 — the previous "Windsurf is VERIFIED" claim was wrong.**
 * It stated the workbench core *registers* `windsurf.sendTextToChat`. Re-checked
 * against the shipped bundle (`/usr/share/windsurf/resources/app/out/vs/workbench/
 * workbench.desktop.main.js`): `windsurf.sendTextToChat` occurs **exactly once**,
 * and only inside a command-ID constants table —
 * `SEND_TEXT_TO_CHAT:{id:"windsurf.sendTextToChat"}` — i.e. an ID *declaration*
 * with no handler. By contrast the mechanisms that genuinely work occur many
 * times: `sendChatActionMessage` ×7 and `addCascadeInput` ×6.
 *
 * This matches `windsurf-autopaste.ts`'s long-standing note that
 * `windsurf.sendTextToChat` is "only a defined ID (no registered handler →
 * `executeCommand` throws)" — **that file was right and this one was stale.**
 * The two files contradicted each other until this correction.
 *
 * Practical effect: `chatInputInject` guards every candidate with an
 * `available.has(c.id)` check (below), so an unregistered id is skipped rather
 * than throwing — the bug was the misleading comment, not the runtime path.
 * **The real Windsurf insert used in production is `injectViaCascadeAction`**
 * (`windsurf-cascade-action.ts` → `windsurf.sendChatActionMessage` +
 * `addCascadeInput`), called from `extension.ts:176` and `extension.ts:491`.
 *
 * Honest limit of this evidence: a string scan of the bundle cannot *prove*
 * absence of a dynamically-registered handler. It is strong evidence
 * (1 occurrence in an id table vs 6–7 for the working commands), not a formal
 * proof; a live `getCommands(true)` check would settle it absolutely.
 *
 * **Cursor candidates are still heuristic** — verify against a live Cursor with
 * `vscode.commands.getCommands(true)` and prune. If nothing matches, the function
 * returns `false` and `handleOptionSelection` falls back to the clipboard path.
 */

interface CommandCandidate {
  id: string;
  /** Build the argument list for `executeCommand(id, ...args)`. */
  args: (text: string) => unknown[];
}

const CURSOR_CANDIDATES: ReadonlyArray<CommandCandidate> = [
  // Candidates that insert into the EXISTING Cursor chat input. We deliberately
  // do NOT include `composer.newChat` (opens a brand-new Agent/Composer tab — the
  // advisory must land in the user's current chat, like Windsurf/CLI) or
  // `workbench.action.chat.open` (VS Code's native chat — a different surface in
  // Cursor). If none of these are registered on the host, the injector returns
  // false and the caller falls back to the clipboard path (text copied for the
  // user to paste into their existing chat — never a new chat).
  { id: 'cursor.aichat.insertWithSelection', args: (t) => [t] },
  { id: 'cursor.composer.focus', args: (t) => [t] },
  { id: 'aichat.insertSelection', args: (t) => [t] },
];

const WINDSURF_CANDIDATES: ReadonlyArray<CommandCandidate> = [
  // Kept ONLY as a forward-compat probe: on today's builds this id has no
  // handler (see the 2026-08-10 correction above), so the availability check
  // skips it. If a future Windsurf registers it, it may start working.
  { id: 'windsurf.sendTextToChat', args: (t) => [t, 'nexpath:advisory'] },
  // ⚠ RC13 (live, 2026-08-13): `windsurf.sendTerminalToChat` REMOVED. It is a
  // registered command, so it passed the availability gate and RESOLVED when
  // called with our text — while inserting NOTHING (it forwards the TERMINAL
  // selection; the text argument is ignored). That made `chatInputInject`
  // return a false-positive `true`: the submit delivery logged "injected
  // directly", auto-submit armed, and the composer was empty. A candidate that
  // can succeed without delivering the text is worse than no candidate.
];

/** Re-export the candidate command IDs for tests that assert against the list. */
export const CANDIDATE_COMMANDS = {
  cursor: CURSOR_CANDIDATES.map((c) => c.id),
  windsurf: WINDSURF_CANDIDATES.map((c) => c.id),
};

export interface ChatInputInjectorDeps {
  /** Inject the host-resolver. Tests pass a fixed host. */
  host?: Host;
  /** Inject the command executor. Tests provide a mock. */
  executeCommand?: (id: string, ...args: unknown[]) => Thenable<unknown>;
  /** Inject the command lister. Tests provide a mock. */
  getCommands?: (filterInternal?: boolean) => Thenable<string[]>;
}

/**
 * Try to inject `text` into the host's AI chat input. Returns `true` if a
 * candidate command executed without throwing. Returns `false` (so
 * `handleOptionSelection` falls back to clipboard) if no candidate succeeded —
 * including when the host is plain VS Code (no AI chat input to inject into).
 */
export async function chatInputInject(
  text: string,
  deps: ChatInputInjectorDeps = {},
): Promise<boolean> {
  const host = deps.host ?? 'vscode-generic';
  if (host === 'vscode-generic') return false;

  const exec =
    deps.executeCommand ??
    ((id: string, ...args: unknown[]) =>
      vscode.commands.executeCommand(id, ...args));
  const list =
    deps.getCommands ??
    ((filter?: boolean) => vscode.commands.getCommands(filter));

  const candidates = host === 'cursor' ? CURSOR_CANDIDATES : WINDSURF_CANDIDATES;

  // Only try commands that actually exist on the current host — avoids
  // wasted "no such command" rejections in the developer console.
  let available: Set<string>;
  try {
    available = new Set(await list(true));
  } catch {
    return false;
  }

  for (const c of candidates) {
    if (!available.has(c.id)) continue;
    try {
      await exec(c.id, ...c.args(text));
      return true;
    } catch {
      // try next
    }
  }
  return false;
}
