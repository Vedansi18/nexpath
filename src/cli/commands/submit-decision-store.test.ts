/**
 * H3 Gap 2b — CLI-side persistence, and the cross-package contract pin.
 *
 * The record shape and path are DUPLICATED between `src/cli` and `src/ext-vscode`
 * because the two are separate npm packages that cannot import each other (the
 * `G-ROOTDIR`/TS6059 wall). Duplication is only safe if divergence is detectable,
 * so this suite pins the literal path segments and every field name. If either
 * side is edited alone, these fail — instead of the handoff silently breaking at
 * runtime, which is far more expensive to diagnose.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  writeSubmitDecision,
  submitDecisionPath,
  SUBMIT_DECISION_SCHEMA_V1,
} from './submit-decision-store.js';

function harness() {
  const writes: Array<{ path: string; data: string }> = [];
  const renames: Array<{ from: string; to: string }> = [];
  const mkdirs: string[] = [];
  return {
    writes, renames, mkdirs,
    deps: {
      mkdirFn: async (d: string) => { mkdirs.push(d); },
      writeFn: async (p: string, d: string) => { writes.push({ path: p, data: d }); },
      renameFn: async (from: string, to: string) => { renames.push({ from, to }); },
    },
  };
}

const INPUT = {
  projectRoot: '/proj',
  decisionId: 'sd-1',
  replacementText: 'the picked option',
  createdAt: 1_700_000_000_000,
  host: 'windsurf' as const,
};

describe('cross-package contract — must match the extension side exactly', () => {
  it('pins the path convention', () => {
    // Mirror of `submitDecisionPath` in src/ext-vscode/src/submit-advisory-runtime.ts.
    expect(submitDecisionPath('/proj')).toBe('/proj/.nexpath/submit-decision.json');
  });

  it('pins the schema version', () => {
    expect(SUBMIT_DECISION_SCHEMA_V1).toBe(1);
  });

  it('writes exactly the fields the extension validator requires — no more, no fewer', async () => {
    const h = harness();
    await writeSubmitDecision(INPUT, h.deps);
    const parsed = JSON.parse(h.writes[0].data);
    // The extension's parseSubmitDecisionRecordV1 rejects a record missing any of
    // these, and drops unknown extras — so the sets must agree.
    expect(Object.keys(parsed).sort()).toEqual(
      ['createdAt', 'decisionId', 'host', 'replacementText', 'schemaVersion'].sort(),
    );
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.host).toBe('windsurf');
    expect(parsed.replacementText).toBe('the picked option');
  });
});

describe('atomic write — the extension polls and must never see a torn file', () => {
  it('writes to a temp path then renames onto the final path', async () => {
    const h = harness();
    await writeSubmitDecision(INPUT, h.deps);
    const finalPath = submitDecisionPath('/proj');
    expect(h.writes[0].path).toBe(`${finalPath}.tmp`);
    expect(h.renames[0]).toEqual({ from: `${finalPath}.tmp`, to: finalPath });
  });

  it('never writes directly to the final path', async () => {
    const h = harness();
    await writeSubmitDecision(INPUT, h.deps);
    expect(h.writes.some((w) => w.path === submitDecisionPath('/proj'))).toBe(false);
  });

  it('creates the .nexpath directory first', async () => {
    const h = harness();
    await writeSubmitDecision(INPUT, h.deps);
    expect(h.mkdirs[0]).toBe('/proj/.nexpath');
  });
});

describe('failure behaviour — throws so the decider can fail OPEN', () => {
  it('refuses an empty replacement rather than writing one', async () => {
    const h = harness();
    await expect(writeSubmitDecision({ ...INPUT, replacementText: '' }, h.deps)).rejects.toThrow();
    expect(h.writes).toHaveLength(0);
  });

  it('propagates a write failure — swallowing it would let the decider block with nothing written', async () => {
    // This is the load-bearing behaviour: the decider treats a persist failure as
    // 'allow'. If this resolved silently, a prompt would be cancelled with no
    // replacement to inject and the user's turn would vanish.
    await expect(writeSubmitDecision(INPUT, {
      mkdirFn: async () => {},
      writeFn: vi.fn().mockRejectedValue(new Error('ENOSPC')),
      renameFn: async () => {},
    })).rejects.toThrow('ENOSPC');
  });

  it('propagates a rename failure for the same reason', async () => {
    await expect(writeSubmitDecision(INPUT, {
      mkdirFn: async () => {},
      writeFn: async () => {},
      renameFn: vi.fn().mockRejectedValue(new Error('EXDEV')),
    })).rejects.toThrow('EXDEV');
  });
});
