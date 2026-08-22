/**
 * H1b — mechanism truth pinning tests.
 *
 * WHY THIS FILE EXISTS. Two shipped files contradicted each other about which
 * Windsurf insert command actually works:
 *   - `chat-input-injector.ts` claimed `windsurf.sendTextToChat` was "VERIFIED"
 *     and registered by the workbench core.
 *   - `windsurf-autopaste.ts` said it is only a defined ID with no handler, so
 *     `executeCommand` throws.
 * Both cannot be true, and a future phase (H3) must pick a mechanism. Settled
 * 2026-08-10 by inspecting the vendors' own shipped bundles and by live tests.
 * These tests pin the resulting truth table so the contradiction cannot silently
 * return via a stale comment or a hopeful re-ordering.
 *
 * SCOPE OF THE EVIDENCE, stated honestly:
 *   - Windsurf bundle: `windsurf.sendTextToChat` occurs exactly ONCE, inside a
 *     command-ID constants table (`SEND_TEXT_TO_CHAT:{id:"..."}`) with no handler,
 *     while `sendChatActionMessage` occurs x7 and `addCascadeInput` x6.
 *   - Cursor bundle: all three declared insert candidates occur ZERO times.
 *   - Live (Linux, Cursor 3.4.20): `composer.focusComposer` WORKS.
 *     `composer.submit` exists in the bundle but did NOTHING when invoked.
 * A bundle scan cannot prove absence of a dynamically-registered handler, so
 * these tests assert the *documented decisions* that follow from the evidence —
 * not vendor internals, which we do not control and must not pretend to.
 *
 * METHODOLOGICAL RULE learned here and worth keeping: bundle-grep is reliable for
 * ruling a command OUT, but NOT for ruling one IN (`composer.submit` proved that).
 */
import { describe, it, expect, vi } from 'vitest';

// `chat-input-injector.ts` imports `vscode` for its default deps; the module does
// not exist outside the extension host, so it is mocked exactly as the sibling
// suite does. Every test below injects its own deps, so the mock is never used.
vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn(),
    getCommands: vi.fn(),
  },
}));

import { CANDIDATE_COMMANDS, chatInputInject } from './chat-input-injector.js';

describe('H1b mechanism truth — Windsurf', () => {
  it('never dispatches an unregistered candidate: sendTextToChat is skipped when the host does not register it', async () => {
    // The real host does NOT register it (bundle: 1 occurrence, an id table entry).
    // The guard must skip it rather than dispatch and throw.
    const exec = vi.fn();
    const list = vi.fn().mockResolvedValue([]); // nothing registered
    const ok = await chatInputInject('hello', {
      host: 'windsurf',
      executeCommand: exec,
      getCommands: list,
    });
    expect(ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('the registered-command guard is what protects us, so a dead id in the list is inert', async () => {
    // Regression guard for the real defect: the comment was wrong, the code was not.
    // If someone ever removes the `available.has(...)` check, this fails.
    const exec = vi.fn().mockRejectedValue(new Error('command not found'));
    const list = vi.fn().mockResolvedValue(['some.other.command']);
    await expect(
      chatInputInject('hello', { host: 'windsurf', executeCommand: exec, getCommands: list }),
    ).resolves.toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('H1b mechanism truth — Cursor', () => {
  it('all declared Cursor insert candidates are absent from the real host, so injection falls through', async () => {
    // Bundle evidence: cursor.aichat.insertWithSelection / cursor.composer.focus /
    // aichat.insertSelection all occur ZERO times in Cursor 3.4.20's workbench bundle.
    // Simulate that reality: none registered -> must return false (clipboard fallback).
    const exec = vi.fn();
    const list = vi.fn().mockResolvedValue(['composer.focusComposer']); // focus exists, insert does not
    const ok = await chatInputInject('hello', {
      host: 'cursor',
      executeCommand: exec,
      getCommands: list,
    });
    expect(ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('pins the documented Cursor insert-candidate list so silent additions are noticed', () => {
    // Not a claim that these work — they are verified NOT to exist on 3.4.20.
    // Pinned so that if someone adds a new candidate, they must consciously update
    // this list and re-verify it against a real host rather than adding it hopefully.
    expect(CANDIDATE_COMMANDS.cursor).toEqual([
      'cursor.aichat.insertWithSelection',
      'cursor.composer.focus',
      'aichat.insertSelection',
    ]);
  });
});

describe('BACKWARD COMPATIBILITY — Cursor chat-focus order must NOT change', () => {
  // This list is consumed by `cursorInject` on the EXISTING, SHIPPING, UN-GATED
  // advisory path (`injectIntoChat`). The hook milestone's rule (dev plan §2.1) is
  // that every behavioural change sits behind the NEXPATH_*_PROMPTSUBMIT_ADVISORY
  // switch, default off — and that switch does not exist yet (H2 builds it).
  //
  // H1b briefly reordered this to put `composer.focusComposer` first on live
  // evidence. THAT WAS REVERTED: the reorder only benefits the NEW submit-time
  // flow (which does not exist yet), while shipping it un-gated would change
  // today's behaviour for any build where `aichat.focusChat` IS registered.
  //
  // These tests therefore guard the OLD ORDER, not the "better" one. H6 applies
  // the evidence-backed order behind the switch.
  it('preserves the original pre-hook-milestone order exactly', async () => {
    const { CURSOR_CHAT_FOCUS_COMMANDS_V1 } = await import('./extension.js');
    expect(CURSOR_CHAT_FOCUS_COMMANDS_V1).toEqual([
      'aichat.focusChat',
      'composer.focusComposer',
      'aichat.gotochat',
      'workbench.action.focusAuxiliaryBar',
    ]);
  });

  it('does not promote composer.focusComposer ahead of aichat.focusChat on the un-gated path', async () => {
    // Fails if someone re-applies the H1b reorder without gating it behind the
    // backward-compatibility switch. The knowledge is not lost — it is recorded in
    // the constant's doc comment and in the dev plan's H1b results table, to be
    // applied by H6 behind the switch.
    const { CURSOR_CHAT_FOCUS_COMMANDS_V1 } = await import('./extension.js');
    expect(CURSOR_CHAT_FOCUS_COMMANDS_V1.indexOf('aichat.focusChat'))
      .toBeLessThan(CURSOR_CHAT_FOCUS_COMMANDS_V1.indexOf('composer.focusComposer'));
  });

  it('still contains every id the old flow relied on — nothing dropped', async () => {
    const { CURSOR_CHAT_FOCUS_COMMANDS_V1 } = await import('./extension.js');
    for (const id of [
      'aichat.focusChat',
      'composer.focusComposer',
      'aichat.gotochat',
      'workbench.action.focusAuxiliaryBar',
    ]) {
      expect(CURSOR_CHAT_FOCUS_COMMANDS_V1).toContain(id);
    }
    expect(CURSOR_CHAT_FOCUS_COMMANDS_V1).toHaveLength(4);
  });
});

describe('H1b mechanism truth — vscode-generic host', () => {
  it('never attempts injection on a plain VS Code host', async () => {
    const exec = vi.fn();
    const list = vi.fn();
    const ok = await chatInputInject('hello', { host: 'vscode-generic', executeCommand: exec, getCommands: list });
    expect(ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
