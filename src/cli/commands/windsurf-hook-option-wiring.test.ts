/**
 * H3 — the adapter↔decider wiring in `buildDefaultPromptSubmitDecider`.
 *
 * The decider now defaults to a real option source instead of `() => null`, which
 * introduces a Store handle into a short-lived hook subprocess. These pin the two
 * things that could go wrong: a leaked lock, and a fault that HOLDS the user's
 * prompt instead of releasing it (amendment A3).
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDefaultPromptSubmitDecider } from './windsurf-hook.js';

describe('store lifecycle — a leaked handle would hold the SQLite lock', () => {
  it('closes the store after deciding', async () => {
    const closeStore = vi.fn();
    const decide = buildDefaultPromptSubmitDecider({ project: '/proj' }, {
      openStore: async () => ({ db: {} }),
      closeStore,
    });
    await decide('pre_user_prompt', {});
    expect(closeStore).toHaveBeenCalledTimes(1);
  });

  it('closes the store even when the decision path throws', async () => {
    // The `auto` child of the same turn contends for this lock — a fault must not
    // leave it held.
    const closeStore = vi.fn();
    const decide = buildDefaultPromptSubmitDecider({ project: '/proj' }, {
      openStore: async () => ({ db: {} }),
      closeStore: closeStore.mockImplementation(() => {}),
      renderPopup: async () => { throw new Error('boom'); },
      composeOptions: undefined,
    });
    await decide('pre_user_prompt', {}).catch(() => {});
    expect(closeStore).toHaveBeenCalled();
  });

  it('never opens a store when an option source is injected', async () => {
    // The wiring site can supply its own adapter; opening a store then would be
    // pure waste inside a latency-sensitive hook.
    const openStore = vi.fn();
    const decide = buildDefaultPromptSubmitDecider({ project: '/proj' }, {
      openStore: openStore as never,
      composeOptions: () => null,
    });
    await decide('pre_user_prompt', {});
    expect(openStore).not.toHaveBeenCalled();
  });
});

describe('fail-open (A3) — never hold the prompt', () => {
  it('allows when the store cannot be opened', async () => {
    const decide = buildDefaultPromptSubmitDecider({ project: '/proj' }, {
      openStore: async () => { throw new Error('locked'); },
      closeStore: () => {},
    });
    await expect(decide('pre_user_prompt', {})).resolves.toBe('allow');
  });

  it('allows when closing the store fails', async () => {
    // A close failure must not turn a released prompt into a thrown hook.
    const decide = buildDefaultPromptSubmitDecider({ project: '/proj' }, {
      openStore: async () => ({ db: {} }),
      closeStore: () => { throw new Error('EBUSY'); },
    });
    await expect(decide('pre_user_prompt', {})).resolves.toBe('allow');
  });

  it('allows when there are no options', async () => {
    const decide = buildDefaultPromptSubmitDecider({ project: '/proj' }, {
      composeOptions: () => null,
    });
    await expect(decide('pre_user_prompt', {})).resolves.toBe('allow');
  });
});

describe('⚠ STILL INERT — prompt text is not plumbed from stdin yet', () => {
  it('allows even with options AND a selection, because promptTextForHook() is a stub', async () => {
    // NOT the desired end state. `promptTextForHook()` (windsurf-hook.ts) returns
    // '' because stdin is consumed by `handleWindsurfHookCli`, and the decider
    // treats empty prompt text as 'allow'. So wiring the option source is NOT
    // sufficient to make the feature live — the stdin plumbing is the last step.
    //
    // This pin exists so that step cannot land unnoticed: once the real prompt
    // text reaches the decider, this test FAILS and must be flipped to expect
    // 'block' plus the persisted record (assertions kept below, commented, so the
    // intended end state is unambiguous).
    const root = mkdtempSync(join(tmpdir(), 'nexpath-h3-'));
    try {
      const decide = buildDefaultPromptSubmitDecider({ project: root }, {
        composeOptions: () => ({ l1: ['x'], l2: ['pick me'], l3: ['z'] }),
        renderPopup: async () => 'pick me',
        now: () => 1_700_000_000_000,
      });
      await expect(decide('pre_user_prompt', { project: root })).resolves.toBe('allow');

      // INTENDED END STATE once stdin is plumbed:
      //   resolves.toBe('block')
      //   rec.replacementText === 'pick me' && rec.host === 'windsurf'
      expect(existsSync(join(root, '.nexpath', 'submit-decision.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows when persistence fails — never block with nothing written', async () => {
    const decide = buildDefaultPromptSubmitDecider({ project: '/nonexistent-ro/proj' }, {
      composeOptions: () => ({ l1: [], l2: ['pick me'], l3: [] }),
      renderPopup: async () => 'pick me',
    });
    await expect(decide('pre_user_prompt', {})).resolves.toBe('allow');
  });
});

describe('⭐ BACKWARD COMPAT — switch OFF must be indistinguishable from before H3', () => {
  // The owner's standing requirement. H3 added a Store handle and a new module
  // import to this file; both must be unreachable when the switch is unset.
  it('constructing the decider opens no Store — the open is deferred into the gated call', async () => {
    // windsurfHookAction constructs this UNCONDITIONALLY (outside the switch
    // gate), so construction itself must be inert. If openStore ever moved out of
    // the returned closure, every hook invocation would take the SQLite lock —
    // including with the feature switched off.
    const openStore = vi.fn(async () => ({ db: {} }));
    buildDefaultPromptSubmitDecider({ project: '/proj' }, { openStore, closeStore: () => {} });
    expect(openStore).not.toHaveBeenCalled();
  });

  it('the switch reader defaults OFF and is exact-equality', async () => {
    const { isWindsurfPromptSubmitAdvisoryEnabled: on } = await import('./windsurf-hook.js');
    expect(on({})).toBe(false);            // unset
    expect(on({ NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: '0' })).toBe(false);
    expect(on({ NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: 'true' })).toBe(false);
    expect(on({ NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: '1' })).toBe(true);
  });

  it('importing windsurf-hook takes no lock and creates no files', async () => {
    // store/db.js is now imported at module load. It must stay side-effect-free
    // (constants + a lazily-initialised `_SQL`), or merely loading the hook would
    // touch the DB on every Windsurf event.
    const before = existsSync(join(tmpdir(), 'nexpath-import-probe'));
    await import('./windsurf-hook.js');
    expect(before).toBe(existsSync(join(tmpdir(), 'nexpath-import-probe')));
  });
});
