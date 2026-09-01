import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { spawnRecordSignal } from './ipc.js';

function makeFakeChild(opts: { exitCode?: number; errorBeforeClose?: Error } = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
  };
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  queueMicrotask(() => {
    if (opts.errorBeforeClose) { child.emit('error', opts.errorBeforeClose); return; }
    child.emit('close', opts.exitCode ?? 0);
  });
  return child;
}

describe('spawnRecordSignal', () => {
  it('builds the record-signal argv (kind only) and resolves on exit 0', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
    await expect(
      spawnRecordSignal('pe_shorter', { spawnFn: spawnFn as never }),
    ).resolves.toBeUndefined();
    expect(spawnFn).toHaveBeenCalledWith(
      'nexpath',
      ['record-signal', '--kind', 'pe_shorter'],
      expect.any(Object),
    );
  });

  it('includes --db when dbPath is provided', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
    await spawnRecordSignal('pe_close', { spawnFn: spawnFn as never, dbPath: '/tmp/x.db' });
    expect(spawnFn).toHaveBeenCalledWith(
      'nexpath',
      ['record-signal', '--kind', 'pe_close', '--db', '/tmp/x.db'],
      expect.any(Object),
    );
  });

  it('sends NO stdin payload (content-free — only the kind travels in argv)', async () => {
    let written = '';
    const child = makeFakeChild({ exitCode: 0 });
    child.stdin = new Writable({ write(chunk, _enc, cb) { written += chunk.toString(); cb(); } });
    const spawnFn = vi.fn(() => child);
    await spawnRecordSignal('pe_apply_details', { spawnFn: spawnFn as never });
    expect(written).toBe('');
  });

  it('swallows a spawn error and resolves (never rejects)', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ errorBeforeClose: new Error('ENOENT') }));
    await expect(
      spawnRecordSignal('pe_use_current', { spawnFn: spawnFn as never }),
    ).resolves.toBeUndefined();
  });

  it('swallows a non-zero exit and resolves', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 1 }));
    await expect(
      spawnRecordSignal('pe_use_original', { spawnFn: spawnFn as never }),
    ).resolves.toBeUndefined();
  });

  it('never throws even if the spawner throws synchronously', async () => {
    const spawnFn = vi.fn(() => { throw new Error('boom'); });
    await expect(
      spawnRecordSignal('pe_more_thorough', { spawnFn: spawnFn as never }),
    ).resolves.toBeUndefined();
  });
});
