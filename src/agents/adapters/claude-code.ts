import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { registerAdapter } from '../registry.js';
import type { HookAdapter, InstallContext, InstallResult } from '../types.js';

/**
 * Claude Code hook helpers — relocated verbatim from src/cli/commands/install.ts
 * in Milestone M1 Branch 2 (v0.1.3/m1/claude-code-refactor). Identifier names,
 * function bodies, and behaviour are preserved exactly so the install snapshot
 * from M1 Branch 1 remains byte-identical (zero-diff invariant; see dev plan
 * §1.5 in reviewduel-submodule).
 *
 * src/cli/commands/install.ts re-exports these names from this module for
 * backward compatibility with existing imports (install.test.ts and others).
 */

// ── Private file helpers (duplicated from install.ts so this adapter is
// ── self-sufficient and avoids a circular import) ─────────────────────────────

function readJsonSafe(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Hook command + entry builders (moved from install.ts) ─────────────────────

/** Path to the user-level Claude Code settings file (where hooks are configured). */
export function getClaudeSettingsPath(home: string): string {
  return join(home, '.claude', 'settings.json');
}

/**
 * Build the shell command string for the UserPromptSubmit hook.
 *
 * Uses `node` explicitly with the absolute path to the running CLI so the hook
 * works regardless of whether nexpath is globally installed or run from a local
 * build (PATH is not required).
 *
 * Forward slashes are used throughout so the value is safe in PowerShell and cmd
 * on Windows as well as bash/zsh on Unix.
 */
export function buildHookCommand(home: string, platform = process.platform): string {
  const cliPath = resolve(process.argv[1]).replace(/\\/g, '/');
  const dbPath  = join(home, '.nexpath', 'prompt-store.db').replace(/\\/g, '/');
  return `node "${cliPath}" auto --db "${dbPath}"`;
}

/** Build the shell command string for the Stop hook. */
export function buildStopHookCommand(home: string, platform = process.platform): string {
  const cliPath = resolve(process.argv[1]).replace(/\\/g, '/');
  const dbPath  = join(home, '.nexpath', 'prompt-store.db').replace(/\\/g, '/');
  return `node "${cliPath}" stop --db "${dbPath}"`;
}

/** Claude Code hook timeout is expressed in seconds in settings.json. */
export const CLAUDE_HOOK_TIMEOUT_SECONDS = 60 as const;

/**
 * Build the UserPromptSubmit + Stop hook entry objects.
 *
 * The `_nexpath_hook: true` field is the reliable deduplication and removal
 * marker — it survives path changes across reinstalls, unlike scanning the
 * command string.
 *
 * UserPromptSubmit gets an explicit 60-second timeout because Claude Code reduces
 * its default to 30s, and the PE preparation on this hook may call the LLM.
 *
 * The Stop hook hosts the interactive PE popup (owner decision B-i). Owner decision
 * (2026-08-04): do NOT set a large "never times out" number here. Claude Code has no
 * infinite-timeout option, so the Stop hook is left WITHOUT an explicit timeout and
 * inherits Claude Code's default Stop-hook budget (~600s / 10 minutes). The popup can
 * stay open for that window; there is no way to make it truly unlimited without a
 * magic number, which the owner declined.
 */
export function buildHookEntry(home: string, platform = process.platform): Record<string, unknown> {
  return {
    UserPromptSubmit: [
      {
        _nexpath_hook: true,
        matcher:       '',
        hooks: [
          {
            type:    'command',
            command: buildHookCommand(home, platform),
            timeout: CLAUDE_HOOK_TIMEOUT_SECONDS,
          },
        ],
      },
    ],
    Stop: [
      {
        _nexpath_hook: true,
        matcher:       '',
        hooks: [
          {
            // No explicit timeout — inherits Claude Code's default Stop-hook budget so the
            // PE popup is not cut off by an arbitrary number (owner decision, 2026-08-04).
            type:    'command',
            command: buildStopHookCommand(home, platform),
          },
        ],
      },
    ],
  };
}

/**
 * True if a hook group is one nexpath wrote — either by our `_nexpath_hook` marker, or (fallback)
 * by its command matching the nexpath hook shape: `node "<cliPath>" auto|stop --db "<dbPath>"`,
 * where `cliPath` is the nexpath CLI (its bin symlink `…/nexpath` or `…/dist/cli/index.js`).
 *
 * The command-string fallback lets install/uninstall recognise and replace prior entries even when
 * an external rewriter of settings.json (e.g. the host agent) strips the custom `_nexpath_hook`
 * marker — otherwise duplicate hook groups accumulate and the hook runs N times per event (BUG-3).
 */
function isNexpathHookGroupV1(group: Record<string, unknown> | undefined): boolean {
  if (group?._nexpath_hook === true) return true;
  const groupHooks = Array.isArray(group?.hooks) ? (group!.hooks as Array<Record<string, unknown>>) : [];
  return groupHooks.some((entry) => {
    const command = typeof entry?.command === 'string' ? entry.command : '';
    const isNexpathCli = /\bnexpath\b/i.test(command) || /dist[\\/]+cli[\\/]+index\.js/i.test(command);
    const isHookVerb = /\b(?:auto|stop)\b\s+--db\b/.test(command);
    return isNexpathCli && isHookVerb;
  });
}

/**
 * Write the nexpath UserPromptSubmit and Stop hooks into ~/.claude/settings.json.
 *
 * Uses a read-filter-append pattern so existing hooks written by other tools are
 * preserved.  Any prior nexpath hook group (by the `_nexpath_hook` marker OR the nexpath command
 * shape — see {@link isNexpathHookGroupV1}) is removed before appending the fresh entry, making
 * this operation idempotent even if the marker was stripped by an external rewriter.
 */
export function writeHookEntry(filePath: string, home: string, platform = process.platform): void {
  const data  = readJsonSafe(filePath);
  const hooks = (data.hooks as Record<string, unknown> | undefined) ?? {};
  const entry = buildHookEntry(home, platform);

  // UserPromptSubmit
  const existingUPS = (hooks.UserPromptSubmit as Array<Record<string, unknown>> | undefined) ?? [];
  hooks.UserPromptSubmit = [
    ...existingUPS.filter((g) => !isNexpathHookGroupV1(g)),
    ...(entry.UserPromptSubmit as unknown[]),
  ];

  // Stop
  const existingStop = (hooks.Stop as Array<Record<string, unknown>> | undefined) ?? [];
  hooks.Stop = [
    ...existingStop.filter((g) => !isNexpathHookGroupV1(g)),
    ...(entry.Stop as unknown[]),
  ];

  data.hooks = hooks;
  writeJson(filePath, data);
}

/**
 * Remove the nexpath UserPromptSubmit and Stop hooks from ~/.claude/settings.json.
 *
 * Identifies nexpath-written hook groups by the `_nexpath_hook` marker OR the nexpath command shape
 * (see {@link isNexpathHookGroupV1}), so marker-stripped duplicates are still removed.
 * Returns false if the file does not exist or no nexpath hooks were found.
 */
export function removeHookEntry(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const data  = readJsonSafe(filePath);
  const hooks = data.hooks as Record<string, unknown> | undefined;
  if (!hooks) return false;

  let removed = false;

  // UserPromptSubmit
  const upsGroups = hooks.UserPromptSubmit as Array<Record<string, unknown>> | undefined;
  if (upsGroups) {
    const filtered = upsGroups.filter((g) => !isNexpathHookGroupV1(g));
    if (filtered.length < upsGroups.length) {
      removed = true;
      if (filtered.length === 0) delete hooks.UserPromptSubmit;
      else hooks.UserPromptSubmit = filtered;
    }
  }

  // Stop
  const stopGroups = hooks.Stop as Array<Record<string, unknown>> | undefined;
  if (stopGroups) {
    const filtered = stopGroups.filter((g) => !isNexpathHookGroupV1(g));
    if (filtered.length < stopGroups.length) {
      removed = true;
      if (filtered.length === 0) delete hooks.Stop;
      else hooks.Stop = filtered;
    }
  }

  if (!removed) return false;
  data.hooks = hooks;
  writeJson(filePath, data);
  return true;
}

// ── HookAdapter implementation ────────────────────────────────────────────────

/**
 * Claude Code adapter. Always detected (Claude Code is treated as universally
 * available, matching the existing install.ts behaviour where it is always
 * added to the detected-agents list). Install writes the hook entry; uninstall
 * removes it.
 *
 * The console.log strings, the settings file path, and the hook command bytes
 * are byte-identical to the pre-refactor inline code so the install snapshot
 * from M1 Branch 1 remains unchanged.
 */
export const claudeCodeAdapter: HookAdapter = {
  id:       'claude-code',
  label:    'Claude Code',
  category: 'hook',

  detect(): boolean {
    return true;
  },

  settingsPath(ctx: InstallContext): string {
    return ctx.settingsPath ?? getClaudeSettingsPath(ctx.home);
  },

  buildHooks(ctx: InstallContext): Record<string, Array<{ type: string; command: string; timeout?: number }>> {
    return {
      UserPromptSubmit: [{ type: 'command', command: buildHookCommand(ctx.home), timeout: CLAUDE_HOOK_TIMEOUT_SECONDS }],
      Stop:             [{ type: 'command', command: buildStopHookCommand(ctx.home) }],
    };
  },

  async install(ctx: InstallContext): Promise<InstallResult> {
    // Use ctx.settingsPath when provided (preserves pre-refactor decoupling
    // between target file path and homedir-based command content). Falls back
    // to deriving from ctx.home when not provided (production path).
    const settingsPath = ctx.settingsPath ?? getClaudeSettingsPath(ctx.home);
    try {
      writeHookEntry(settingsPath, ctx.home);
      console.log(`✓ ${'Claude Code'.padEnd(12)} — advisory hook written to ${settingsPath}`);
      return { status: 'installed' };
    } catch (err) {
      console.log(`⚠ ${'Claude Code'.padEnd(12)} — hook write failed: ${(err as Error).message}`);
      return { status: 'failed', notes: (err as Error).message };
    }
  },

  async uninstall(ctx: InstallContext): Promise<void> {
    const settingsPath = ctx.settingsPath ?? getClaudeSettingsPath(ctx.home);
    const removed = removeHookEntry(settingsPath);
    console.log(removed
      ? `✓ ${'Claude Code'.padEnd(12)} — advisory hook removed`
      : `- ${'Claude Code'.padEnd(12)} — hook not registered, skipped`);
  },
};

// Side-effect registration on module load. The registry is in-process state;
// agents/index.ts side-effect imports this module so the adapter is registered
// before any caller invokes detectAll/getAdapter.
registerAdapter(claudeCodeAdapter);
