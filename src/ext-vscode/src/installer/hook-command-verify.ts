/**
 * RC26 (Windows/Cursor tester, 2026-08-19): does a hooks.json file's
 * registered command reflect what THIS build would currently write, not just
 * "something plausible was written once"?
 *
 * ── THE FAILURE THIS EXISTS FOR ───────────────────────────────────────────
 * A "watcher event" (independent DB polling) fired repeatedly on the tester's
 * machine — real prompts were being typed and sent — but NOT ONE
 * `submit handoff:` line ever appeared, meaning Cursor's `beforeSubmitPrompt`
 * hook never actually ran, though the flag was armed and the file said
 * "already set up". Root cause: `verifyHookRegistration` was SHAPE-BLIND —
 * `t.includes('cursor-hook') && t.includes('"version"')` — so a hooks.json
 * first written by an install that predates a hook-command fix (e.g. RC25's
 * move off a bare `node`, which silently ENOENTs under a sanitized
 * hook-spawn PATH — the exact class RC21 already proved real on Windows) is
 * judged "registered" FOREVER: the self-heal this milestone built
 * (RC7/RC19b) can only run when the check returns false, so a stale command
 * was invisible to it and NEVER got the fix.
 *
 * Kept in its own pure file (no `vscode` import) so it is directly unit
 * testable with real JSON content, matching this codebase's existing
 * separation of pure logic modules (`cli-stage.ts`, `setup-flow.ts`) from
 * `vscode-glue.ts`'s "thin glue" role — and so `src/ext-vscode`'s own suite
 * can exercise it without touching the extension host.
 *
 * Cannot import `buildCursorHookCommand`/`buildWindsurfHookCommand` to
 * compare byte-for-byte — `src/ext-vscode` is a separate package and cannot
 * import `src/cursor-hook`/`src/windsurf-hook` (the same `rootDir`/TS6059
 * wall as every other cross-package boundary in this codebase, `G-ROOTDIR`).
 * Instead of duplicating the full command builder (a second source of truth
 * that could itself drift), this checks the two properties that actually
 * matter and are stable across any future change to the command's exact
 * shape:
 *
 *   1. QUOTED — every command this project ever writes puts the node binary
 *      in a JSON-stringified (i.e. quote-wrapped) first token: Cursor's
 *      `buildCursorHookCommand` and Windsurf's `buildWindsurfHookCommand`/
 *      `buildWindsurfHookPowershell` all do this. A raw JSON.parse of the
 *      file hands back the fully decoded string, so checking the prefix
 *      reliably tells "quoted absolute path" apart from a bare `node ` (the
 *      RC21/RC25 failure class: ENOENTs silently, ZERO invocations, nothing
 *      surfaces anywhere).
 *   2. CURRENT — the decoded command text contains `cliEntry` (the CLI path
 *      THIS activation just staged). A file written before a version bump or
 *      an RC20 re-stage would reference the OLD path; substring containment
 *      catches that without needing OS-specific path normalization, because
 *      both sides come from the same `resolve()`/`join()` convention already
 *      used throughout this codebase.
 *
 * ── THE `field`/`quotedPrefix` PARAMETERS ─────────────────────────────────
 * Which field to read and what a correctly-quoted command must start with
 * differ by field, not just by host, so they cannot be one hardcoded
 * constant:
 *   - Cursor's `command`, and Windsurf's bash `command`, both start
 *     `"<node>" …` (`buildCursorHookCommand` / `buildWindsurfHookCommand`).
 *   - Windsurf's `powershell` starts `& "<node>" …` — the leading `&` is
 *     PowerShell's call operator, REQUIRED for a quoted path to execute at
 *     all (`buildWindsurfHookPowershell`'s own header explains why).
 * Getting this wrong would compare a forward-slashed bash `command` string
 * (Windsurf's builder normalises separators for bash) against a
 * native-Windows `cliEntry` and never match ANYTHING on Windows — a false
 * "unregistered" that would loop the setup terminal forever. So the caller
 * names the exact field for its platform instead of scanning both and
 * hoping.
 *
 * Returns `false` on any parse/shape failure — unregistered, so the caller's
 * self-heal repairs it. That is the opposite of `vscode-glue.ts`'s other
 * fail-quiet catches (which guard against a transient fs error looping the
 * setup terminal on every activation); this function is reached only after
 * the caller already confirmed the file exists, so a failure here means the
 * content itself doesn't hold up — exactly the condition that must trigger a
 * repair.
 */
export function verifyCommandCurrent(
  raw: string,
  marker: 'cursor-hook' | 'windsurf-hook',
  cliEntry: string,
  field: 'command' | 'powershell',
  quotedPrefix: '"' | '& "',
): boolean {
  try {
    const data = JSON.parse(raw) as { hooks?: Record<string, Array<Record<string, unknown>>> };
    const hooks = data.hooks && typeof data.hooks === 'object' ? data.hooks : {};
    for (const entries of Object.values(hooks)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const v = entry[field];
        if (typeof v === 'string' && v.includes(marker)) {
          return v.startsWith(quotedPrefix) && v.includes(cliEntry);
        }
      }
    }
    return false; // no entry of ours found at all
  } catch {
    return false;
  }
}
