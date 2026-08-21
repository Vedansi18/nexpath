import * as vscode from 'vscode';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPrereqs, cliRuns } from './prereq.js';
import { stageCli } from './cli-stage.js';
import { verifyCommandCurrent } from './hook-command-verify.js';
import { SETUP_SENTINEL_FILENAME } from './setup-runner-source.js';
import { runSetupInTerminal } from './terminal-runner.js';
import {
  runSetupFlow,
  buildSetupCommand,
  type SetupFlowDeps,
  type SetupOutcome,
  type SetupState,
} from './setup-flow.js';

/**
 * RC28 (Windows/Devin tester, 2026-08-20): setup is SINGLE-FLIGHT.
 *
 * Three call sites start a setup — the auto-repair on registration drift, the
 * "Set up" notification button, and the "Nexpath: Set up CLI" command — and none
 * of them knew about the others. Two that overlap open two `Nexpath Setup`
 * terminals (visible in the tester's screenshots) and race TWO interactive
 * `npm ci` + `install --for vscode` runs against the SAME staged CLI directory:
 * one can wipe `node_modules` while the other is mid-install, and both then
 * write the same hooks.json and flag file.
 *
 * A module-level promise is the right scope: `runSetupFlow` is already stateless
 * across calls, the extension host is single-threaded, and one setup per host
 * process is exactly the invariant we want. Followers await the SAME promise, so
 * they observe the real outcome instead of a fabricated one, and the slot is
 * always released in `finally` — a thrown setup can never wedge the gate shut.
 */
let setupInFlight: Promise<SetupOutcome> | null = null;

async function runSetupFlowOnce(
  deps: SetupFlowDeps,
  opts: Parameters<typeof runSetupFlow>[1],
  log: Logger,
): Promise<SetupOutcome> {
  if (setupInFlight) {
    log('[nexpath] setup already running — joining it instead of opening a second setup terminal');
    return setupInFlight;
  }
  setupInFlight = (async () => {
    try {
      return await runSetupFlow(deps, opts);
    } finally {
      setupInFlight = null;
    }
  })();
  return setupInFlight;
}

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
    //
    // ── RC26 (Windows/Cursor tester, 2026-08-19) ────────────────────────────
    // A "watcher event" (independent DB polling) fired repeatedly on the
    // tester's machine — real prompts were being typed and sent — but NOT ONE
    // `submit handoff:` line ever appeared, meaning Cursor's `beforeSubmitPrompt`
    // hook never actually ran, though the flag was armed and the file said
    // "already set up". Root cause: this check was SHAPE-BLIND — 'cursor-hook'
    // and '"version"' occur ANYWHERE in the file, so a hooks.json first written
    // by an install that predates a hook-command fix (e.g. RC25's move off a
    // bare `node`, which silently ENOENTs under a sanitized hook-spawn PATH —
    // the exact class RC21 already proved real on Windows) is judged
    // "registered" FOREVER: the self-heal this milestone built (RC7/RC19b) can
    // only run when this returns false, so a stale command was invisible to it
    // and NEVER got the fix. `verifyCommandCurrent` below closes the whole
    // class generically — any FUTURE hook-command change now propagates to
    // every existing install automatically, without hunting down who checks
    // what each time.
    verifyHookRegistration: (cliEntry) => {
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
          const raw = readFileSync(p, 'utf8');
          // `"version"` is required by Cursor's config validator (R5) — a
          // legacy version-less file is DEAD and must be rewritten.
          if (!raw.includes('"version"')) return false;
          // Cursor has only one command field, same shape on every OS.
          return verifyCommandCurrent(raw, 'cursor-hook', cliEntry, 'command', '"');
        }
        const p = join(homedir(), '.codeium', 'windsurf', 'hooks.json');
        const globalRaw = existsSync(p) ? readFileSync(p, 'utf8') : null;
        // The GLOBAL (user-level) hook is only ever actually EXECUTED via its
        // `command` field (bash) on macOS/Linux; on Windows it is present but
        // inert (RC21) — checked here only for existence/shape, not currency
        // against `powershell` semantics, since nothing on win32 runs it.
        if (globalRaw === null || !verifyCommandCurrent(globalRaw, 'windsurf-hook', cliEntry, 'command', '"')) return false;
        // RC21: on Windows the user-level hook above is NOT executed by
        // Devin/Devin Next — only the WORKSPACE hook fires, and it runs via
        // `powershell`, not `command` (RC21/RC23's own header). Verify the
        // field that ACTUALLY runs, per open folder, so opening a new project
        // registers it instead of silently having no hook at all. No folder
        // open ⇒ nothing to verify (the poller has no roots either).
        if (process.platform === 'win32') {
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!ws) return true;
          const wsHook = join(ws, '.windsurf', 'hooks.json');
          const wsRaw = existsSync(wsHook) ? readFileSync(wsHook, 'utf8') : null;
          return wsRaw !== null && verifyCommandCurrent(wsRaw, 'windsurf-hook', cliEntry, 'powershell', '& "');
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
  // `cliEntry` is null only in a status ('no-bundle'/'error') already returned
  // above, but the type doesn't narrow that far here; '' degrades RC26's
  // content check to quoting-only rather than crashing (every string contains
  // '') — never worse than before this change, and this branch is unreachable
  // in practice.
  const hookRegistered = deps.verifyHookRegistration?.(staged.cliEntry ?? '') ?? true;
  // ── RC32 (2026-08-21) ────────────────────────────────────────────────────
  // `cliReady` above is satisfied by a working GLOBAL nexpath (`hasGlobalCli`),
  // but the registered hook always invokes the STAGED entry — so a global CLI
  // cannot make the hook work. Found live: with a global present and the staged
  // copy's `node_modules` missing, this logged "already set up" while running
  // the registered command by hand died ERR_MODULE_NOT_FOUND.
  //
  // This gate MUST carry the same rule as `runSetupFlow`'s. RC19's lesson,
  // repeating: two independent definitions of "already set up" is exactly how
  // the self-heal became unreachable from activation last time — the fix landed
  // in `runSetupFlow` and this gate returned before ever calling it.
  //
  // Inert on a healthy install (`verified` is already true there); the only
  // machines it changes are ones whose hook is broken right now.
  const stagedRunsForHook = !hookRegistered || verified;
  const upToDate =
    state.done && state.version === staged.version && staged.status === 'already-current'
    && cliReady && hookRegistered && stagedRunsForHook;
  if (upToDate) {
    log(`[nexpath] this editor already set up (v${staged.version})`);
    return;
  }
  if (hookRegistered && !verified) {
    log('[nexpath] the registered hook points at the staged CLI but that copy does not run (dependencies missing/incomplete) — re-running setup to repair it');
  }
  // Registration drift on an otherwise-complete install repairs itself WITHOUT
  // asking: the user already consented to setup once; what went missing is our
  // own on-disk registration (e.g. this editor's `submit-flow.json` key was
  // never written because setup last ran from the OTHER editor). Runs at most
  // once per activation — this function is invoked once, after activation.
  if (state.done && !hookRegistered) {
    log('[nexpath] this editor is set up but NOT fully registered (hook entry or submit-flow key missing) — re-running setup automatically');
    await runSetupFlowOnce(deps, { preferExistingCli: hasGlobalCli }, log);
    return;
  }

  const isUpdate = state.done && state.version !== staged.version;
  const agentLabel =
    process.env.NEXPATH_AGENT === 'cursor' ? 'Cursor'
    : process.env.NEXPATH_AGENT === 'windsurf' ? 'Windsurf'
    : 'this editor';
  const message = isUpdate
    ? `Nexpath update available (v${staged.version}). Re-run setup for ${agentLabel}?`
    // RC28: kept to one short line. VS Code lays a notification out as
    // [icon][message][buttons]; once the message wraps, the buttons are pushed
    // onto their own row and the toast reflows — which is what the tester's
    // screenshot shows (buttons above, text below) while a second notification
    // animated in beside it. The layout itself is VS Code's renderer, not ours
    // (this is the plain `showInformationMessage(msg, ...buttons)` API), but a
    // message that does not wrap gives it nothing to reflow.
    : `Set up Nexpath for ${agentLabel}?`;
  const choice = await vscode.window.showInformationMessage(message, 'Set up', 'Later');
  if (choice === 'Set up') {
    await runSetupFlowOnce(deps, { force: isUpdate, preferExistingCli: hasGlobalCli }, log);
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
  await runSetupFlowOnce(deps, { force: true }, log);
}
