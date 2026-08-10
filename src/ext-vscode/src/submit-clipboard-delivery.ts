import { spawnSync } from 'node:child_process';

/**
 * Clipboard-fallback delivery for the submit-time advisory (hook milestone H3, Q3).
 *
 * WHY THIS PATH FIRST (owner ruling on `G-POLICY`, 2026-08-10). Windsurf has two
 * insert mechanisms. The direct one (`addCascadeInput`) is faster but its protobuf
 * payload shape was derived by decompiling Windsurf's own bundle — a near-verbatim
 * match for their AUP's reverse-engineering prohibition (`R8`), and that policy
 * question is still unresolved. **This clipboard + keystroke path carries no such
 * exposure**, so it is built first: if the direct payload is ever ruled against,
 * the milestone still has a working delivery route rather than being stranded.
 *
 * WHY INJECT AND SUBMIT ARE SEPARATE. H1 proved empirically that **neither
 * Windsurf nor Cursor auto-submits** after an insert — the text only populates the
 * composer. Completing "the picked option becomes the sole prompt of that turn"
 * therefore needs a second, distinct step with its own failure mode. Modelling
 * them as one call would bake in a false assumption.
 *
 * WHY FOCUS IS AN EXPLICIT PRECONDITION. H1's other load-bearing finding: submit
 * success is coupled to **focus state, not platform**. A synthetic Enter submitted
 * on Windsurf after `addCascadeInput` (which focuses the panel) but not after raw
 * typing; on Cursor it failed without a focus command and succeeded with one. So
 * `focus` is a first-class injected step here, not an incidental detail.
 *
 * CROSS-OS FROM THE FIRST COMMIT (§2.4b). `submitKeystroke` branches macOS /
 * Windows / Linux exactly as the shipped `pasteKeystroke` does
 * (`windsurf-autopaste.ts:73-89`) — osascript / PowerShell SendKeys / xdotool with
 * Wayland alternates. **No submit-keystroke helper existed before this**; the
 * shipped one only sends Ctrl+V, so this is genuinely new cross-OS work, not reuse.
 *
 * BACKWARD COMPATIBILITY (`R12`). This is a NEW module with no consumers until H3
 * wires it behind `NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY`. It does not modify
 * `windsurf-autopaste.ts`, `extension.ts`, or any other shipping file.
 *
 * OWNERSHIP. Everything referenced here is Vedansi-owned
 * (`src/ext-vscode/**`). Hiren's `engine-option-generator.ts` and Bhavnesh's
 * `TtySelectFn.ts` are consumed elsewhere in H3 but never edited.
 */


/** Injected OS-automation seams. Defaults are supplied by the caller (extension.ts). */
export interface SubmitClipboardDeliveryDeps {
  /** Write the replacement text to the system clipboard. */
  writeClipboard: (text: string) => Promise<void>;
  /** Raise/focus the host editor window so keystrokes land in it. */
  focus: () => Promise<boolean>;
  /** Simulate the paste shortcut into the focused input. */
  pasteKeystroke: () => boolean;
  /** Simulate the submit key (Enter) — see `buildSubmitKeystroke` for the OS matrix. */
  submitKeystroke: () => boolean;
  /** Optional redacted logger. **Never** pass the replacement text. */
  log?: (message: string) => void;
}

export interface SubmitClipboardDelivery {
  /** Place the text in the composer. Resolves `false` on any failure — never throws. */
  inject: (text: string) => Promise<boolean>;
  /** Send the submit key. Resolves `false` on any failure — never throws. */
  submit: () => Promise<boolean>;
}


/**
 * Build the delivery pair the submit-time poller consumes.
 *
 * Fail-open (`A3`) throughout: every step swallows its own error and reports
 * `false`. A delivery problem must never propagate — the user's prompt was
 * already blocked by the hook, so a thrown error here would strand them.
 */
export function createSubmitClipboardDelivery(
  deps: SubmitClipboardDeliveryDeps,
): SubmitClipboardDelivery {
  const log = deps.log ?? (() => {});

  return {
    async inject(text: string): Promise<boolean> {
      if (typeof text !== 'string' || text.length === 0) {
        // Guard mirrors submit-decision-record's: pasting "" would clear the
        // composer and silently lose the turn.
        log('[nexpath] submit-clipboard: refused an empty replacement');
        return false;
      }
      try {
        await deps.writeClipboard(text);
      } catch {
        log('[nexpath] submit-clipboard: clipboard write failed');
        return false;
      }
      // Focus is a precondition, not a nicety — H1 proved submit depends on it.
      // A focus failure is NOT fatal on its own: the paste may still land if the
      // composer already had focus, so we continue but record it.
      let focused = false;
      try {
        focused = await deps.focus();
      } catch {
        focused = false;
      }
      if (!focused) log('[nexpath] submit-clipboard: focus not confirmed; pasting anyway');

      let pasted = false;
      try {
        pasted = deps.pasteKeystroke();
      } catch {
        pasted = false;
      }
      log(`[nexpath] submit-clipboard: inject ${pasted ? 'dispatched' : 'failed'} (focused=${focused})`);
      return pasted;
    },

    async submit(): Promise<boolean> {
      try {
        const sent = deps.submitKeystroke();
        log(`[nexpath] submit-clipboard: submit ${sent ? 'dispatched' : 'failed'}`);
        return sent;
      } catch {
        log('[nexpath] submit-clipboard: submit threw');
        return false;
      }
    },
  };
}


/** Platform + tool seams for the submit keystroke, mirroring `AutoPasteDeps`. */
export interface SubmitKeystrokeDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  hasCommand?: (cmd: string) => boolean;
  run?: (cmd: string, args: string[]) => boolean;
}


/**
 * Send the submit key (Enter) to the focused input, per OS.
 *
 * Deliberately mirrors `pasteKeystroke`'s structure and tool preferences
 * (`windsurf-autopaste.ts:67-91`) so both keystrokes behave consistently and fail
 * the same way. Returns `false` — never throws — when no tool is available, which
 * the caller reports as `submit_failed` rather than treating as a crash.
 *
 * **Linux caveat, deliberately preserved from the shipped helper:** with no
 * `DISPLAY`/`WAYLAND_DISPLAY` there is nothing to type into, so this returns
 * `false` immediately rather than shelling out pointlessly.
 */
function defaultHasCommand(cmd: string): boolean {
  try {
    return spawnSync('which', [cmd], { stdio: 'ignore', timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
}

function defaultRun(cmd: string, args: string[]): boolean {
  try {
    return spawnSync(cmd, args, { stdio: 'ignore', timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}

export function submitKeystroke(deps: SubmitKeystrokeDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  // CORRECTED 2026-08-10 — these previously defaulted to `() => false`, which made
  // `submitKeystroke()` a guaranteed no-op in production: called with no deps (the
  // real wiring), it could never detect a tool or run one, so the submit key would
  // NEVER be sent while every unit test still passed. Exactly the "works in tests,
  // silently dead in production" class this milestone already had to disprove for
  // the env-var passthrough in H2. Defaults now spawn for real, matching the
  // shipped `pasteKeystroke` (`windsurf-autopaste.ts:63-64,83-84`) verbatim.
  const has = deps.hasCommand ?? defaultHasCommand;
  const run = deps.run ?? defaultRun;

  try {
    if (platform === 'darwin') {
      return run('osascript', ['-e', 'tell application "System Events" to key code 36']);
    }
    if (platform === 'win32') {
      return run('powershell', [
        '-NoProfile', '-Command',
        '$w=New-Object -ComObject WScript.Shell;$w.SendKeys("{ENTER}")',
      ]);
    }
    // Linux (X11, or Wayland with a compatible tool)
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
    if (has('xdotool')) return run('xdotool', ['key', '--clearmodifiers', 'Return']);
    if (has('wtype')) return run('wtype', ['-k', 'Return']);
    if (has('ydotool')) return run('ydotool', ['key', '28:1', '28:0']); // KEY_ENTER
    return false;
  } catch {
    return false;
  }
}
