/**
 * H3 Gap 2 — extension-side runtime: the switch and the one-shot store read.
 *
 * The switch tests exist because this constant is DUPLICATED from the CLI
 * (`src/ext-vscode` is a separate npm package and cannot import `src/cli` — the
 * `G-ROOTDIR`/TS6059 wall the PE milestone hit six times). Duplication is only
 * safe if divergence is detectable, so the env-var NAME is pinned here.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  defaultIsProcessAlive,
  isWindsurfSubmitAdvisoryEnabled,
  readPendingSubmitDecision,
  submitDecisionPath,
  WINDSURF_SUBMIT_ADVISORY_ENV,
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
  });

  it('is enabled ONLY for the exact string "1"', () => {
    expect(isWindsurfSubmitAdvisoryEnabled({ [WINDSURF_SUBMIT_ADVISORY_ENV]: '1' })).toBe(true);
  });

  it.each(['0', 'true', 'TRUE', 'yes', '', ' 1', 'on'])('is disabled for %o', (v) => {
    expect(isWindsurfSubmitAdvisoryEnabled({ [WINDSURF_SUBMIT_ADVISORY_ENV]: v })).toBe(false);
  });

  it('is disabled when unset — THE SHIPPED DEFAULT, so the old flow is untouched', () => {
    expect(isWindsurfSubmitAdvisoryEnabled({})).toBe(false);
  });

  it('reads the REAL process.env when no argument is given (the production path)', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, WINDSURF_SUBMIT_ADVISORY_ENV);
    const prev = process.env[WINDSURF_SUBMIT_ADVISORY_ENV];
    try {
      delete process.env[WINDSURF_SUBMIT_ADVISORY_ENV];
      expect(isWindsurfSubmitAdvisoryEnabled()).toBe(false);
      process.env[WINDSURF_SUBMIT_ADVISORY_ENV] = '1';
      expect(isWindsurfSubmitAdvisoryEnabled()).toBe(true);
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
