import * as vscode from 'vscode';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPrereqs, cliRuns } from './prereq.js';
import { stageCli } from './cli-stage.js';
import { SETUP_SENTINEL_FILENAME } from './setup-runner-source.js';
import { runSetupInTerminal } from './terminal-runner.js';
import {
  runSetupFlow,
  buildSetupCommand,
  type SetupFlowDeps,
  type SetupState,
} from './setup-flow.js';

/**
 * Thin VS Code glue for the CLI auto-installer.
 *
 * All of the real decision logic lives in the (unit-tested) modules in this
 * folder; this file only constructs the live dependencies (vscode terminal /
 * notifications / globalState, node fs / os) and provides the two entry points
 * `extension.ts` calls. It is intentionally additive — when the CLI is already
 * set up it only points IPC at the staged binary (`NEXPATH_BIN`) and returns,
 * so the existing watcher/poller/inject behaviour is unchanged.
 */

/** globalState key holding `{ done, version }`. */
const SETUP_STATE_KEY = 'nexpath.cliSetup';
/** Directory inside the .vsix the CLI is bundled into at package time. */
const BUNDLED_CLI_DIRNAME = 'nexpath-cli';

export const RUN_SETUP_COMMAND = 'nexpath.runSetup';

type Logger = (line: string) => void;

function nexpathHome(): string {
  return join(homedir(), '.nexpath');
}

function bundledCliDir(context: vscode.ExtensionContext): string | null {
  const base = context.extensionPath;
  if (typeof base !== 'string' || base.length === 0) return null;
  const dir = join(base, BUNDLED_CLI_DIRNAME);
  return existsSync(dir) ? dir : null;
}

function buildDeps(context: vscode.ExtensionContext, log: Logger): SetupFlowDeps {
  const home = nexpathHome();
  const sentinelPath = join(home, SETUP_SENTINEL_FILENAME);
  return {
    nexpathHome: home,
    bundledCliDir: bundledCliDir(context),
    checkPrereqs: () => checkPrereqs(),
    stageCli: (bundle, h) => stageCli(bundle, h),
    writeFile: (p, data) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, data, 'utf8');
    },
    buildCommand: buildSetupCommand,
    runInTerminal: (command) =>
      runSetupInTerminal(command, {
        createTerminal: () => {
          // Drive the bundled CLI to (a) skip the redundant "install the
          // extension" marketplace deep-links — we ARE the extension — and
          // (b) register ONLY the IDE the user is in. Both are no-ops in the CLI
          // when the env is unset, so manual `nexpath install` is unaffected.
          const setupEnv: Record<string, string> = { NEXPATH_EXT_SETUP: '1' };
          const agent = process.env.NEXPATH_AGENT;
          if (agent === 'cursor' || agent === 'windsurf') setupEnv.NEXPATH_ONLY_AGENT = agent;
          // RC21: on Windows the Cascade hook that actually fires is the
          // WORKSPACE-level `<project>/.windsurf/hooks.json`. The CLI runs with
          // cwd = the staged CLI dir, so without this it wrote the hook next to
          // itself and the user's project never got one. Pass the folder this
          // window has open; the CLI falls back to its own cwd when unset.
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (ws) setupEnv.NEXPATH_WORKSPACE_DIR = ws;
          return vscode.window.createTerminal({ name: 'Nexpath Setup', env: setupEnv });
        },
        readSentinel: () =>
          existsSync(sentinelPath) ? readFileSync(sentinelPath, 'utf8').trim() : null,
        clearSentinel: () => {
          try {
            rmSync(sentinelPath, { force: true });
          } catch {
            /* best-effort */
          }
        },
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        log,
      }),
    showError: (m) => void vscode.window.showErrorMessage(m),
    showInfo: (m) => void vscode.window.showInformationMessage(m),
    applyNexpathBin: (shim) => {
      process.env.NEXPATH_BIN = shim;
      log(`[nexpath] NEXPATH_BIN → ${shim}`);
    },
    // The staged CLI "runs" only if `node <entry> --version` exits 0 — which
    // requires its deps to be installed. Used to refuse a dep-less copy.
    verifyStagedCli: (cliEntry) => cliRuns('node', [cliEntry, '--version']),
    // 2026-08-13 (owner's clean-install test): "setup done" survives in
    // globalState while a wipe deletes `~/.nexpath` + hooks.json — without this
    // on-disk check the runner never re-ran and the submit hook silently never
    // fired again. Registered = THIS editor's hooks.json carries our entry AND
    // the submit-flow flag file exists. Hosts with nothing to register (plain
    // VS Code) report true; an unreadable file also reports true so a transient
    // fs error cannot loop the setup terminal on every activation.
    verifyHookRegistration: () => {
      try {
        const agent = process.env.NEXPATH_AGENT;
        if (agent !== 'cursor' && agent !== 'windsurf') return true;
        // ── RC19 (Windows tester, 2026-08-17) ────────────────────────────────
        // The flag is PER HOST (`{"cursor":bool,"windsurf":bool}`) and each
        // host's hook writer sets only its OWN key — the extension drives setup
        // with NEXPATH_ONLY_AGENT so it registers just the editor you are in.
        // Verifying only that the FILE EXISTS therefore reported "registered"
        // on a machine set up for the OTHER editor (or by a pre-flag CLI):
        // setup never re-ran, this host's key stayed absent, the submit flow
        // never armed, and prompts sailed through with no popup at all — the
        // exact Windows/Devin failure. Verify what the runtime actually needs:
        // THIS host's key must be `true`. Corrupt/absent ⇒ unregistered, so the
        // re-run rewrites it (setSubmitFlowFlag merges, never clobbers the
        // other host).
        const flagFile = join(home, 'submit-flow.json');
        if (!existsSync(flagFile)) return false;
        try {
          const flags = JSON.parse(readFileSync(flagFile, 'utf8')) as Record<string, unknown>;
          // RC19b (regression caught in the 2026-08-17 verification pass):
          // an ABSENT key means "this editor was never registered" → repair it.
          // An EXPLICIT `false` is the owner's documented config-backed REVERT
          // to the old flow — re-running setup there would rewrite it to `true`
          // and silently undo a deliberate decision. Treat it as registered
          // (nothing to repair); the armer logs why it is not arming.
          if (flags[agent] === false) return true;
          if (flags[agent] !== true) return false;
        } catch {
          return false; // unparseable ⇒ the resolver would read OFF ⇒ re-register
        }
        if (agent === 'cursor') {
          const p = join(homedir(), '.cursor', 'hooks.json');
          if (!existsSync(p)) return false;
          const t = readFileSync(p, 'utf8');
          // `"version"` is required by Cursor's config validator (R5) — a
          // legacy version-less file is DEAD and must be rewritten, so it
          // counts as unregistered.
          return t.includes('cursor-hook') && t.includes('"version"');
        }
        const p = join(homedir(), '.codeium', 'windsurf', 'hooks.json');
        if (!existsSync(p) || !readFileSync(p, 'utf8').includes('windsurf-hook')) return false;
        // RC21: on Windows the user-level hook above is NOT executed by
        // Devin/Devin Next — only the WORKSPACE hook fires. Verify the one that
        // actually runs, per open folder, so opening a new project registers it
        // instead of silently having no hook at all. No folder open ⇒ nothing to
        // verify (the poller has no roots either).
        if (process.platform === 'win32') {
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!ws) return true;
          const wsHook = join(ws, '.windsurf', 'hooks.json');
          return existsSync(wsHook) && readFileSync(wsHook, 'utf8').includes('windsurf-hook');
        }
        return true;
      } catch {
        return true; // fail-quiet: never churn the setup terminal on fs errors
      }
    },
    getState: () =>
      context.globalState.get<SetupState>(SETUP_STATE_KEY) ?? { done: false, version: null },
    setState: (s) => Promise.resolve(context.globalState.update(SETUP_STATE_KEY, s)),
    log,
  };
}

/**
 * Stage the bundled CLI (if any) WITHOUT running the interactive installer, and
 * point IPC at it. Lets a machine that was already set up keep working on every
 * activation (the env var doesn't persist across sessions). Returns the stage
 * result so the caller can decide whether to offer (re)setup.
 */
/**
 * Activation hook. Strictly additive — it must never override or break a
 * `nexpath` that already works:
 *
 *   Direction 1: if a working `nexpath` already resolves on PATH (a global
 *     install, or a prior manual setup), do NOTHING — don't stage, don't set
 *     NEXPATH_BIN, don't offer. The extension then behaves exactly as it did
 *     before this feature, so machines already running Claude/Cursor/Windsurf
 *     are completely untouched.
 *   Direction 2/3/4: only when there's no working CLI do we consider the staged
 *     one — and we point IPC at it (and treat it as "already set up") ONLY if it
 *     actually runs (deps installed). A dep-less copy is never made active.
 *
 * Never auto-opens a terminal without consent.
 */
export async function offerSetupIfNeeded(
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<void> {
  const deps = buildDeps(context, log);

  // A working global `nexpath` may already resolve on PATH (e.g. a separate
  // `nexpath install --for cli` setup). We must NEVER override or break it — but
  // we STILL offer the per-IDE setup so THIS editor (Cursor/Windsurf) gets
  // registered + remembered independently of any CLI setup. `preferExistingCli`
  // carries that through: keep IPC on the global, just register this editor.
  const hasGlobalCli = cliRuns('nexpath');
  if (hasGlobalCli) {
    log('[nexpath] working nexpath on PATH — will use it (NEXPATH_BIN untouched); still offering per-IDE setup');
  }

  // We can only stage/run setup if node/npm + a bundled CLI exist.
  if (!checkPrereqs().ready) {
    log('[nexpath] node/npm missing — auto-setup not offered');
    return;
  }
  const staged = deps.stageCli(deps.bundledCliDir, deps.nexpathHome);
  if (staged.status === 'no-bundle' || staged.status === 'error') {
    log(`[nexpath] CLI auto-setup not offered (stage: ${staged.status})`);
    return;
  }

  // The staged CLI becomes the IPC binary ONLY if it runs AND there is no working
  // global to defer to (never override the global — the additive guarantee).
  const verified = staged.cliEntry ? deps.verifyStagedCli(staged.cliEntry) : false;
  if (!hasGlobalCli && verified && staged.shimPath) deps.applyNexpathBin(staged.shimPath);

  const state = deps.getState();
  // "Ready" is satisfied by the global CLI when present, else by the staged copy.
  const cliReady = hasGlobalCli || verified;
  // ── RC19 (Windows/Devin tester, 2026-08-17) ──────────────────────────────
  // This gate USED to skip the on-disk registration check that `runSetupFlow`
  // performs, so there were TWO different definitions of "already set up" and
  // the shallower one won: an editor whose hooks/flag were missing reported
  // "already set up (v0.1.3)" and returned here, never reaching the
  // registration-aware gate. Result on the tester's machine: the submit flow
  // could never arm and nothing ever repaired it. One authority now — the same
  // `verifyHookRegistration` both gates use.
  const hookRegistered = deps.verifyHookRegistration?.() ?? true;
  const upToDate =
    state.done && state.version === staged.version && staged.status === 'already-current'
    && cliReady && hookRegistered;
  if (upToDate) {
    log(`[nexpath] this editor already set up (v${staged.version})`);
    return;
  }
  // Registration drift on an otherwise-complete install repairs itself WITHOUT
  // asking: the user already consented to setup once; what went missing is our
  // own on-disk registration (e.g. this editor's `submit-flow.json` key was
  // never written because setup last ran from the OTHER editor). Runs at most
  // once per activation — this function is invoked once, after activation.
  if (state.done && !hookRegistered) {
    log('[nexpath] this editor is set up but NOT fully registered (hook entry or submit-flow key missing) — re-running setup automatically');
    await runSetupFlow(deps, { preferExistingCli: hasGlobalCli });
    return;
  }

  const isUpdate = state.done && state.version !== staged.version;
  const agentLabel =
    process.env.NEXPATH_AGENT === 'cursor' ? 'Cursor'
    : process.env.NEXPATH_AGENT === 'windsurf' ? 'Windsurf'
    : 'this editor';
  const message = isUpdate
    ? `Nexpath update available (v${staged.version}). Re-run setup for ${agentLabel}?`
    : `Set up Nexpath for ${agentLabel} now? (you can answer the prompts in the terminal).`;
  const choice = await vscode.window.showInformationMessage(message, 'Set up', 'Later');
  if (choice === 'Set up') {
    await runSetupFlow(deps, { force: isUpdate, preferExistingCli: hasGlobalCli });
  } else {
    log('[nexpath] user deferred per-IDE setup');
  }
}

/**
 * Command handler for "Nexpath: Set up CLI" — always (re)runs the flow.
 */
export async function runSetupCommand(
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<void> {
  const deps = buildDeps(context, log);
  await runSetupFlow(deps, { force: true });
}
