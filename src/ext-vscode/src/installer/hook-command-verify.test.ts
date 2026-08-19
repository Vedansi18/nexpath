import { describe, it, expect } from 'vitest';
import { verifyCommandCurrent } from './hook-command-verify.js';

const CLI = 'C:\\Users\\padal\\.nexpath\\cli\\0.1.3\\dist\\cli\\index.js';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';

const hooksJson = (command: string, extraFields: Record<string, unknown> = {}) => JSON.stringify({
  version: 1,
  hooks: { beforeSubmitPrompt: [{ command, timeout: 120, ...extraFields }] },
});

describe('⭐ RC26 — verifyCommandCurrent (the exact confirmed defect)', () => {
  it('⭐ THE BUG: a legacy bare-`node` entry is NOT current (this is what silently ENOENTs)', () => {
    const raw = hooksJson(`node "${CLI}" cursor-hook beforeSubmitPrompt`);
    expect(verifyCommandCurrent(raw, 'cursor-hook', CLI, 'command', '"')).toBe(false);
  });

  it('a current, correctly-quoted absolute-node entry IS current', () => {
    const raw = hooksJson(`"${NODE}" "${CLI}" cursor-hook beforeSubmitPrompt`);
    expect(verifyCommandCurrent(raw, 'cursor-hook', CLI, 'command', '"')).toBe(true);
  });

  it('quoted but pointing at a STALE cli path (a version bump / RC20 re-stage) is NOT current', () => {
    const staleCli = 'C:\\Users\\padal\\.nexpath\\cli\\0.1.2\\dist\\cli\\index.js';
    const raw = hooksJson(`"${NODE}" "${staleCli}" cursor-hook beforeSubmitPrompt`);
    expect(verifyCommandCurrent(raw, 'cursor-hook', CLI, 'command', '"')).toBe(false);
  });

  it('no nexpath entry at all ⇒ not current (a hand-edited or foreign hooks.json)', () => {
    const raw = JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: 'some other tool' }] } });
    expect(verifyCommandCurrent(raw, 'cursor-hook', CLI, 'command', '"')).toBe(false);
  });

  it('malformed JSON ⇒ false, never throws', () => {
    expect(verifyCommandCurrent('{not json', 'cursor-hook', CLI, 'command', '"')).toBe(false);
  });

  it('missing hooks object ⇒ false, never throws', () => {
    expect(verifyCommandCurrent('{}', 'cursor-hook', CLI, 'command', '"')).toBe(false);
  });

  describe('Windsurf powershell field (RC21/RC23 shape — the field Devin Next actually runs)', () => {
    it('current: starts with the call operator `& "`', () => {
      const raw = JSON.stringify({
        hooks: { pre_user_prompt: [{ powershell: `& "${NODE}" "${CLI}" windsurf-hook pre_user_prompt --project "C:\\ws"` }] },
      });
      expect(verifyCommandCurrent(raw, 'windsurf-hook', CLI, 'powershell', '& "')).toBe(true);
    });

    it('⭐ a bash `command` field (forward-slashed) must NEVER be mistaken for the powershell check', () => {
      // The exact false-negative this design deliberately avoids: if the check
      // scanned `command` when asked for `powershell` shape, a perfectly
      // correct bash entry (present for parity, irrelevant on win32) would be
      // silently ignored — or worse, matched against the WRONG prefix and
      // reported as "unregistered" forever, looping the setup terminal.
      const raw = JSON.stringify({
        hooks: { pre_user_prompt: [{ command: `"${NODE.replace(/\\/g, '/')}" "${CLI.replace(/\\/g, '/')}" windsurf-hook pre_user_prompt` }] },
      });
      expect(verifyCommandCurrent(raw, 'windsurf-hook', CLI, 'powershell', '& "')).toBe(false);
    });

    it('a quoted-but-missing-`&` powershell string is NOT current (would silently be echoed, never run — see the builder header)', () => {
      const raw = JSON.stringify({
        hooks: { pre_user_prompt: [{ powershell: `"${NODE}" "${CLI}" windsurf-hook pre_user_prompt` }] },
      });
      expect(verifyCommandCurrent(raw, 'windsurf-hook', CLI, 'powershell', '& "')).toBe(false);
    });
  });

  it('scans across MULTIPLE hook events and finds ours regardless of position', () => {
    const raw = JSON.stringify({
      hooks: {
        someOtherTool: [{ command: 'unrelated' }],
        beforeSubmitPrompt: [{ command: `"${NODE}" "${CLI}" cursor-hook beforeSubmitPrompt` }],
      },
    });
    expect(verifyCommandCurrent(raw, 'cursor-hook', CLI, 'command', '"')).toBe(true);
  });
});
