import { describe, expect, it } from 'vitest';
import { openStore } from './db.js';
import { upsertProject } from './projects.js';
import { setProjectEnvFacts, getProjectEnvFacts } from './env-facts.js';
import type { FactMap } from '../env/env-probe.js';

/**
 * §17.8 — `nexpath env` never persisted project facts, because the entry points disagree on the
 * key: `auto` registers `--project` verbatim (forward slashes as MINGW64 hands them over), while
 * `nexpath env` persists under `resolve()`'d form (backslashes on Windows). The write is an
 * UPDATE, so the mismatch was a SILENT no-op — measured at 0 of 20 projects populated in a real
 * store carrying 1,136 prompts.
 *
 * These pin the fix in the only way that matters: a project registered in ONE form must be
 * writable and readable through the OTHER, and a write that matches nothing must SAY so.
 */

const FACTS: FactMap = {
  has_test_runner: { value: true, tier: 'C', confidence: 'high', detectedAt: 1 },
  has_version_control: { value: true, tier: 'C', confidence: 'high', detectedAt: 1 },
} as unknown as FactMap;

const FORWARD = 'C:/Users/x/AppData/Local/Temp/proj-17-8';
const BACKSLASH = 'C:\\Users\\x\\AppData\\Local\\Temp\\proj-17-8';

describe('§17.8 — project env facts survive a separator mismatch between writer and registrar', () => {
  it('a project registered with FORWARD slashes accepts a BACKSLASH write', async () => {
    const store = await openStore(':memory:');
    upsertProject(store, { projectRoot: FORWARD, name: 'p' });

    // This is exactly the live pairing: auto registered the forward form, `nexpath env` writes the
    // resolve()'d backslash form. Before the fix this returned nothing and stored nothing.
    const stored = setProjectEnvFacts(store, BACKSLASH, FACTS, 123);
    expect(stored, 'the write silently matched no row — §17.8 has regressed').toBe(true);

    const read = getProjectEnvFacts(store, FORWARD);
    expect(read, 'facts written under one form are unreadable under the other').not.toBeNull();
    expect(Object.keys(read?.facts ?? {}), 'the stored facts did not round-trip').toContain('has_test_runner');
  });

  it('and the read is symmetric — registered forward, read back through the backslash form', async () => {
    const store = await openStore(':memory:');
    upsertProject(store, { projectRoot: FORWARD, name: 'p' });
    setProjectEnvFacts(store, FORWARD, FACTS, 123);

    expect(getProjectEnvFacts(store, BACKSLASH)).not.toBeNull();
  });

  it('a write against an UNREGISTERED project reports failure instead of claiming success', () => {
    // The silence is what let this survive for the life of the store: a no-op looked identical to
    // a successful write, so `nexpath env` printed ten facts and a success-shaped report while
    // storing nothing. The command now prints a warning off the back of this boolean.
    return openStore(':memory:').then((store) => {
      const stored = setProjectEnvFacts(store, 'C:/nowhere/unregistered', FACTS, 123);
      expect(stored, 'a no-op write still reports success — the §17.8 silence is back').toBe(false);
    });
  });
});
