import { describe, it, expect } from 'vitest';
import { SessionStateManager } from './SessionStateManager.js';
import type { SessionState } from './types.js';

/** Minimal state carrier — setAgentMode only touches currentAgentMode (in-memory). */
function mgrFor(mode?: string): SessionStateManager {
  return new SessionStateManager({ currentAgentMode: mode } as unknown as SessionState);
}

describe('SessionStateManager.setAgentMode', () => {
  it('records the reported mode', () => {
    const mgr = mgrFor();
    mgr.setAgentMode('plan');
    expect(mgr.current.currentAgentMode).toBe('plan');
  });

  it('is sticky — a later modeless prompt keeps the last-known value', () => {
    const mgr = mgrFor();
    mgr.setAgentMode('acceptEdits');
    mgr.setAgentMode(undefined);
    expect(mgr.current.currentAgentMode).toBe('acceptEdits');
  });

  it('overwrites when a new mode is reported', () => {
    const mgr = mgrFor('plan');
    mgr.setAgentMode('bypassPermissions');
    expect(mgr.current.currentAgentMode).toBe('bypassPermissions');
  });
});
