import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRuntimeContext } from './runtime-context.js';
import type { SessionState } from './types.js';

const dirs: string[] = [];
function mkProject(): string {
  const d = mkdtempSync(join(tmpdir(), 'nexpath-rtctx-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function stateFor(root: string, frustrated = 0, accepted = 0, currentAgentMode?: string): SessionState {
  return { projectRoot: root, consecutiveFrustratedPrompts: frustrated, consecutiveAcceptanceStreak: accepted, currentAgentMode } as unknown as SessionState;
}

describe('buildRuntimeContext', () => {
  it('maps the AR-10 probe booleans + the live streaks', () => {
    const root = mkProject(); // no .git, no backups, no env-sep, no scanner
    const ctx = buildRuntimeContext(stateFor(root, 3, 2));
    expect(ctx.hasVersionControl).toBe(false);
    expect(ctx.hasBackups).toBe(false);
    expect(ctx.hasSeparateEnvs).toBe(false);
    expect(ctx.hasSecurityScanner).toBe(false);
    expect(ctx.consecutiveFrustratedPrompts).toBe(3);
    expect(ctx.consecutiveAcceptanceStreak).toBe(2);
  });

  it('reflects present dev-env facts (git remote → hasBackups, .git → hasVersionControl)', () => {
    const root = mkProject();
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@example.com:me/app.git\n');
    const ctx = buildRuntimeContext(stateFor(root));
    expect(ctx.hasVersionControl).toBe(true);
    expect(ctx.hasBackups).toBe(true); // git remote = an off-machine copy
  });

  it('threads the current agent mode through when set on state', () => {
    const root = mkProject();
    const ctx = buildRuntimeContext(stateFor(root, 0, 0, 'plan'));
    expect(ctx.currentAgentMode).toBe('plan');
  });

  it('leaves the agent mode undefined when state carries none', () => {
    const root = mkProject();
    const ctx = buildRuntimeContext(stateFor(root));
    expect(ctx.currentAgentMode).toBeUndefined();
  });
});
