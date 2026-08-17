import { existsSync } from 'node:fs';
import { join, resolve, posix as posixPath, win32 as win32Path } from 'node:path';
import { registerAdapter } from '../registry.js';
import {
  getWindsurfHooksPath,
  writeWindsurfHooks,
  removeWindsurfHooks,
} from '../../windsurf-hook/install.js';
import type {
  InstallContext,
  InstallResult,
  VSCodeExtensionAdapter,
} from '../types.js';

/**
 * Windsurf adapter (M10 of M2 Branch 4).
 *
 * Windsurf is Codeium's AI-native IDE (a VS Code fork, like Cursor).
 * Nexpath ships the same VS Code extension to Cursor + Windsurf via
 * Open VSX. This adapter mirrors `cursor.ts` but with Windsurf-specific
 * config paths.
 *
 * Storage layout difference from Cursor:
 *   - Cursor uses VS Code's standard `User/workspaceStorage/<id>/state.vscdb`
 *     (SQLite) — covered by the cursor-v* extractors.
 *   - Windsurf historically uses `~/.codeium/windsurf/` (Cascade chat data
 *     stored as JSON files rather than SQLite). Architecture rev 2 §4.2
 *     covers this; the dev plan §3 M2 §2.2 M10 calls out the difference.
 *   - Recent Windsurf versions ALSO populate VS Code-style storage at
 *     `User/workspaceStorage/`. We watch both — the Windsurf extractor
 *     (already shipped in B2 as a stub) handles the cascade.* keys when
 *     they appear; the JSON-file path watch belongs to a future
 *     refinement once a real Windsurf chat capture is available.
 *
 * The `extractPrompt` stub matches `cursor.ts` for the same reason —
 * decoding lives at the extension's runtime, not in the CLI adapter.
 */

const MARKETPLACE_ID = 'nexpath.nexpath-vscode';

const OPEN_VSX_URL = `https://open-vsx.org/extension/${MARKETPLACE_ID.replace(
  '.',
  '/',
)}`;
const VS_CODE_MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${MARKETPLACE_ID}`;

/**
 * Local, adapter-only platform override. Kept out of the shared
 * `InstallContext` interface (`src/agents/types.ts`) on purpose — that file
 * is outside this adapter's domain. A real `InstallContext` never carries
 * these properties, so `ctx.platform`/`ctx.appdata` below simply read as
 * `undefined` and fall back to `process.platform`/`process.env.APPDATA`.
 */
export type PlatformOverride = { platform?: NodeJS.Platform; appdata?: string };

/**
 * OS-specific Windsurf configuration directory. Used both as the primary
 * detection heuristic and as the base for the workspace-storage path.
 *
 * Uses `path.posix`/`path.win32` explicitly, keyed off `platform`, rather
 * than `node:path`'s host-native `join` — which always builds with the
 * RUNNING machine's separator regardless of what `platform` says. That made
 * this function silently ignore its own `platform` parameter for every
 * platform other than whichever one the process happened to run on.
 */
export function windsurfConfigDir(
  home: string,
  platform: NodeJS.Platform = process.platform,
  appdata?: string,
): string {
  if (platform === 'win32') {
    const base = appdata ?? process.env.APPDATA ?? win32Path.join(home, 'AppData', 'Roaming');
    return win32Path.join(base, 'Windsurf');
  }
  if (platform === 'darwin') {
    return posixPath.join(home, 'Library', 'Application Support', 'Windsurf');
  }
  return posixPath.join(home, '.config', 'Windsurf');
}

/**
 * Legacy Cascade data directory (per-user, OS-agnostic). Windsurf may
 * still drop JSON chat files here in addition to the VS Code-style
 * workspaceStorage path.
 */
function codeiumCascadeDir(home: string): string {
  return join(home, '.codeium', 'windsurf');
}

export const windsurfAdapter: VSCodeExtensionAdapter = {
  id: 'windsurf',
  label: 'Windsurf',
  category: 'vscode-extension',
  marketplace: { openVsx: MARKETPLACE_ID, vsCode: MARKETPLACE_ID },

  detect(ctx: InstallContext): boolean {
    const c = ctx as InstallContext & PlatformOverride;
    return (
      existsSync(windsurfConfigDir(c.home, c.platform, c.appdata)) ||
      existsSync(codeiumCascadeDir(c.home))
    );
  },

  chatHistoryPaths(ctx: InstallContext): string[] {
    const c = ctx as InstallContext & PlatformOverride;
    const platform = c.platform ?? process.platform;
    const path = platform === 'win32' ? win32Path : posixPath;
    return [
      path.join(windsurfConfigDir(c.home, c.platform, c.appdata), 'User', 'workspaceStorage'),
      codeiumCascadeDir(c.home),
    ];
  },

  /**
   * Intentional stub — same architectural decision as `cursor.ts`. See the
   * comprehensive JSDoc on `cursorAdapter.extractPrompt` for the full
   * rationale + migration path if a CLI caller is ever added.
   *
   * Short version: decoding lives in the extension runtime
   * (`src/ext-vscode/src/extractors/`); the CLI adapter never decodes rows.
   * Returning `null` is contract-compliant ("I don't know"). When the
   * extractors are promoted to `src/agents/chat-history-extractors/`,
   * this method gets wired up to delegate via `pickExtractor` +
   * `extractor.decodeRow`.
   */
  extractPrompt(_rowKey: string, _rowValue: unknown) {
    return null;
  },

  async install(ctx: InstallContext): Promise<InstallResult> {
    if (!this.detect(ctx)) {
      console.log(`-  ${'Windsurf'.padEnd(12)} — not detected; skipping`);
      return { status: 'skipped', notes: 'Windsurf not installed on this machine' };
    }
    // Capture: write the Cascade hook (pre_user_prompt → nexpath auto) so prompts
    // are captured even though Windsurf encrypts Cascade at rest. The advisory is
    // then delivered by the extension's poller (read-only hooks can't inject).
    const cliPath  = resolve(process.argv[1]);
    const hooksPath = getWindsurfHooksPath(ctx.home);
    writeWindsurfHooks(hooksPath, cliPath);
    console.log(`✓ ${'Windsurf'.padEnd(12)} — Cascade capture hook written to ${hooksPath}`);
    // Windows/Devin Next does NOT execute the user-level hooks.json (verified
    // 2026-06-16: 0 hook invocations during a full Cascade walk, while the file was
    // present at the documented path and `nexpath windsurf-hook` captured fine when
    // invoked directly). Per the Cascade Hooks spec, hooks also load + merge from the
    // WORKSPACE-level `.windsurf/hooks.json`, which Devin Next DOES honor — so on
    // Windows write that too, relative to the project the user runs install in. Gated
    // to win32 so platforms that already fire the user-level hook don't double-capture.
    if (process.platform === 'win32') {
      // ── RC21 (Windows tester, 2026-08-17) ────────────────────────────────
      // `ctx.cwd` is the CLI process's cwd. When the EXTENSION drives setup the
      // runner executes the staged CLI, so cwd is `~/.nexpath/cli/<version>` —
      // and this hook landed in `…\.nexpath\cli\0.1.3\.windsurf\hooks.json`
      // (seen verbatim in the tester's setup output). Since Windows/Devin Next
      // honours ONLY the workspace hook, the user's project got no hook at all:
      // nothing ever fired, no popup, no matter how correct the rest of the
      // chain was. The extension now passes the folder it has open via
      // NEXPATH_WORKSPACE_DIR; a manual `nexpath install` still uses the
      // directory the user ran it in (ctx.cwd), which is what they expect.
      const wsRoot = process.env.NEXPATH_WORKSPACE_DIR?.trim() || ctx.cwd;
      const wsHooksPath = join(wsRoot, '.windsurf', 'hooks.json');
      writeWindsurfHooks(wsHooksPath, cliPath);
      console.log(`   ${' '.repeat(12)}   + workspace hook (Windows/Devin Next): ${wsHooksPath}`);
    }

    // Delivery: the extension must be installed for the advisory UI + inject.
    // Skip the marketplace deep-links when setup is driven BY the extension
    // (it's already installed). The Cascade capture hook above is still written.
    if (!process.env.NEXPATH_EXT_SETUP) {
      console.log(`   ${' '.repeat(12)}   Then install the Nexpath extension to deliver guidance:`);
      console.log(`    Open VSX:            ${OPEN_VSX_URL}`);
      console.log(`    VS Code Marketplace: ${VS_CODE_MARKETPLACE_URL}`);
      console.log(`    Or via CLI:          windsurf --install-extension ${MARKETPLACE_ID}`);
    }
    return {
      status: 'installed',
      notes:
        'Cascade capture hook written; the user must also install the VS Code extension (deep-link printed) for advisory delivery.',
    };
  },

  async uninstall(ctx: InstallContext): Promise<void> {
    if (!this.detect(ctx)) {
      console.log(`-  ${'Windsurf'.padEnd(12)} — not detected; skipping`);
      return;
    }
    const removed = removeWindsurfHooks(getWindsurfHooksPath(ctx.home));
    console.log(removed
      ? `✓ ${'Windsurf'.padEnd(12)} — Cascade capture hook removed`
      : `-  ${'Windsurf'.padEnd(12)} — no Cascade capture hook found`);
    // Mirror the install: remove the Windows workspace-level hook too (no-op
    // elsewhere). RC21: resolve the SAME root install writes to, or uninstall
    // would leave the real workspace hook behind and keep invoking a CLI the
    // user just removed.
    if (process.platform === 'win32') {
      const wsRoot = process.env.NEXPATH_WORKSPACE_DIR?.trim() || ctx.cwd;
      removeWindsurfHooks(join(wsRoot, '.windsurf', 'hooks.json'));
    }
    console.log(`   ${' '.repeat(12)}   Uninstall the Nexpath extension from the Windsurf Extensions panel`);
    console.log(`    Or via CLI:          windsurf --uninstall-extension ${MARKETPLACE_ID}`);
  },
};

registerAdapter(windsurfAdapter);
