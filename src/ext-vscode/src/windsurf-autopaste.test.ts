import { describe, it, expect, vi } from 'vitest';
import { pasteKeystroke, raiseWindsurfWindow, raiseAppWindow } from './windsurf-autopaste.js';

const deps = (over = {}) => {
  const calls: Array<[string, string[]]> = [];
  return {
    calls,
    run: (cmd: string, args: string[]) => { calls.push([cmd, args]); return true; },
    hasCommand: () => true,
    env: { DISPLAY: ':0' } as NodeJS.ProcessEnv,
    ...over,
  };
};

describe('pasteKeystroke', () => {
  it('Linux/X11 with xdotool → ctrl+v via xdotool', () => {
    const d = deps({ platform: 'linux' as NodeJS.Platform });
    expect(pasteKeystroke(d)).toBe(true);
    expect(d.calls[0]).toEqual(['xdotool', ['key', '--clearmodifiers', 'ctrl+v']]);
  });

  it('Linux without DISPLAY/WAYLAND → false (no blind paste)', () => {
    const d = deps({ platform: 'linux' as NodeJS.Platform, env: {} as NodeJS.ProcessEnv });
    expect(pasteKeystroke(d)).toBe(false);
    expect(d.calls).toHaveLength(0);
  });

  it('Linux with no keystroke tool → false', () => {
    const d = deps({ platform: 'linux' as NodeJS.Platform, hasCommand: () => false });
    expect(pasteKeystroke(d)).toBe(false);
  });

  it('macOS → osascript Cmd+V', () => {
    const d = deps({ platform: 'darwin' as NodeJS.Platform });
    expect(pasteKeystroke(d)).toBe(true);
    expect(d.calls[0][0]).toBe('osascript');
    expect(d.calls[0][1].join(' ')).toContain('keystroke "v" using command down');
  });

  it('Windows → powershell SendKeys ^v', () => {
    const d = deps({ platform: 'win32' as NodeJS.Platform });
    expect(pasteKeystroke(d)).toBe(true);
    expect(d.calls[0][0]).toBe('powershell');
    expect(d.calls[0][1].join(' ')).toContain('SendKeys("^v")');
  });

  it('prefers xdotool, then wtype, then ydotool', () => {
    const onlyWtype = deps({
      platform: 'linux' as NodeJS.Platform,
      hasCommand: (c: string) => c === 'wtype',
    });
    expect(pasteKeystroke(onlyWtype)).toBe(true);
    expect(onlyWtype.calls[0][0]).toBe('wtype');
  });
});

describe('raiseWindsurfWindow', () => {
  it('Linux with wmctrl → activates the windsurf window', () => {
    const d = deps({ platform: 'linux' as NodeJS.Platform });
    expect(raiseWindsurfWindow(d)).toBe(true);
    expect(d.calls[0]).toEqual(['wmctrl', ['-x', '-a', 'windsurf']]);
  });

  it('⭐ F-9: macOS activates the running editor process through System Events; win32 stays a no-op', () => {
    const mac = deps({ platform: 'darwin' as NodeJS.Platform });
    expect(raiseWindsurfWindow(mac)).toBe(true);
    expect(mac.calls[0][0]).toBe('osascript');
    expect(mac.calls[0][1].join(' ')).toContain('first application process whose name is');
    expect(mac.calls[0][1].join(' ')).toContain('{"windsurf"}');
    const win = deps({ platform: 'win32' as NodeJS.Platform });
    expect(raiseWindsurfWindow(win)).toBe(false);
    expect(win.calls).toHaveLength(0);
  });

  it('Linux without a display → false', () => {
    const d = deps({ platform: 'linux' as NodeJS.Platform, env: {} as NodeJS.ProcessEnv });
    expect(raiseWindsurfWindow(d)).toBe(false);
  });
});

describe('raiseAppWindow (generalised — used for Cursor inject)', () => {
  it('Linux with wmctrl → activates the given app class (cursor)', () => {
    const d = deps({ platform: 'linux' as NodeJS.Platform });
    expect(raiseAppWindow('cursor', d)).toBe(true);
    expect(d.calls[0]).toEqual(['wmctrl', ['-x', '-a', 'cursor']]);
  });

  it('falls back to xdotool --class when wmctrl is absent', () => {
    const d = deps({
      platform: 'linux' as NodeJS.Platform,
      hasCommand: (c: string) => c === 'xdotool',
    });
    expect(raiseAppWindow('cursor', d)).toBe(true);
    expect(d.calls[0]).toEqual(['xdotool', ['search', '--class', 'cursor', 'windowactivate', '--sync']]);
  });

  it('⭐ F-9: macOS tries every candidate in order (live appName first) via one activation script; win32 no-op', () => {
    const mac = deps({ platform: 'darwin' as NodeJS.Platform });
    expect(raiseAppWindow(['cursor rebrand', 'cursor'], mac)).toBe(true);
    expect(mac.calls[0][0]).toBe('osascript');
    expect(mac.calls[0][1].join(' ')).toContain('{"cursor rebrand", "cursor"}');
    expect(raiseAppWindow('cursor', deps({ platform: 'win32' as NodeJS.Platform }))).toBe(false);
  });
});

/** ⭐ RC49 — paste gets the same win32 targeting submit has (closing a platform asymmetry). */
describe('⭐ RC49 — pasteKeystroke win32 targeting', () => {
  it('⭐ with win32Titles: uses the foreground-first targeted script', () => {
    const calls: string[][] = [];
    pasteKeystroke({ platform: 'win32', win32Titles: ['Devin Next', 'Devin'], run: (_c, a) => { calls.push(a); return true; } });
    const ps = calls[0]!.join(' ');
    expect(ps).toContain('GetForegroundWindow');
    expect(ps).toContain("'Devin Next'");
    expect(ps).toContain('SendKeys("^v")');
  });
  it('without win32Titles: the OLD bare ^v, byte-identical (regression pin)', () => {
    const calls: string[][] = [];
    pasteKeystroke({ platform: 'win32', run: (_c, a) => { calls.push(a); return true; } });
    expect(calls[0]!.join(' ')).toContain('$w=New-Object -ComObject WScript.Shell;$w.SendKeys("^v")');
    expect(calls[0]!.join(' ')).not.toContain('GetForegroundWindow');
  });
});

/** ⭐ RC59 — raiseAppWindow candidate list: rebranded hosts carry their own WM_CLASS. */
describe('⭐ RC59 — raiseAppWindow candidates', () => {
  it('tries each candidate until one raises', () => {
    const tried: string[] = [];
    const ok = raiseAppWindow(['devin', 'windsurf'], {
      platform: 'linux', env: { DISPLAY: ':0' },
      hasCommand: (c) => c === 'wmctrl',
      run: (_c, args) => { tried.push(args[2]!); return args[2] === 'windsurf'; },
    });
    expect(ok).toBe(true);
    expect(tried).toEqual(['devin', 'windsurf']);
  });

  it('a single string keeps the old behaviour byte-identical', () => {
    const tried: string[] = [];
    raiseAppWindow('windsurf', {
      platform: 'linux', env: { DISPLAY: ':0' },
      hasCommand: (c) => c === 'wmctrl',
      run: (_c, args) => { tried.push(args[2]!); return true; },
    });
    expect(tried).toEqual(['windsurf']);
  });
});

/** ⭐ RC72 — the paste script also uses the cached helper when the Windows env names a cache dir. */
describe('⭐ RC72 — pasteKeystroke uses the cached win32 helper', () => {
  it('with LOCALAPPDATA: the cache-aware prelude leads; without: the RC49 script byte-identical', () => {
    const calls: string[][] = [];
    pasteKeystroke({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, win32Titles: ['Devin'], run: (_c, a) => { calls.push(a); return true; } });
    expect(calls[0]!.join(' ')).toContain("$nxDll='C:\\Users\\u\\AppData\\Local\\nexpath\\user32-fg-");
    expect(calls[0]!.join(' ')).toContain('Add-Type -LiteralPath $nxDll');
    expect(calls[0]!.join(' ')).toContain('SendKeys("^v")');
    pasteKeystroke({ platform: 'win32', env: {}, win32Titles: ['Devin'], run: (_c, a) => { calls.push(a); return true; } });
    expect(calls[1]!.join(' ').startsWith('-NoProfile -Command Add-Type ')).toBe(true);
    expect(calls[1]!.join(' ')).not.toContain('$nxDll');
  });
});
