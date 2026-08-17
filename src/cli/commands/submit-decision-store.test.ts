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
  blockIssuedAt: 1_699_999_999_000,
  hookPid: 4242,
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
    // RC22 added `projectRoot` on BOTH sides (optional in the extension's
    // validator, which carries it through) so the cwd-independent user-level
    // mirror can be matched to the right editor window. The set is still
    // closed — an unknown field here would still fail this test.
    expect(Object.keys(parsed).sort()).toEqual(
      ['blockIssuedAt', 'createdAt', 'decisionId', 'hookPid', 'host', 'projectRoot', 'replacementText', 'schemaVersion'].sort(),
    );
    expect(parsed.projectRoot).toBe(INPUT.projectRoot);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.host).toBe('windsurf');
    expect(parsed.replacementText).toBe('the picked option');
    expect(parsed.blockIssuedAt).toBe(1_699_999_999_000);
    expect(parsed.hookPid).toBe(4242);
  });

  it('refuses to write without hookPid — the reader could not tell if the hook exited', async () => {
    // The reader defers injection while the hook is alive, to close the
    // block/injection race. With no pid it cannot make that call at all.
    const h = harness();
    const bad = { ...INPUT } as Record<string, unknown>;
    delete bad.hookPid;
    await expect(writeSubmitDecision(bad as never, h.deps)).rejects.toThrow(/hookPid/);
    expect(h.writes).toHaveLength(0);
  });

  it('refuses to write when blockIssuedAt is missing — JSON.stringify would drop it', async () => {
    // The field would simply vanish from the record, the extension validator
    // would reject it, and a real decision would be silently lost. This is why
    // the field-set pin above did NOT catch the omission on its own.
    const h = harness();
    const bad = { ...INPUT } as Record<string, unknown>;
    delete bad.blockIssuedAt;
    await expect(writeSubmitDecision(bad as never, h.deps)).rejects.toThrow(/blockIssuedAt/);
    expect(h.writes).toHaveLength(0);
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

/**
 * RC22: the primary record is workspace-relative and therefore depends on the
 * hook's cwd matching the editor's workspace — which Cascade's payload cannot
 * tell us and Windows/Devin does not guarantee. The user-level mirror removes
 * that dependency (the property the OLD flow had via the per-user store).
 */
describe('⭐ RC22 — user-level mirror', () => {
  const input = {
    projectRoot: '/proj', decisionId: 'sd-1', replacementText: 'refined',
    createdAt: 111, host: 'windsurf' as const, blockIssuedAt: 110, hookPid: 7,
  };

  it('writes BOTH the project-local record and the mirror, each atomically', async () => {
    const writes: Array<[string, string]> = [];
    const renames: Array<[string, string]> = [];
    await writeSubmitDecision(input, {
      mkdirFn: async () => {},
      writeFn: async (p, d) => { writes.push([p, d]); },
      renameFn: async (a, b) => { renames.push([a, b]); },
      mirrorPath: () => '/home/u/.nexpath/submit-decision.json',
    });
    expect(renames.map((r) => r[1])).toEqual([
      submitDecisionPath('/proj'),
      '/home/u/.nexpath/submit-decision.json',
    ]);
    expect(writes.every(([p]) => p.endsWith('.tmp'))).toBe(true);
  });

  it('⭐ the mirror carries projectRoot so it can be matched to the right window', async () => {
    const bodies: string[] = [];
    await writeSubmitDecision(input, {
      mkdirFn: async () => {}, writeFn: async (_p, d) => { bodies.push(d); }, renameFn: async () => {},
      mirrorPath: () => '/home/u/.nexpath/submit-decision.json',
    });
    for (const b of bodies) expect(JSON.parse(b).projectRoot).toBe('/proj');
  });

  it('⭐ a mirror failure NEVER fails the block (primary already landed)', async () => {
    let n = 0;
    await expect(writeSubmitDecision(input, {
      mkdirFn: async () => {},
      writeFn: async () => { n += 1; if (n > 1) throw new Error('EPERM mirror'); },
      renameFn: async () => {},
      mirrorPath: () => '/home/u/.nexpath/submit-decision.json',
    })).resolves.toBeUndefined();
  });

  it('a primary failure still throws (the decider must fall back to allow)', async () => {
    await expect(writeSubmitDecision(input, {
      mkdirFn: async () => {}, writeFn: async () => { throw new Error('EPERM primary'); }, renameFn: async () => {},
      mirrorPath: () => '/home/u/.nexpath/submit-decision.json',
    })).rejects.toThrow(/EPERM primary/);
  });
});
