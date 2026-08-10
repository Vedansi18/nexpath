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
      read: vi.fn().mockResolvedValue(JSON.stringify(RECORD)),
      remove,
    });
    expect(got?.replacementText).toBe('the picked option');
    expect(remove).toHaveBeenCalledWith(submitDecisionPath('/p'));
  });

  it('returns null when the file is absent — the common case, not an error', async () => {
    const got = await readPendingSubmitDecision('/p', {
      read: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    });
    expect(got).toBeNull();
  });

  it('returns null on malformed JSON — a half-written file must not crash the poller', async () => {
    const got = await readPendingSubmitDecision('/p', {
      read: vi.fn().mockResolvedValue('{"schemaVersion":1,"decision'),
    });
    expect(got).toBeNull();
  });

  it('returns null on a wrong schemaVersion', async () => {
    const got = await readPendingSubmitDecision('/p', {
      read: vi.fn().mockResolvedValue(JSON.stringify({ ...RECORD, schemaVersion: 2 })),
    });
    expect(got).toBeNull();
  });

  it('DROPS a cursor record — delivering it here would inject into the wrong host', async () => {
    const remove = vi.fn();
    const got = await readPendingSubmitDecision('/p', {
      read: vi.fn().mockResolvedValue(JSON.stringify({ ...RECORD, host: 'cursor' })),
      remove,
    });
    expect(got).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('still returns the record when deletion fails — cleanup failure must not lose a valid decision', async () => {
    const got = await readPendingSubmitDecision('/p', {
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
