import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import {
  spawnAuto,
  spawnStop,
  resolveSpawnEnv,
  NexpathBinaryNotFoundError,
  NexpathMalformedPayloadError,
  describeMalformedPayload,
} from './ipc.js';

interface FakeChildOptions {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number;
  errorBeforeClose?: Error;
}

function makeFakeChild(opts: FakeChildOptions = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
  };
  child.stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });

  // `emit('data', ...)` synchronously invokes any registered listeners on the
  // stream, which is what we need so the consumer's data handler has accumulated
  // its buffer before we emit 'close'. `push()` buffers asynchronously and
  // would deliver the data after 'close' fires.
  queueMicrotask(() => {
    if (opts.errorBeforeClose) {
      child.emit('error', opts.errorBeforeClose);
      return;
    }
    for (const c of opts.stdoutChunks ?? []) child.stdout.emit('data', Buffer.from(c));
    for (const c of opts.stderrChunks ?? []) child.stderr.emit('data', Buffer.from(c));
    child.emit('close', opts.exitCode ?? 0);
  });

  return child;
}

describe('spawnAuto', () => {
  it('resolves when the process exits with code 0', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
    await expect(
      spawnAuto('hi', 'sess-1', { spawnFn: spawnFn as never }),
    ).resolves.toBeUndefined();
    expect(spawnFn).toHaveBeenCalledWith(
      'nexpath',
      ['auto'],
      expect.any(Object),
    );
  });

  it('includes --db argument when dbPath is provided', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
    await spawnAuto('p', 's', { spawnFn: spawnFn as never, dbPath: '/tmp/x.db' });
    expect(spawnFn).toHaveBeenCalledWith(
      'nexpath',
      ['auto', '--db', '/tmp/x.db'],
      expect.any(Object),
    );
  });

  it('uses binaryPath override over default "nexpath"', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
    await spawnAuto('p', 's', {
      spawnFn: spawnFn as never,
      binaryPath: '/usr/local/bin/nexpath',
    });
    expect(spawnFn).toHaveBeenCalledWith(
      '/usr/local/bin/nexpath',
      ['auto'],
      expect.any(Object),
    );
  });

  it('passes opts.cwd as the spawned process cwd (so Layer C resolves --project correctly)', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
    await spawnAuto('p', 's', {
      spawnFn: spawnFn as never,
      cwd: '/some/workspace/path',
    });
    const opts = spawnFn.mock.calls[0]![2] as { cwd?: string };
    expect(opts.cwd).toBe('/some/workspace/path');
  });

  it('defaults the spawned process cwd to process.cwd() when opts.cwd is omitted', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
    await spawnAuto('p', 's', { spawnFn: spawnFn as never });
    const opts = spawnFn.mock.calls[0]![2] as { cwd?: string };
    expect(opts.cwd).toBe(process.cwd());
  });

  it('rejects with NexpathBinaryNotFoundError when the child emits error', async () => {
    const enoent = Object.assign(new Error('spawn nexpath ENOENT'), {
      code: 'ENOENT',
    });
    const spawnFn = vi.fn(() => makeFakeChild({ errorBeforeClose: enoent }));
    await expect(
      spawnAuto('p', 's', { spawnFn: spawnFn as never }),
    ).rejects.toBeInstanceOf(NexpathBinaryNotFoundError);
  });

  it('rejects with a clear message when the process exits non-zero', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({ exitCode: 1, stderrChunks: ['bad stuff\n'] }),
    );
    await expect(
      spawnAuto('p', 's', { spawnFn: spawnFn as never }),
    ).rejects.toThrow(/exited with code 1/);
  });
});

describe('spawnStop', () => {
  it('returns the selected prompt from Layer C\'s {decision:"block", reason} output', async () => {
    // This is the ONLY shape Layer C's `nexpath stop` writes to stdout — on
    // selection in the terminal popup. `reason` is the chosen option text.
    const out = { decision: 'block', reason: 'Run the full test suite for this phase.' };
    const spawnFn = vi.fn(() =>
      makeFakeChild({
        stdoutChunks: [JSON.stringify(out)],
        exitCode: 0,
      }),
    );
    const result = await spawnStop('s', { spawnFn: spawnFn as never });
    expect(result).toEqual({ selectedPrompt: 'Run the full test suite for this phase.' });
  });

  it('resolves null when stdout is valid JSON but not the selection shape', async () => {
    // Any non-{decision:block} JSON carries no actionable selection.
    const spawnFn = vi.fn(() =>
      makeFakeChild({ stdoutChunks: [JSON.stringify({ decision: 'approve' })], exitCode: 0 }),
    );
    const result = await spawnStop('s', { spawnFn: spawnFn as never });
    expect(result).toBeNull();
  });

  it('resolves null when {decision:"block"} has an empty reason', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({ stdoutChunks: [JSON.stringify({ decision: 'block', reason: '' })], exitCode: 0 }),
    );
    const result = await spawnStop('s', { spawnFn: spawnFn as never });
    expect(result).toBeNull();
  });

  it('resolves null when stdout is empty (no selection / no advisory)', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ stdoutChunks: [], exitCode: 0 }));
    const result = await spawnStop('s', { spawnFn: spawnFn as never });
    expect(result).toBeNull();
  });

  it('resolves null when stdout is only whitespace', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({ stdoutChunks: ['  \n  \t  '], exitCode: 0 }),
    );
    const result = await spawnStop('s', { spawnFn: spawnFn as never });
    expect(result).toBeNull();
  });

  it('rejects with NexpathMalformedPayloadError when stdout is non-empty but not JSON', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({ stdoutChunks: ['not json {{'], exitCode: 0 }),
    );
    await expect(
      spawnStop('s', { spawnFn: spawnFn as never }),
    ).rejects.toBeInstanceOf(NexpathMalformedPayloadError);
  });

  // BUG-VEDANSI-AR9-G1 vector 2 (`transport_channel_violation`). The stop
  // stdout is `{decision:'block', reason:<body>}` — on the PE path that reason
  // IS the generated body. A malformed payload must therefore never surface the
  // content, only the shape of the failure.
  it('never surfaces payload content when the stop output is malformed', async () => {
    const BODY = 'SENSITIVE_PE_BODY_MARKER';
    const spawnFn = vi.fn(() =>
      makeFakeChild({
        stdoutChunks: [`{"decision":"block","reason":"${BODY}" TRUNCATED`],
        exitCode: 0,
      }),
    );

    const err = await spawnStop('s', { spawnFn: spawnFn as never }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(NexpathMalformedPayloadError);
    const malformed = err as InstanceType<typeof NexpathMalformedPayloadError>;

    // Not in the message, not on the object, not in anything serialized from it.
    expect(malformed.message).not.toContain(BODY);
    expect(malformed).not.toHaveProperty('rawStdout');
    expect(malformed.cause).toBeUndefined();
    expect(JSON.stringify(malformed.shape)).not.toContain(BODY);
    expect(`${malformed.message}${JSON.stringify(malformed.shape)}`).not.toContain('decision');
  });

  it('records a redacted failure shape for a malformed payload', () => {
    const raw = '{"decision":"block","reason":"x" TRUNCATED';
    let parseError: unknown;
    try { JSON.parse(raw); } catch (e) { parseError = e; }

    const shape = describeMalformedPayload(raw, parseError);

    expect(shape.byteLength).toBe(Buffer.byteLength(raw, 'utf8'));
    expect(['unexpected_token', 'unexpected_end', 'unknown']).toContain(shape.parseErrorKind);
    if (shape.byteOffset !== undefined) expect(Number.isInteger(shape.byteOffset)).toBe(true);
  });

  // V8 distinguishes these two: cut mid-value gives "Unexpected end of JSON
  // input"; cut after a complete value gives "Expected ',' or '}' …".
  it('classifies a payload cut mid-value as an unexpected end', () => {
    const raw = '{"decision":"block","reason":';
    let parseError: unknown;
    try { JSON.parse(raw); } catch (e) { parseError = e; }

    expect(describeMalformedPayload(raw, parseError).parseErrorKind).toBe('unexpected_end');
  });

  it('classifies a payload cut after a complete value as an unexpected token', () => {
    const raw = '{"decision":"block"';
    let parseError: unknown;
    try { JSON.parse(raw); } catch (e) { parseError = e; }

    expect(describeMalformedPayload(raw, parseError).parseErrorKind).toBe('unexpected_token');
  });

  // The SyntaxError message itself quotes a leading excerpt of the input
  // (`Unexpected token 'P', "PE_LEAK no"... is not valid JSON`) — V8 caps it at
  // 10 characters, but 10 characters of a delivered body is still a leak. That
  // is exactly why the parser error is classified and discarded, never stored.
  it('does not carry the parser message, which itself quotes the payload', () => {
    const raw = 'PE_LEAK not json {{';
    let parseError: unknown;
    try { JSON.parse(raw); } catch (e) { parseError = e; }

    // Prove the premise: the raw parser message really does contain payload.
    expect((parseError as Error).message).toContain('PE_LEAK');

    const shape = describeMalformedPayload(raw, parseError);
    expect(JSON.stringify(shape)).not.toContain('PE_LEAK');
    expect(new NexpathMalformedPayloadError(shape).message).not.toContain('PE_LEAK');
  });

  it('counts bytes, not characters, for a multi-byte payload', () => {
    const raw = '语言模型';
    expect(describeMalformedPayload(raw, new Error('x')).byteLength).toBe(12);
  });

  it('rejects when nexpath stop exits non-zero AND nothing can be recovered', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({ exitCode: 2, stderrChunks: ['boom\n'] }),
    );
    await expect(
      spawnStop('s', { spawnFn: spawnFn as never, recoverSelection: async () => null }),
    ).rejects.toThrow(/exited with code 2/);
  });

  it('recovers the selection from the store when stop crashes on exit (Windows libuv)', async () => {
    // 3221226505 = 0xC0000409 — the Windows fail-fast code from stop.ts process.exit.
    const spawnFn = vi.fn(() =>
      makeFakeChild({ exitCode: 3221226505, stdoutChunks: [], stderrChunks: ['[nexpath] Prompt sent to Claude\n'] }),
    );
    const result = await spawnStop('s', {
      spawnFn: spawnFn as never,
      cwd: '/proj',
      recoverSelection: async (cwd) => (cwd === '/proj' ? 'Run the test suite for this phase.' : null),
    });
    expect(result).toEqual({ selectedPrompt: 'Run the test suite for this phase.' });
  });

  it('prefers a stdout selection even on a non-zero exit (stdout survived the crash)', async () => {
    const out = { decision: 'block', reason: 'Cross-confirm the spec first.' };
    const spawnFn = vi.fn(() =>
      makeFakeChild({ exitCode: 3221226505, stdoutChunks: [JSON.stringify(out)] }),
    );
    const recover = vi.fn(async () => 'should-not-be-used');
    const result = await spawnStop('s', { spawnFn: spawnFn as never, recoverSelection: recover });
    expect(result).toEqual({ selectedPrompt: 'Cross-confirm the spec first.' });
    expect(recover).not.toHaveBeenCalled();
  });

  it('non-zero exit with no recovery + no stdout → rejects', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 1, stdoutChunks: [] }));
    await expect(
      spawnStop('s', { spawnFn: spawnFn as never, recoverSelection: async () => null }),
    ).rejects.toThrow(/exited with code 1/);
  });

  it('rejects with NexpathBinaryNotFoundError when spawn emits error', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({ errorBeforeClose: new Error('nope') }),
    );
    await expect(
      spawnStop('s', { spawnFn: spawnFn as never }),
    ).rejects.toBeInstanceOf(NexpathBinaryNotFoundError);
  });

  // ── Stdin payload contract — must match Layer C's StopPayload shape ──────────
  // `src/cli/commands/stop.ts` lines 37-43 declare StopPayload requires
  // `cwd`, `hook_event_name`, and `stop_hook_active` in addition to the
  // optional `session_id`. We must send the full shape so Layer C's
  // `runStop` works correctly.

  it('writes the full StopPayload shape to stdin (session_id + cwd + hook_event_name + stop_hook_active)', async () => {
    let captured = '';
    const spawnFn = vi.fn(() => {
      const c = makeFakeChild({ stdoutChunks: [''], exitCode: 0 });
      const origEnd = c.stdin.end.bind(c.stdin);
      c.stdin.end = ((chunk: unknown, ...args: unknown[]) => {
        if (chunk !== undefined) captured = String(chunk);
        return origEnd(chunk as never, ...(args as never[]));
      }) as typeof c.stdin.end;
      return c;
    });
    await spawnStop('sess-X', {
      spawnFn: spawnFn as never,
      cwd: '/workspace/abc',
    });
    const parsed = JSON.parse(captured.trim());
    expect(parsed).toEqual({
      session_id:       'sess-X',
      cwd:              '/workspace/abc',
      hook_event_name:  'Stop',
      stop_hook_active: false,
    });
  });

  it('defaults the stdin cwd to process.cwd() when opts.cwd is omitted', async () => {
    let captured = '';
    const spawnFn = vi.fn(() => {
      const c = makeFakeChild({ stdoutChunks: [''], exitCode: 0 });
      const origEnd = c.stdin.end.bind(c.stdin);
      c.stdin.end = ((chunk: unknown, ...args: unknown[]) => {
        if (chunk !== undefined) captured = String(chunk);
        return origEnd(chunk as never, ...(args as never[]));
      }) as typeof c.stdin.end;
      return c;
    });
    await spawnStop('sess-Y', { spawnFn: spawnFn as never });
    const parsed = JSON.parse(captured.trim());
    expect(parsed.cwd).toBe(process.cwd());
    expect(parsed.hook_event_name).toBe('Stop');
    expect(parsed.stop_hook_active).toBe(false);
  });

  it('passes opts.cwd as the spawned process cwd', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({ stdoutChunks: [''], exitCode: 0 }),
    );
    await spawnStop('s', { spawnFn: spawnFn as never, cwd: '/spawn/cwd' });
    const opts = spawnFn.mock.calls[0]![2] as { cwd?: string };
    expect(opts.cwd).toBe('/spawn/cwd');
  });
});

describe('resolveSpawnEnv — DBus session bus restoration', () => {
  it('injects the standard per-user bus when DBUS_SESSION_BUS_ADDRESS is absent and the socket exists', () => {
    const env = resolveSpawnEnv({
      env: { PATH: '/usr/bin' },
      getuid: () => 1000,
      existsSync: (p) => p === '/run/user/1000/bus',
    });
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus');
    expect(env.PATH).toBe('/usr/bin'); // existing vars preserved
  });

  it('never overrides an address that is already set', () => {
    const env = resolveSpawnEnv({
      env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/already/here' },
      getuid: () => 1000,
      existsSync: () => true,
    });
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/already/here');
  });

  it('leaves env unchanged when the bus socket does not exist', () => {
    const env = resolveSpawnEnv({
      env: { PATH: '/usr/bin' },
      getuid: () => 1000,
      existsSync: () => false,
    });
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBeUndefined();
  });
});
