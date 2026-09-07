/** ⭐ F-9 — darwin foreground targeting (pure; a Mac was not available, so the script + matching are pinned). */
import { describe, it, expect, vi } from 'vitest';
import {
  darwinAppCandidates, buildDarwinActivateScript, DARWIN_FRONTMOST_SCRIPT,
  activateDarwinApp, frontmostDarwinApp, darwinEditorIsFrontmost,
} from './darwin-focus.js';

describe('⭐ F-9 — candidates', () => {
  it('live appName first, then the product names; deduped case-insensitively; blanks dropped', () => {
    expect(darwinAppCandidates('Devin Next', 'windsurf')).toEqual(['Devin Next', 'Devin', 'Windsurf']);
    expect(darwinAppCandidates('cursor', 'cursor')).toEqual(['cursor']);
    expect(darwinAppCandidates('  ', 'cursor')).toEqual(['Cursor']);
    expect(darwinAppCandidates(undefined, 'windsurf')).toEqual(['Devin', 'Windsurf']);
  });
});

describe('⭐ F-9 — activation script', () => {
  it('targets RUNNING processes via System Events (never `tell application "<name>"`, which can open the "Where is…?" chooser), in candidate order, and errors when none runs', () => {
    const s = buildDarwinActivateScript(['Devin', 'Windsurf']);
    expect(s).toContain('tell application "System Events"');
    expect(s).toContain('repeat with n in {"Devin", "Windsurf"}');
    expect(s).toContain('if exists (process named (n as text)) then');
    expect(s).toContain('set frontmost of process named (n as text) to true');
    expect(s).toContain('error "nexpath: editor process not running"');
    expect(s).not.toMatch(/tell application "(Devin|Windsurf)"/);
  });
  it('strips quotes/backslashes from names so a rebrand can never break out of the string literal', () => {
    expect(buildDarwinActivateScript(['Dev"in\\'])).toContain('{"Devin"}');
  });
  it('activateDarwinApp runs osascript with the script; empty candidates ⇒ false without spawning', () => {
    const run = vi.fn(() => true);
    expect(activateDarwinApp(['Cursor'], { run })).toBe(true);
    expect(run).toHaveBeenCalledWith('osascript', ['-e', buildDarwinActivateScript(['Cursor'])]);
    const none = vi.fn(() => true);
    expect(activateDarwinApp([], { run: none })).toBe(false);
    expect(none).not.toHaveBeenCalled();
  });
});

describe('⭐ F-9 — frontmost check', () => {
  it('reads the frontmost process name through System Events', () => {
    const runCapture = vi.fn(() => ' Cursor \n');
    expect(frontmostDarwinApp({ runCapture })).toBe('Cursor');
    expect(runCapture).toHaveBeenCalledWith('osascript', ['-e', DARWIN_FRONTMOST_SCRIPT]);
  });
  it('matches exact and prefix-with-separator (rebrand suffixes), case-insensitively; never a bare substring', () => {
    const at = (name: string) => ({ runCapture: () => name });
    expect(darwinEditorIsFrontmost(['Cursor'], at('Cursor'))).toBe(true);
    expect(darwinEditorIsFrontmost(['Devin'], at('Devin Next'))).toBe(true);
    expect(darwinEditorIsFrontmost(['windsurf'], at('Windsurf'))).toBe(true);
    expect(darwinEditorIsFrontmost(['Cursor'], at('Precursor'))).toBe(false);
    expect(darwinEditorIsFrontmost(['Cursor'], at('Terminal'))).toBe(false);
  });
  it('⭐ unreadable frontmost (no Accessibility / no osascript) ⇒ false — a keystroke we cannot target must not fire', () => {
    expect(darwinEditorIsFrontmost(['Cursor'], { runCapture: () => null })).toBe(false);
    expect(darwinEditorIsFrontmost(['Cursor'], { runCapture: () => '' })).toBe(false);
  });
});
