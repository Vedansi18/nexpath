import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Command } from 'commander';
import {
  awaitChild,
  handleWindsurfHookCli,
  registerWindsurfHookCommand,
  runWindsurfHookAction,
} from './windsurf-hook.js';

describe('handleWindsurfHookCli', () => {
  it('reads stdin and dispatches (event, raw, {cwd}) to the handler', async () => {
    const run = vi.fn().mockReturnValue({ action: 'auto' });
    const readStdin = vi.fn().mockResolvedValue('{"tool_info":{"user_prompt":"hi"}}');

    const r = await handleWindsurfHookCli(
      'pre_user_prompt',
      { project: '/explicit' },
      { run, readStdin },
    );

    expect(readStdin).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith('pre_user_prompt', '{"tool_info":{"user_prompt":"hi"}}', { cwd: '/explicit' });
    expect(r).toEqual({ action: 'auto' });
  });

  it('falls back to deps.cwd when --project is absent', async () => {
    const run = vi.fn().mockReturnValue({ action: 'stop' });
    await handleWindsurfHookCli('post_cascade_response', {}, {
      run,
      readStdin: () => Promise.resolve(''),
      cwd: '/fallback',
    });
    expect(run).toHaveBeenCalledWith('post_cascade_response', '', { cwd: '/fallback' });
  });
});

describe('awaitChild', () => {
  it('resolves immediately when there is no child', async () => {
    await expect(awaitChild(null)).resolves.toBeUndefined();
    await expect(awaitChild(undefined)).resolves.toBeUndefined();
  });

  it('resolves when the child exits', async () => {
    const child = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
    const p = awaitChild(child, 5000);
    (child as unknown as EventEmitter).emit('exit', 0);
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves when the child errors (never rejects)', async () => {
    const child = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
    const p = awaitChild(child, 5000);
    (child as unknown as EventEmitter).emit('error', new Error('spawn fail'));
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves via the timeout fallback if the child never exits', async () => {
    const child = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
    await expect(awaitChild(child, 1)).resolves.toBeUndefined();
  });
});

describe('runWindsurfHookAction — popup-raise gate', () => {
  // This gate is the whole of the Windsurf half of the foreground fix: the
  // extension's own raiser never runs here, because Windsurf spawns `stop`
  // through this hook rather than through ipc. Every raiser unit test proves
  // the title list in isolation; only these prove the raiser is invoked, on
  // the right event, and not on the wrong one.

  function harness(overrides: Partial<Parameters<typeof runWindsurfHookAction>[2]> = {}) {
    const raisePopup = vi.fn();
    const waitForChild = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const env: NodeJS.ProcessEnv = {};
    return {
      raisePopup, waitForChild, exit, env,
      deps: { raisePopup, waitForChild, exit, env, ...overrides },
    };
  }

  const withChild = (child: unknown) =>
    vi.fn().mockResolvedValue({ action: 'stop', child } as never);

  it('raises the popup on post_cascade_response when a child was spawned', async () => {
    const h = harness();
    await runWindsurfHookAction('post_cascade_response', {}, {
      ...h.deps,
      handle: withChild(new EventEmitter()),
    });
    expect(h.raisePopup).toHaveBeenCalledOnce();
  });

  it('does NOT raise the popup on pre_user_prompt (no popup is opened there)', async () => {
    const h = harness();
    await runWindsurfHookAction('pre_user_prompt', {}, {
      ...h.deps,
      handle: withChild(new EventEmitter()),
    });
    expect(h.raisePopup).not.toHaveBeenCalled();
  });

  it('does NOT raise the popup when no child was spawned', async () => {
    const h = harness();
    await runWindsurfHookAction('post_cascade_response', {}, {
      ...h.deps,
      handle: withChild(null),
    });
    expect(h.raisePopup).not.toHaveBeenCalled();
  });

  it('names the surface so Layer C labels the popup "Windsurf"', async () => {
    const h = harness();
    await runWindsurfHookAction('pre_user_prompt', {}, {
      ...h.deps,
      handle: withChild(null),
    });
    expect(h.env.NEXPATH_AGENT).toBe('windsurf');
  });

  it('awaits the Layer-C child before exiting', async () => {
    const h = harness();
    const child = new EventEmitter();
    await runWindsurfHookAction('post_cascade_response', {}, {
      ...h.deps,
      handle: withChild(child),
    });
    expect(h.waitForChild).toHaveBeenCalledWith(child);
    expect(h.waitForChild.mock.invocationCallOrder[0]).toBeLessThan(
      h.exit.mock.invocationCallOrder[0]!,
    );
  });

  it('never breaks Cascade — swallows a handler failure and still exits 0', async () => {
    const h = harness();
    await expect(
      runWindsurfHookAction('post_cascade_response', {}, {
        ...h.deps,
        handle: vi.fn().mockRejectedValue(new Error('handler blew up')),
      }),
    ).resolves.toBeUndefined();
    expect(h.raisePopup).not.toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('still exits 0 when raising the popup itself throws', async () => {
    const h = harness({ raisePopup: vi.fn(() => { throw new Error('no wmctrl'); }) });
    await expect(
      runWindsurfHookAction('post_cascade_response', {}, {
        ...h.deps,
        handle: withChild(new EventEmitter()),
      }),
    ).resolves.toBeUndefined();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('passes the project option through to the handler', async () => {
    const h = harness();
    const handle = withChild(null);
    await runWindsurfHookAction('pre_user_prompt', { project: '/proj' }, { ...h.deps, handle });
    expect(handle).toHaveBeenCalledWith('pre_user_prompt', { project: '/proj' });
  });
});

describe('registerWindsurfHookCommand', () => {
  it('registers a `windsurf-hook` command taking an <event> arg and --project', () => {
    const program = new Command();
    registerWindsurfHookCommand(program);
    const cmd = program.commands.find((c) => c.name() === 'windsurf-hook');
    expect(cmd).toBeDefined();
    // <event> positional is required
    expect(cmd!.registeredArguments.map((a) => a.name())).toContain('event');
    // --project option present
    expect(cmd!.options.some((o) => o.long === '--project')).toBe(true);
  });
});
