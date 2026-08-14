import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Command } from 'commander';
import {
  awaitChild,
  handleWindsurfHookCli,
  registerWindsurfHookCommand,
  runWindsurfHookAction,
  isReplacementEcho,
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
      // Hermetic: the echo-check default opens the real store.
      deps: { raisePopup, waitForChild, exit, env, checkReplacementEcho: async () => false, ...overrides },
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

/**
 * VED-PE-10 echo skip — Windsurf half (see cursor-hook.test.ts for the live
 * failure narrative). On an echo the deferred submit decision is never armed:
 * auto still runs (Layer C's guard consumes the synthetic prompt), but no
 * popup opens and the hook exits 0 exactly like the old flow.
 */
describe('VED-PE-10 — replacement echo never re-opens the submit popup', () => {
  const GATE_ENV = { NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY: '1' };
  const PROMPT_PAYLOAD = JSON.stringify({ tool_info: { user_prompt: 'echo me' } });

  it('echo: exits 0 even when the decider would block', async () => {
    const exits: number[] = [];
    const decide = vi.fn(async () => 'block' as const);
    await runWindsurfHookAction('pre_user_prompt', { project: '/proj' }, {
      env: GATE_ENV,
      checkReplacementEcho: async () => true,
      readStdin: async () => PROMPT_PAYLOAD,
      decidePromptSubmit: decide,
      handle: async () => ({ child: null } as never),
      waitForChild: async () => {},
      exit: (c: number) => { exits.push(c); },
    } as never);
    expect(decide).not.toHaveBeenCalled();   // decision never armed
    expect(exits).toEqual([0]);              // old-flow exit, no block
  });

  it('non-echo: the deferred decision still runs', async () => {
    const exits: number[] = [];
    const decide = vi.fn(async () => 'allow' as const);
    await runWindsurfHookAction('pre_user_prompt', { project: '/proj' }, {
      env: GATE_ENV,
      checkReplacementEcho: async () => false,
      readStdin: async () => PROMPT_PAYLOAD,
      decidePromptSubmit: decide,
      handle: async () => ({ child: null } as never),
      waitForChild: async () => {},
      exit: (c: number) => { exits.push(c); },
    } as never);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });
});

describe('isReplacementEcho — store-backed echo detection', () => {
  const state = (last: string | null) => ({ current: { lastInjectedPrompt: last } });

  it('true when the prompt equals lastInjectedPrompt', async () => {
    await expect(isReplacementEcho('/proj', 'the replacement', {
      openStore: async () => ({}),
      closeStore: () => {},
      loadState: () => state('the replacement'),
    })).resolves.toBe(true);
  });

  it('false on a different prompt', async () => {
    await expect(isReplacementEcho('/proj', 'a fresh user prompt', {
      openStore: async () => ({}),
      closeStore: () => {},
      loadState: () => state('the replacement'),
    })).resolves.toBe(false);
  });

  it('false (short-circuit, no store open) for an empty prompt or missing project', async () => {
    const openStore = vi.fn();
    await expect(isReplacementEcho('/proj', '   ', { openStore } as never)).resolves.toBe(false);
    await expect(isReplacementEcho(undefined, 'text', { openStore } as never)).resolves.toBe(false);
    expect(openStore).not.toHaveBeenCalled();
  });

  it('fails open (false) when the store cannot be opened', async () => {
    await expect(isReplacementEcho('/proj', 'text', {
      openStore: async () => { throw new Error('locked'); },
    })).resolves.toBe(false);
  });
});

/**
 * RC12 (live block LOOP, 2026-08-13): the DS bridge re-injects the replacement
 * DECORATED (an @[nexpath:advisory] prefix + concatenation), so exact equality
 * missed the echo and the hook blocked its own replacement repeatedly. The
 * echo check now matches on normalised containment with a length floor.
 */
describe('⭐ RC12 — decorated replacements still register as echoes', () => {
  const BODY = 'My original request (verbatim): make me a booking website where customers can schedule appointments and pay online. Context And Constraints: carry forward environment facts.';
  const ports = (last: string | null) => ({
    openStore: async () => ({}),
    closeStore: () => {},
    loadState: () => ({ current: { lastInjectedPrompt: last } }),
  });

  it('exact match still echoes (fast path)', async () => {
    await expect(isReplacementEcho('/proj', BODY, ports(BODY))).resolves.toBe(true);
  });

  it('⭐ bridge-decorated resubmit (prefix + suffix) echoes via containment', async () => {
    const decorated = `guidance.@[nexpath:advisory] ${BODY} — attached context`;
    await expect(isReplacementEcho('/proj', decorated, ports(BODY))).resolves.toBe(true);
  });

  it('whitespace-normalised variants echo', async () => {
    const reflowed = BODY.replace(/ /g, '  ').replace('Context', '\nContext');
    await expect(isReplacementEcho('/proj', reflowed, ports(BODY))).resolves.toBe(true);
  });

  it('short prompts NEVER fuzzily skip (length floor)', async () => {
    await expect(isReplacementEcho('/proj', 'fix it', ports('fix'))).resolves.toBe(false);
    await expect(isReplacementEcho('/proj', 'a genuinely new user prompt', ports('new user'))).resolves.toBe(false);
  });

  it('a genuinely different long prompt is not an echo', async () => {
    const other = 'Completely different request about building an inventory tracker with barcode scanning and stock reports for warehouse staff members.';
    await expect(isReplacementEcho('/proj', other, ports(BODY))).resolves.toBe(false);
  });
});

/**
 * RC12 primary root cause: the registered hook command has no `--project`, so
 * the echo check received `undefined` and bailed before reading the store —
 * the skip NEVER fired in production. Pin that the action resolves the echo
 * projectRoot with the same `opts.project ?? process.cwd()` chain the stop
 * decider uses when writing `lastInjectedPrompt`.
 */
describe('⭐ RC12 — echo check projectRoot resolution', () => {
  it('no --project ⇒ echo check gets process.cwd(), NOT undefined', async () => {
    const seen: Array<string | undefined> = [];
    const payload = JSON.stringify({ tool_info: { user_prompt: 'a genuinely long prompt body for the echo resolution pin' } });
    await runWindsurfHookAction('pre_user_prompt', {}, {
      readStdin: async () => payload,
      readFlagFile: () => JSON.stringify({ windsurf: true }),
      checkReplacementEcho: async (root, _text) => { seen.push(root); return true; }, // echo ⇒ nothing else spawns
      handle: async () => ({ exitCode: 0 }),
      logEvent: () => {},
      exit: () => {},
    });
    expect(seen).toEqual([process.cwd()]);
  });

  it('--project wins over cwd when supplied', async () => {
    const seen: Array<string | undefined> = [];
    const payload = JSON.stringify({ tool_info: { user_prompt: 'a genuinely long prompt body for the echo resolution pin' } });
    await runWindsurfHookAction('pre_user_prompt', { project: '/explicit/root' }, {
      readStdin: async () => payload,
      readFlagFile: () => JSON.stringify({ windsurf: true }),
      checkReplacementEcho: async (root, _text) => { seen.push(root); return true; },
      handle: async () => ({ exitCode: 0 }),
      logEvent: () => {},
      exit: () => {},
    });
    expect(seen).toEqual(['/explicit/root']);
  });
});
