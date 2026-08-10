/**
 * H5 — `.cursor/hooks.json` writer.
 *
 * The plan names four acceptance items; the three this file covers are:
 * written/removed idempotently, the `timeout` UNIT pinned by test, and other
 * tools' hooks preserved.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  writeCursorHooks, removeCursorHooks, buildCursorHookEntry, buildCursorHooksConfig,
  isNexpathCursorHook, getCursorUserHooksPath, getCursorProjectHooksPath,
  CURSOR_HOOK_TIMEOUT_SECONDS, CURSOR_HOOK_EVENTS,
} from './install.js';

const CLI = '/opt/nexpath/dist/cli/index.js';

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'nexpath-cursor-'));
  return { dir: d, file: join(d, '.cursor', 'hooks.json'), cleanup: () => rmSync(d, { recursive: true, force: true }) };
}
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Record<string, never>;

describe('⚠ R4 — timeout is written in SECONDS, not milliseconds', () => {
  it('pins the emitted value', () => {
    // Cursor multiplies by 1000: "timeout": 180000 was logged as 180000000ms.
    // Emitting ms here would produce a timeout ~1000x too long, so a hung hook
    // would appear to hang forever.
    expect(buildCursorHookEntry(CLI, 'beforeSubmitPrompt').timeout).toBe(120);
    expect(CURSOR_HOOK_TIMEOUT_SECONDS).toBe(120);
  });

  it('is a plausible SECONDS value, never a milliseconds one', () => {
    // MUTATION GUARD: 120_000 would pass a naive "is it set?" check.
    expect(CURSOR_HOOK_TIMEOUT_SECONDS).toBeLessThan(1000);
  });

  it('⚠ R3 — sits above H4\'s 60-90s hold budget, never relying on the 60s default', () => {
    // The default is a silent fail-open cliff: it could fire while we are
    // legitimately holding the prompt.
    expect(CURSOR_HOOK_TIMEOUT_SECONDS).toBeGreaterThan(90);
  });
});

describe('failClosed stays at its default (A3)', () => {
  it('is not written at all', () => {
    // Writing false explicitly would imply we had a reason to override it.
    expect(Object.keys(buildCursorHookEntry(CLI, 'beforeSubmitPrompt'))).not.toContain('failClosed');
  });
});

describe('only EVIDENCED events are registered', () => {
  it('registers beforeSubmitPrompt and nothing invented', () => {
    // An unmeasured event name would be written into a real user's config and
    // silently never fire.
    expect([...CURSOR_HOOK_EVENTS]).toEqual(['beforeSubmitPrompt']);
    expect(Object.keys(buildCursorHooksConfig(CLI))).toEqual(['beforeSubmitPrompt']);
  });
});

describe('idempotent write', () => {
  it('writes our hook into a fresh file', () => {
    const t = tmp();
    try {
      writeCursorHooks(t.file, CLI);
      const h = read(t.file).hooks as never as Record<string, Array<{ command: string }>>;
      expect(h.beforeSubmitPrompt).toHaveLength(1);
      expect(h.beforeSubmitPrompt[0].command).toContain('cursor-hook');
    } finally { t.cleanup(); }
  });

  it('writing twice does not duplicate', () => {
    const t = tmp();
    try {
      writeCursorHooks(t.file, CLI);
      writeCursorHooks(t.file, CLI);
      const h = read(t.file).hooks as never as Record<string, unknown[]>;
      expect(h.beforeSubmitPrompt).toHaveLength(1);
    } finally { t.cleanup(); }
  });

  it('replaces a stale nexpath entry from an older install path', () => {
    const t = tmp();
    try {
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, JSON.stringify({
        hooks: { beforeSubmitPrompt: [{ command: 'node /OLD/path/cli.js cursor-hook beforeSubmitPrompt' }] },
      }));
      writeCursorHooks(t.file, CLI);
      const h = read(t.file).hooks as never as Record<string, Array<{ command: string }>>;
      expect(h.beforeSubmitPrompt).toHaveLength(1);
      expect(h.beforeSubmitPrompt[0].command).toContain(CLI);
    } finally { t.cleanup(); }
  });
});

describe('other tools\' hooks are preserved', () => {
  it('keeps a foreign entry on the same event', () => {
    const t = tmp();
    try {
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, JSON.stringify({
        hooks: { beforeSubmitPrompt: [{ command: 'some-other-tool --check' }] },
      }));
      writeCursorHooks(t.file, CLI);
      const h = read(t.file).hooks as never as Record<string, Array<{ command: string }>>;
      expect(h.beforeSubmitPrompt).toHaveLength(2);
      expect(h.beforeSubmitPrompt[0].command).toBe('some-other-tool --check');
    } finally { t.cleanup(); }
  });

  it('preserves unrelated top-level keys', () => {
    const t = tmp();
    try {
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, JSON.stringify({ version: 1, hooks: {} }));
      writeCursorHooks(t.file, CLI);
      expect(read(t.file).version).toBe(1);
    } finally { t.cleanup(); }
  });

  it('rewrites rather than crashing on a malformed file', () => {
    const t = tmp();
    try {
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, '{ not json');
      expect(() => writeCursorHooks(t.file, CLI)).not.toThrow();
      const h = read(t.file).hooks as never as Record<string, unknown[]>;
      expect(h.beforeSubmitPrompt).toHaveLength(1);
    } finally { t.cleanup(); }
  });
});

describe('idempotent removal', () => {
  it('removes ours and reports true', () => {
    const t = tmp();
    try {
      writeCursorHooks(t.file, CLI);
      expect(removeCursorHooks(t.file)).toBe(true);
      expect((read(t.file).hooks as never as Record<string, unknown>).beforeSubmitPrompt).toBeUndefined();
    } finally { t.cleanup(); }
  });

  it('leaves other tools\' hooks intact', () => {
    const t = tmp();
    try {
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, JSON.stringify({ hooks: { beforeSubmitPrompt: [{ command: 'other-tool' }] } }));
      writeCursorHooks(t.file, CLI);
      removeCursorHooks(t.file);
      const h = read(t.file).hooks as never as Record<string, Array<{ command: string }>>;
      expect(h.beforeSubmitPrompt).toEqual([{ command: 'other-tool' }]);
    } finally { t.cleanup(); }
  });

  it('returns false when the file does not exist', () => {
    const t = tmp();
    try { expect(removeCursorHooks(t.file)).toBe(false); } finally { t.cleanup(); }
  });

  it('removing twice is a no-op the second time', () => {
    const t = tmp();
    try {
      writeCursorHooks(t.file, CLI);
      expect(removeCursorHooks(t.file)).toBe(true);
      expect(removeCursorHooks(t.file)).toBe(false);
    } finally { t.cleanup(); }
  });
});

describe('config locations (Cursor merges three; we write only two)', () => {
  it('user and project paths', () => {
    expect(getCursorUserHooksPath('/home/u')).toBe('/home/u/.cursor/hooks.json');
    expect(getCursorProjectHooksPath('/proj')).toBe('/proj/.cursor/hooks.json');
  });

  it('identifies our own entries by command substring, with no marker field', () => {
    expect(isNexpathCursorHook({ command: 'node x cursor-hook beforeSubmitPrompt' })).toBe(true);
    expect(isNexpathCursorHook({ command: 'other-tool' })).toBe(false);
    expect(isNexpathCursorHook({} as never)).toBe(false);
  });
});
