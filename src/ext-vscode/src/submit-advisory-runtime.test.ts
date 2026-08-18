/**
 * H3 Gap 2 — extension-side runtime: the switch and the one-shot store read.
 *
 * The switch tests exist because this constant is DUPLICATED from the CLI
 * (`src/ext-vscode` is a separate npm package and cannot import `src/cli` — the
 * `G-ROOTDIR`/TS6059 wall the PE milestone hit six times). Duplication is only
 * safe if divergence is detectable, so the env-var NAME is pinned here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readPendingSubmitDecisionMirror,
  MIRROR_MAX_AGE_MS,
  isCursorSubmitAdvisoryEnabled,
  explainSubmitFlowGate,
  defaultIsProcessAlive,
  isWindsurfSubmitAdvisoryEnabled,
  readPendingSubmitDecision,
  peekPendingSubmitDecision,
  submitDecisionPath,
  WINDSURF_SUBMIT_ADVISORY_ENV,
  SUBMIT_FLOW_FLAG_FILENAME,
} from './submit-advisory-runtime.js';

const RECORD = {
  schemaVersion: 1,
  decisionId: 'd-1',
  replacementText: 'the picked option',
  createdAt: 1_700_000_000_000,
  blockIssuedAt: 1_699_999_999_000,
  hookPid: 4242,
  host: 'windsurf',
};

describe('the switch — must stay identical to the CLI half', () => {
  it('pins the env-var name so the duplicated constant cannot silently diverge', () => {
    // If someone renames one side, this fails and forces the other to follow.
    expect(WINDSURF_SUBMIT_ADVISORY_ENV).toBe('NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY');
    // Cross-package contract: the config-backed flag filename must equal the
    // CLI's submit-flow-config.ts SUBMIT_FLOW_FLAG_FILENAME. Divergence would
    // make the two halves read different files and silently disagree.
    expect(SUBMIT_FLOW_FLAG_FILENAME).toBe('submit-flow.json');
  });

  it('is enabled ONLY for the exact string "1"', () => {
    expect(isWindsurfSubmitAdvisoryEnabled({ [WINDSURF_SUBMIT_ADVISORY_ENV]: '1' })).toBe(true);
  });

  it.each(['0', 'true', 'TRUE', 'yes', '', ' 1', 'on'])('is disabled for %o', (v) => {
    // Hermetic: flag-reader stubbed (absent) so only env semantics are pinned.
    expect(isWindsurfSubmitAdvisoryEnabled({ [WINDSURF_SUBMIT_ADVISORY_ENV]: v }, () => false)).toBe(false);
  });

  it('is disabled when unset AND the flag file is absent — the pre-flag default', () => {
    expect(isWindsurfSubmitAdvisoryEnabled({}, () => false)).toBe(false);
  });

  it('falls through to the shipped flag file when the env var is unset', () => {
    // The config-backed switch (owner ruling 2026-08-12): env unset ⇒ the flag
    // decides. This is the SHIPPED state (install writes the flag ON).
    expect(isWindsurfSubmitAdvisoryEnabled({}, () => true)).toBe(true);
    // And '0' still overrides the flag OFF — the developer revert path.
    expect(isWindsurfSubmitAdvisoryEnabled({ [WINDSURF_SUBMIT_ADVISORY_ENV]: '0' }, () => true)).toBe(false);
  });

  it('reads the REAL process.env when no argument is given (the production path)', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, WINDSURF_SUBMIT_ADVISORY_ENV);
    const prev = process.env[WINDSURF_SUBMIT_ADVISORY_ENV];
    try {
      delete process.env[WINDSURF_SUBMIT_ADVISORY_ENV];
      // Flag reader stubbed: this pin is about WHICH env object is read.
      expect(isWindsurfSubmitAdvisoryEnabled(undefined, () => false)).toBe(false);
      process.env[WINDSURF_SUBMIT_ADVISORY_ENV] = '1';
      expect(isWindsurfSubmitAdvisoryEnabled(undefined, () => false)).toBe(true);
    } finally {
      if (had) process.env[WINDSURF_SUBMIT_ADVISORY_ENV] = prev as string;
      else delete process.env[WINDSURF_SUBMIT_ADVISORY_ENV];
    }
  });
});

describe('the store read — one-shot, fail-open', () => {
  it('parses a valid windsurf record and consumes it', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const got = await readPendingSubmitDecision('/p', {
      isProcessAlive: () => false,
      read: vi.fn().mockResolvedValue(JSON.stringify(RECORD)),
      remove,
    });
    expect(got?.replacementText).toBe('the picked option');
    expect(remove).toHaveBeenCalledWith(submitDecisionPath('/p'));
  });

  it('returns null when the file is absent — the common case, not an error', async () => {
    const got = await readPendingSubmitDecision('/p', {
      isProcessAlive: () => false,
      read: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    });
    expect(got).toBeNull();
  });

  it('returns null on malformed JSON — a half-written file must not crash the poller', async () => {
    const got = await readPendingSubmitDecision('/p', {
      isProcessAlive: () => false,
      read: vi.fn().mockResolvedValue('{"schemaVersion":1,"decision'),
    });
    expect(got).toBeNull();
  });

  it('returns null on a wrong schemaVersion', async () => {
    const got = await readPendingSubmitDecision('/p', {
      isProcessAlive: () => false,
      read: vi.fn().mockResolvedValue(JSON.stringify({ ...RECORD, schemaVersion: 2 })),
    });
    expect(got).toBeNull();
  });

  it('DROPS a cursor record — delivering it here would inject into the wrong host', async () => {
    const remove = vi.fn();
    const got = await readPendingSubmitDecision('/p', {
      isProcessAlive: () => false,
      read: vi.fn().mockResolvedValue(JSON.stringify({ ...RECORD, host: 'cursor' })),
      remove,
    });
    expect(got).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('still returns the record when deletion fails — cleanup failure must not lose a valid decision', async () => {
    const got = await readPendingSubmitDecision('/p', {
      isProcessAlive: () => false,
      read: vi.fn().mockResolvedValue(JSON.stringify(RECORD)),
      remove: vi.fn().mockRejectedValue(new Error('EPERM')),
    });
    expect(got?.decisionId).toBe('d-1');
  });

  it('consumes on read so a RESTARTED extension cannot replay an old decision', async () => {
    // The poller's decisionId dedup and stale-turn guard are per-process; only
    // deletion protects across a restart.
    const remove = vi.fn().mockResolvedValue(undefined);
    await readPendingSubmitDecision('/p', {
      isProcessAlive: () => false,
      read: vi.fn().mockResolvedValue(JSON.stringify(RECORD)),
      remove,
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('builds a per-root path so two workspaces cannot collide', () => {
    expect(submitDecisionPath('/a')).not.toBe(submitDecisionPath('/b'));
    expect(submitDecisionPath('/a')).toContain('.nexpath');
  });
});

describe('⭐ BLOCK/INJECTION RACE — proven, not assumed (H3 acceptance)', () => {
  // THE RACE: the hook persists this record BEFORE exit(2), and Windsurf only
  // cancels the prompt once the process actually exits. Injecting inside that
  // window submits the replacement while the ORIGINAL prompt is still live —
  // two prompts for one submission. pe-poller.ts's handledAt idiom does NOT
  // cover this: it stops re-delivery, not early delivery.
  const RECORD = JSON.stringify({
    schemaVersion: 1, decisionId: 'sd-1', replacementText: 'replacement',
    createdAt: 1_700_000_000_000, host: 'windsurf',
    blockIssuedAt: 1_699_999_999_000, hookPid: 4242,
  });

  it('does NOT deliver while the hook is still alive', async () => {
    const removed: string[] = [];
    const r = await readPendingSubmitDecision('/proj', {
      read: async () => RECORD,
      remove: async (p: string) => { removed.push(p); },
      isProcessAlive: (pid: number) => { expect(pid).toBe(4242); return true; },
    });
    expect(r).toBeNull();
    // AND it must survive: this reader is one-shot, so consuming then deferring
    // would destroy the decision permanently and the user's turn would vanish.
    expect(removed).toHaveLength(0);
  });

  it('delivers once the hook has exited — exit(2) is now guaranteed delivered', async () => {
    const removed: string[] = [];
    const r = await readPendingSubmitDecision('/proj', {
      read: async () => RECORD,
      remove: async (p: string) => { removed.push(p); },
      isProcessAlive: () => false,
    });
    expect(r?.replacementText).toBe('replacement');
    expect(removed).toHaveLength(1);
  });

  it('a deferred record is retried and delivered on a later poll', async () => {
    // Proves the deferral is a WAIT, not a drop.
    let alive = true;
    const deps = {
      read: async () => RECORD,
      remove: async () => {},
      isProcessAlive: () => alive,
    };
    expect(await readPendingSubmitDecision('/proj', deps)).toBeNull();
    alive = false;
    expect((await readPendingSubmitDecision('/proj', deps))?.decisionId).toBe('sd-1');
  });

  it('treats a NON-ESRCH probe error as ALIVE — the conservative direction', () => {
    // pid 1 (init/systemd) exists but is root-owned, so kill(1, 0) raises EPERM
    // for an unprivileged process. EPERM means the process EXISTS; only ESRCH
    // means gone. Reading EPERM as "dead" would reopen the double-prompt.
    // MUTATION GUARD: `return false` in the catch survives every other test.
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // n/a
    expect(defaultIsProcessAlive(1)).toBe(true);
  });

  it('rejects a record with no hookPid — cannot tell whether the hook exited', async () => {
    const noPid = JSON.parse(RECORD); delete noPid.hookPid;
    const r = await readPendingSubmitDecision('/proj', {
      read: async () => JSON.stringify(noPid),
      remove: async () => {},
      isProcessAlive: () => false,
    });
    expect(r).toBeNull();
  });
});

describe('defaultIsProcessAlive — cross-OS liveness probe', () => {
  it('reports THIS process as alive', () => {
    expect(defaultIsProcessAlive(process.pid)).toBe(true);
  });

  it('reports an unused pid as dead', () => {
    // Max pid on Linux is well below this; kill(pid, 0) yields ESRCH.
    expect(defaultIsProcessAlive(0x7ffffffe)).toBe(false);
  });
});

describe('⭐ BACKWARD COMPAT — switch OFF must construct nothing (structural pin)', () => {
  // extension.ts imports `vscode` so it cannot be unit-tested; the guarantee is
  // otherwise enforced only by reading, which is exactly how it would rot. Same
  // technique as the no-OpenAI import pin on the CLI side.
  const src = readFileSync(join(__dirname, 'extension.ts'), 'utf8');
  const lines = src.split('\n');
  const lineOf = (needle: string) => lines.findIndex((l) => l.includes(needle));
  const indentOf = (i: number) => lines[i].length - lines[i].trimStart().length;

  const gate = lines.findIndex((l) => l.includes('isWindsurfSubmitAdvisoryEnabled(') && l.includes('if ('));

  it('has exactly one switch-gate call site', () => {
    // Two gates would mean two policies; a future edit could relax one of them.
    const gates = lines.filter((l) => l.includes('isWindsurfSubmitAdvisoryEnabled(') && l.includes('if ('));
    expect(gates).toHaveLength(1);
    expect(gate).toBeGreaterThan(-1);
  });

  it('the Windsurf poller is still constructed only behind the gate', () => {
    // RC15 reshaped the gate from a block (`if (enabled) { ... }`) into an
    // early return inside the idempotent armer (`if (!enabled) return false;`)
    // so setup completion can retry arming on fresh installs. Construction is
    // unreachable when the gate returns: pin the early-return FORM plus the
    // ordering, instead of the old indentation relationship.
    // RC19 turned the one-line early return into a block (it now logs WHY the
    // flow is disarmed before returning), so match the guard + a `return false`
    // within the next few lines rather than a single literal line.
    expect(lines[gate]).toMatch(/if \(!isWindsurfSubmitAdvisoryEnabled\(process\.env\)\)/);
    expect(lines.slice(gate, gate + 4).join('\n')).toMatch(/return false;/);
    const at = lineOf('submitPoller = createSubmitHookPoller(');
    expect(at).toBeGreaterThan(gate);
  });

  it('⭐ the shared builder refuses to construct when disabled', () => {
    // H6 moved part of the guard into `buildSubmitAdvisory`, so "nested deeper
    // than the gate" no longer describes it. The real guard is this early
    // return: without it, a switched-off host would build a clipboard object and
    // a poller on every activation. Its behaviour is mutation-proven in
    // submit-advisory-wiring.test.ts; this pins that the early return exists.
    const body = src.slice(src.indexOf('function buildSubmitAdvisory('));
    expect(body.slice(0, 1200)).toMatch(/if \(!enabled\) return null;/);
  });

  it('⭐ each host guards its armer with its OWN switch reader — never the other\'s', () => {
    // Passing the Windsurf switch on the Cursor branch would tie two platforms
    // that must be enablable independently. RC15 moved the read from the
    // buildSubmitAdvisory argument into the armer's early-return gate.
    const cursorArmer = src.slice(src.indexOf('const armCursorSubmitFlow'), src.indexOf("armCursorSubmitFlow('activation')"));
    expect(cursorArmer).toMatch(/if \(!isCursorSubmitAdvisoryEnabled\(process\.env\)\)[\s\S]{0,200}?return false;/);
    expect(cursorArmer).not.toContain('isWindsurfSubmitAdvisoryEnabled');
    expect(cursorArmer).not.toMatch(/explainSubmitFlowGate\('windsurf'/);
    const windsurfArmer = src.slice(src.indexOf('const armWindsurfSubmitFlow'), src.indexOf("armWindsurfSubmitFlow('activation')"));
    expect(windsurfArmer).toMatch(/if \(!isWindsurfSubmitAdvisoryEnabled\(process\.env\)\)[\s\S]{0,200}?return false;/);
    expect(windsurfArmer).not.toContain('isCursorSubmitAdvisoryEnabled');
    expect(windsurfArmer).not.toMatch(/explainSubmitFlowGate\('cursor'/);
  });

  it('⭐ Cursor injects via cursorInject, NOT chatInputInject', () => {
    // cursorInject does clipboard -> raise -> FOCUS loop -> settle -> paste.
    // H1 proved the focus step is load-bearing: Enter only submits after focus.
    // chatInputInject skips all of it, so wiring that here would fail on real
    // Cursor for the exact reason already recorded in this milestone (a wrong
    // Cursor verdict that had to be withdrawn).
    expect(src).toMatch(/buildSubmitAdvisory\(\s*'cursor',[\s\S]{0,200}?cursorInject,?\s*\)/);
  });

  it('⭐ the shipping per-host injector shape is preserved', () => {
    // The old flow (injectIntoChat) picks windsurfInject / cursorInject /
    // chatInputInject per host and lets each own its internal strategy. The
    // submit path mirrors that rather than imposing one injector on both.
    expect(src).toMatch(/injectFn:[\s\S]{0,160}?cursorInject/);
  });

  it('the gate reads process.env directly — never a persisted config key', () => {
    // The hook doc's stated reason for the switch: internal, never surfaced by
    // `nexpath status`/`config`, never settable by an end user.
    expect(lines[gate]).toContain('process.env');
  });
});

describe('⭐ direct injection must be wired as PRIMARY on the submit path', () => {
  // The shipped wiring sent onInject straight to the clipboard delivery, so
  // chatInputInject was never called on the submit path and the fallback had
  // become the only path. extension.ts needs `vscode`, so this is pinned
  // structurally rather than by unit test.
  const src = readFileSync(join(__dirname, 'extension.ts'), 'utf8');

  it('injectDirect is a real injector, never the clipboard delivery', () => {
    // Written in H4 when injectDirect was hardcoded to chatInputInject. H6 made
    // it per-host (Windsurf: chatInputInject, Cursor: cursorInject), so the pin
    // now guards the PRINCIPLE rather than one function name: whatever is passed
    // as the primary must not be the clipboard path. The original defect was
    // exactly that - onInject went straight to delivery.inject, so the fallback
    // had silently become the only path.
    const m = src.match(/injectDirect:\s*([^\n,]+)/g) ?? [];
    expect(m.length).toBeGreaterThan(0);
    for (const line of m) expect(line).not.toContain('delivery.inject');
  });

  it('the clipboard remains wired only as the fallback', () => {
    const m = src.match(/fallbackClipboard:\s*\(([^)]*)\)\s*=>\s*([^\n,]+)/);
    expect(m?.[2]).toContain('delivery.inject');
  });

  it('auto-submit is gated on the injection having landed', () => {
    // Pressing Enter after a clipboard fallback would submit a composer the user
    // has not pasted into yet.
    expect(src).toMatch(/onSubmit:.*lastDeliveryLanded/s);
  });
});

describe('⭐ H6 — records are delivered only to the host they were written for', () => {
  const rec = (host: string) => JSON.stringify({
    schemaVersion: 1, decisionId: 'sd-1', replacementText: 'replacement',
    createdAt: 1_700_000_000_000, host,
    blockIssuedAt: 1_699_999_999_000, hookPid: 4242,
  });
  const deps = (expectedHost?: 'windsurf' | 'cursor', host = 'windsurf') => ({
    read: async () => rec(host),
    remove: async () => {},
    isProcessAlive: () => false,
    ...(expectedHost ? { expectedHost } : {}),
  });

  it('a cursor record IS delivered when running on Cursor', async () => {
    // Before H6 the reader dropped every cursor record unconditionally, so the
    // Cursor path could never have delivered - a silent dead end.
    const r = await readPendingSubmitDecision('/proj', deps('cursor', 'cursor') as never);
    expect(r?.replacementText).toBe('replacement');
  });

  it('a cursor record is DROPPED when running on Windsurf', async () => {
    // Cross-host delivery would inject into the wrong editor.
    expect(await readPendingSubmitDecision('/proj', deps('windsurf', 'cursor') as never)).toBeNull();
  });

  it('a windsurf record is DROPPED when running on Cursor', async () => {
    expect(await readPendingSubmitDecision('/proj', deps('cursor', 'windsurf') as never)).toBeNull();
  });

  it('defaults to windsurf when no host is given — H3 behaviour unchanged', async () => {
    expect((await readPendingSubmitDecision('/proj', deps(undefined, 'windsurf') as never))?.decisionId)
      .toBe('sd-1');
    expect(await readPendingSubmitDecision('/proj', deps(undefined, 'cursor') as never)).toBeNull();
  });
});

describe('⭐ peekPendingSubmitDecision — non-consuming, no liveness gate', () => {
  const REC = JSON.stringify({
    schemaVersion: 1, decisionId: 'sd-1', replacementText: 'replacement',
    createdAt: 1_700_000_000_000, host: 'windsurf',
    blockIssuedAt: 1_699_999_999_000, hookPid: 4242,
  });

  it('returns the record WITHOUT deleting it', async () => {
    // The whole point: the DS-bridge guard may ask before the submit poller has
    // consumed the decision; consuming here would destroy the delivery.
    const removed: string[] = [];
    const r = await peekPendingSubmitDecision('/proj', {
      read: async () => REC,
      remove: async (p: string) => { removed.push(p); },
    } as never);
    expect(r?.replacementText).toBe('replacement');
    expect(removed).toHaveLength(0);
  });

  it('does NOT gate on hookPid liveness — identifying, not delivering', async () => {
    // The reader defers delivery while the hook is alive; the peek must answer
    // even then, because the DS poller can tick inside that window.
    const r = await peekPendingSubmitDecision('/proj', {
      read: async () => REC,
      isProcessAlive: () => true,   // hook still alive — reader would defer
    } as never);
    expect(r?.decisionId).toBe('sd-1');
  });

  it('still drops a record for the wrong host', async () => {
    const cursorRec = JSON.stringify({ ...JSON.parse(REC), host: 'cursor' });
    await expect(peekPendingSubmitDecision('/proj', {
      read: async () => cursorRec,
    } as never)).resolves.toBeNull();
  });

  it('absent file ⇒ null, never a throw', async () => {
    await expect(peekPendingSubmitDecision('/proj', {
      read: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    } as never)).resolves.toBeNull();
  });
});

describe('⭐ H8 Finding 1 — the DS-bridge guard is actually WIRED (structural)', () => {
  // extension.ts imports `vscode`, so the wiring is pinned against source, the
  // same technique as the other pins in this file.
  const extSrc = readFileSync(join(__dirname, 'extension.ts'), 'utf8');

  it('the delivered-record store exists ONLY behind the submit switch', () => {
    // Constructed unconditionally, the shipped DS bridge would consult a guard
    // on every activation — new behaviour on the old path (R12).
    expect(extSrc).toMatch(/submitDeliveredStore = isWindsurfSubmitAdvisoryEnabled\(process\.env\)\s*\?\s*createInjectedRecordStore\(\)\s*:\s*null/);
  });

  it('onSelection consults the guard before bridging', () => {
    const sel = extSrc.slice(extSrc.indexOf('onSelection: async (prompt)'));
    const guardAt = sel.indexOf('isSubmitFlowReplacement(');
    const injectAt = sel.indexOf('injectIntoChat(prompt)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(injectAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(injectAt);
  });

  it('the guard is null-gated so the switch-off bridge is byte-identical in behaviour', () => {
    expect(extSrc).toMatch(/if \(submitDeliveredStore\) \{[\s\S]{0,400}?isSubmitFlowReplacement/);
  });

  it('the submit poller records successful deliveries for the guard', () => {
    const inj = extSrc.slice(extSrc.indexOf("onInject: async (text)"));
    expect(inj.slice(0, 2200)).toMatch(/submitDeliveredStore\.record\(root, text\)/);
  });
});

/**
 * RC15 (macOS tester run, 2026-08-14): on a fresh machine the extension
 * activates BEFORE `nexpath install` writes ~/.nexpath/submit-flow.json, so an
 * activation-time-only switch read left the submit flow permanently un-armed —
 * the hook blocked prompts and wrote decisions NOBODY delivered, and the old
 * advisory surface popped alongside the submit popups. Pin the late-arm wiring.
 */
describe('⭐ RC15 — fresh-install late arming (structural pin)', () => {
  const src = readFileSync(join(__dirname, 'extension.ts'), 'utf8');

  it('both host armers exist and register themselves as the late armer', () => {
    expect(src).toContain("armWindsurfSubmitFlow('activation')");
    expect(src).toContain('armSubmitFlowLate = armWindsurfSubmitFlow');
    expect(src).toContain("armCursorSubmitFlow('activation')");
    expect(src).toContain('armSubmitFlowLate = armCursorSubmitFlow');
  });

  it('setup completion retries arming (both the command and the auto-offer)', () => {
    expect(src).toMatch(/runSetupCommand\(context, log\)\.then\([\s\S]{0,120}?armSubmitFlowLate\?\.\('post-setup-command'\)/);
    expect(src).toMatch(/offerSetupIfNeeded\(context, log\)[\s\S]{0,160}?armSubmitFlowLate\?\.\('post-setup-offer'\)/);
  });

  it('a bounded re-check covers a manual `nexpath install` in a terminal', () => {
    expect(src).toMatch(/setInterval\(\(\) => \{\s*if \(armSubmitFlowLate\?\.\('late-flag-detected'\)\) clearInterval\(armRetry\);/);
    expect(src).toContain('setTimeout(() => clearInterval(armRetry), 600_000)');
  });

  it('the watcher suppression flags read LIVE state, not an activation-time const', () => {
    expect(src).toMatch(/get suppressDsAdvisory\(\) \{ return submitSurface\.active; \}/);
    expect(src).toMatch(/get suppressWatcherAuto\(\) \{ return submitSurface\.active; \}/);
    expect(src).not.toContain('const submitAdvisorySurfaceActive');
  });
});

/**
 * RC19 (Windows/Devin tester, 2026-08-17): the flow did not arm and the log
 * said NOTHING — the ENABLED line was simply absent. Root cause: the flag is
 * PER HOST and each host's installer writes only its own key, but the setup
 * verifier only checked that the FILE EXISTS, so a machine registered for the
 * other editor reported "already set up" forever. These pin the diagnosis
 * surface and the contract between explain() and the resolvers.
 */
describe('⭐ RC19 — explainSubmitFlowGate (never fail silently)', () => {
  const raw = (o: unknown) => () => JSON.stringify(o);

  it('⭐ names the per-host gap that broke Windows: file present, host key absent', () => {
    const g = explainSubmitFlowGate('windsurf', {}, raw({ cursor: true }));
    expect(g.enabled).toBe(false);
    expect(g.reason).toContain('no "windsurf" key');
    expect(g.reason).toContain('cursor');            // says what IS registered
    expect(g.reason).toContain('Nexpath: Set up CLI'); // says how to fix it
  });

  it('host=true ⇒ enabled with a positive reason', () => {
    const g = explainSubmitFlowGate('windsurf', {}, raw({ windsurf: true, cursor: true }));
    expect(g).toEqual({ enabled: true, reason: 'flag file has windsurf=true' });
  });

  it('deliberate opt-out is distinguished from "never registered"', () => {
    expect(explainSubmitFlowGate('cursor', {}, raw({ cursor: false })).reason).toContain('cursor=false');
  });

  it('missing / corrupt file each get their own actionable reason', () => {
    expect(explainSubmitFlowGate('cursor', {}, () => null).reason).toContain('not found or unreadable');
    expect(explainSubmitFlowGate('cursor', {}, () => '{oops').reason).toContain('not valid JSON');
  });

  it('env overrides win and are named as overrides', () => {
    expect(explainSubmitFlowGate('windsurf', { NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: '1' }, () => null))
      .toEqual({ enabled: true, reason: 'env override NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY=1 (forced ON)' });
    expect(explainSubmitFlowGate('cursor', { NEXPATH_CURSOR_PROMPTSUBMIT_ADVISORY: '0' }, raw({ cursor: true })).enabled)
      .toBe(false);
  });

  it('⭐ CONTRACT: explain() can never disagree with the shipped resolvers', () => {
    const cases: Array<[NodeJS.ProcessEnv, unknown]> = [
      [{}, { windsurf: true }], [{}, { cursor: true }], [{}, {}], [{}, { windsurf: false }],
      [{ NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: '1' }, {}],
      [{ NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: '0' }, { windsurf: true }],
    ];
    for (const [env, flags] of cases) {
      const readFlag = (h: 'cursor' | 'windsurf') => (flags as Record<string, unknown>)[h] === true;
      expect(explainSubmitFlowGate('windsurf', env, raw(flags)).enabled)
        .toBe(isWindsurfSubmitAdvisoryEnabled(env, readFlag));
      expect(explainSubmitFlowGate('cursor', env, raw(flags)).enabled)
        .toBe(isCursorSubmitAdvisoryEnabled(env, readFlag));
    }
  });
});

describe('⭐ RC19 — the setup verifier checks the PER-HOST flag (structural pin)', () => {
  const glue = readFileSync(join(__dirname, 'installer', 'vscode-glue.ts'), 'utf8');

  it('verifyHookRegistration parses the flag and requires THIS host to be true', () => {
    const fn = glue.slice(glue.indexOf('verifyHookRegistration: () =>'), glue.indexOf('getState: () =>'));
    expect(fn).toMatch(/JSON\.parse\(readFileSync\(flagFile/);
    expect(fn).toMatch(/flags\[agent\] !== true\) return false;/);
    // existence alone must NEVER again be the whole test
    expect(fn).not.toMatch(/if \(!existsSync\(join\(home, 'submit-flow\.json'\)\)\) return false;\s*if \(agent/);
  });

  it('the armers log a reason whenever they refuse to arm', () => {
    const ext = readFileSync(join(__dirname, 'extension.ts'), 'utf8');
    expect(ext).toMatch(/logGateOnce\('windsurf', explainSubmitFlowGate\('windsurf'/);
    expect(ext).toMatch(/logGateOnce\('cursor', explainSubmitFlowGate\('cursor'/);
    expect(ext).toContain('submit-time advisory NOT armed');
  });
});

/**
 * RC19b: there were TWO "already set up" gates and only the deeper one verified
 * on-disk registration — the shallow one (offerSetupIfNeeded) short-circuited
 * first, so a machine missing this editor's hook/flag reported "already set up"
 * forever and never self-healed (the Windows/Devin failure). One authority now.
 */
describe('⭐ RC19b — both setup gates verify registration (structural pin)', () => {
  const glue = readFileSync(join(__dirname, 'installer', 'vscode-glue.ts'), 'utf8');
  const offer = glue.slice(glue.indexOf('const hasGlobalCli = cliRuns'), glue.indexOf('export async function runSetupCommand'));

  it('the offer-level gate includes hookRegistered', () => {
    expect(offer).toMatch(/const hookRegistered = deps\.verifyHookRegistration\?\.\(\) \?\? true;/);
    expect(offer).toMatch(/state\.done[\s\S]{0,200}?cliReady && hookRegistered;/);
  });

  it('registration drift on a done install re-runs setup automatically (no prompt)', () => {
    expect(offer).toMatch(/if \(state\.done && !hookRegistered\)[\s\S]{0,400}?await runSetupFlow\(/);
  });

  it('a fresh (never-done) install still goes through the normal offer prompt', () => {
    expect(offer).toMatch(/showInformationMessage\(message, 'Set up', 'Later'\)/);
  });
});

/**
 * RC21: Windows/Devin executes ONLY the workspace-level `.windsurf/hooks.json`.
 * The extension must (a) tell the CLI which folder to register and (b) verify
 * that hook — otherwise a project opened later has no hook and nothing fires.
 */
describe('⭐ RC21 — Windows workspace hook is passed and verified (structural pin)', () => {
  const glue = readFileSync(join(__dirname, 'installer', 'vscode-glue.ts'), 'utf8');

  it('setup terminal carries NEXPATH_WORKSPACE_DIR', () => {
    expect(glue).toMatch(/setupEnv\.NEXPATH_WORKSPACE_DIR = ws;/);
  });

  it('verifyHookRegistration checks the workspace hook on win32', () => {
    const fn = glue.slice(glue.indexOf('verifyHookRegistration: () =>'), glue.indexOf('getState: () =>'));
    expect(fn).toMatch(/process\.platform === 'win32'/);
    expect(fn).toMatch(/join\(ws, '\.windsurf', 'hooks\.json'\)/);
    expect(fn).toMatch(/includes\('windsurf-hook'\)/);
  });
});

/**
 * RC19c (regression found in the 2026-08-17 verification pass): RC19 made the
 * verifier demand `flags[host] === true`, which turned the owner's documented
 * config-backed REVERT (set the host to `false`) into a self-healing loop —
 * setup would re-run and rewrite it back to `true`. An explicit `false` must be
 * honoured as a deliberate decision; only an ABSENT key means "never registered".
 */
describe('⭐ RC19c — an explicit false is a revert, not damage', () => {
  const glue = readFileSync(join(__dirname, 'installer', 'vscode-glue.ts'), 'utf8');
  const fn = glue.slice(glue.indexOf('verifyHookRegistration: () =>'), glue.indexOf('getState: () =>'));

  it('explicit false ⇒ registered (no re-run, revert preserved)', () => {
    expect(fn).toMatch(/if \(flags\[agent\] === false\) return true;/);
  });

  it('absent / non-true key ⇒ unregistered (repair)', () => {
    expect(fn).toMatch(/if \(flags\[agent\] !== true\) return false;/);
    expect(fn.indexOf('=== false) return true;')).toBeLessThan(fn.indexOf('!== true) return false;'));
  });
});

/**
 * RC22 — the cwd-independent handoff. The primary record lives under the HOOK's
 * `process.cwd()`; Cascade's payload carries no workspace, so on Windows (where
 * the only hook that fires is the workspace-level one) that cwd need not be the
 * folder the editor has open — the prompt gets blocked and the replacement is
 * written where no poller looks. The old flow never had this failure mode
 * because it handed off through the per-user store.
 */
describe('⭐ RC22 — user-level mirror handoff', () => {
  const rec = (over: Record<string, unknown> = {}) => JSON.stringify({
    schemaVersion: 1, decisionId: 'sd-1', replacementText: 'refined',
    createdAt: 1_000, blockIssuedAt: 900, hookPid: 4242, host: 'windsurf', ...over,
  });
  const base = (over: Record<string, unknown> = {}) => ({
    read: async () => rec(over.record as Record<string, unknown> ?? {}),
    remove: async () => { (over.removed as string[] | undefined)?.push('x'); },
    isProcessAlive: () => false,
    now: () => 1_500,
    path: '/home/u/.nexpath/submit-decision.json',
    expectedHost: 'windsurf' as const,
  });

  it('⭐ matching projectRoot is delivered (separator + drive-case insensitive)', async () => {
    const r = await readPendingSubmitDecisionMirror(
      ['C:\\Users\\Me\\proj'],
      { ...base({ record: { projectRoot: 'c:/Users/Me/proj/' } }) },
    );
    expect(r?.replacementText).toBe('refined');
  });

  it('⭐ no projectRoot + exactly one open root + fresh ⇒ delivered', async () => {
    const r = await readPendingSubmitDecisionMirror(['/only/root'], base());
    expect(r?.decisionId).toBe('sd-1');
  });

  it('a DIFFERENT project is never injected into this window', async () => {
    const r = await readPendingSubmitDecisionMirror(
      ['/my/project'],
      base({ record: { projectRoot: '/some/other/project' } }),
    );
    expect(r).toBeNull();
  });

  it('ambiguous (no root in the record, multiple open roots) ⇒ refused', async () => {
    const r = await readPendingSubmitDecisionMirror(['/a', '/b'], base());
    expect(r).toBeNull();
  });

  it('stale mirrors are swept, not delivered', async () => {
    const removed: string[] = [];
    const r = await readPendingSubmitDecisionMirror(['/only'], { ...base({ removed }), now: () => 1_000 + MIRROR_MAX_AGE_MS + 1 });
    expect(r).toBeNull();
    expect(removed.length).toBe(1);
  });

  it('wrong host is refused; a live hook defers (same guards as the primary)', async () => {
    expect(await readPendingSubmitDecisionMirror(['/only'], { ...base(), expectedHost: 'cursor' })).toBeNull();
    expect(await readPendingSubmitDecisionMirror(['/only'], { ...base(), isProcessAlive: () => true })).toBeNull();
  });

  it('absent mirror is a silent null (the common case)', async () => {
    const r = await readPendingSubmitDecisionMirror(['/only'], {
      ...base(), read: async () => { throw new Error('ENOENT'); },
    });
    expect(r).toBeNull();
  });

  it('⭐ the poller consults the mirror ONLY after the local file misses', () => {
    const ext = readFileSync(join(__dirname, 'extension.ts'), 'utf8');
    // both hosts: local first, `?? mirror`
    const matches = ext.match(/await readPendingSubmitDecision\([\s\S]{0,120}?\)\)\s*\?\?\s*\(await readPendingSubmitDecisionMirror\(/g);
    expect(matches?.length).toBe(2);
  });
});

/**
 * RC24 (Windows tester, 2026-08-18): three rounds of "Windows is broken" came
 * from a machine that had built `main` on a local branch merely NAMED like
 * ours — the prompt looked right, the build succeeded, the old flow ran, and
 * nothing in the product could contradict it. Activation now states its build.
 */
describe('⭐ RC24 — the extension identifies its own build', () => {
  it('activation logs a build line from a compile-time constant', () => {
    const ext = readFileSync(join(__dirname, 'extension.ts'), 'utf8');
    expect(ext).toMatch(/declare const __NEXPATH_BUILD__: string;/);
    expect(ext).toMatch(/log\(`\[nexpath\] build: \$\{typeof __NEXPATH_BUILD__ === 'string' \? __NEXPATH_BUILD__ : 'unknown'\}`\)/);
  });

  it('the bundler defines it from git and never fails the build without git', () => {
    const cfg = readFileSync(join(__dirname, '..', 'esbuild.config.mjs'), 'utf8');
    expect(cfg).toMatch(/define: \{ __NEXPATH_BUILD__: JSON\.stringify\(buildId\) \}/);
    expect(cfg).toMatch(/git rev-parse --short HEAD/);
    expect(cfg).toMatch(/catch \{\s*return 'unknown';/);
  });
});
