import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The probe's facts reach prompt enhancement with NO manual `nexpath env`.
 *
 * That command used to be the only writer of the store the enhancement reads, so a project nobody
 * had run it for carried none of its framework / version control / lockfile facts into any popup,
 * although the first prompt of every session already probes the project. These run the REAL auto
 * command on a real project and a real store file, and read back what the enhancement will read.
 * Each positive is paired with the control that must stay untouched: consent off, and facts a user
 * stored themselves.
 */

vi.mock('../../config/ApiKeyResolver.js', () => ({
  resolveOpenAIKey: vi.fn().mockResolvedValue(null),
  getKeySource:     vi.fn().mockResolvedValue('none'),
  isValidApiKey:    vi.fn().mockReturnValue(false),
}));

vi.mock('../../telemetry/index.js', () => ({
  writeTelemetry: vi.fn(),
  TELEMETRY_PATH: '/mock/telemetry.jsonl',
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: vi.fn(async () => { throw new Error('no provider in this test'); }) } };
  },
}));

async function runAutoCommand(args: string[]): Promise<void> {
  const { Command } = await import('commander');
  const { registerAutoCommand } = await import('./auto.js');
  const program = new Command();
  program.exitOverride();
  registerAutoCommand(program);
  const originalStdin = process.stdin;
  const stream = new PassThrough();
  (stream as unknown as Record<string, unknown>).isTTY = true;
  Object.defineProperty(process, 'stdin', { value: stream, writable: true, configurable: true });
  try {
    await program.parseAsync(['node', 'nexpath', 'auto', ...args]);
  } catch {
    /* commander exitOverride — the assertions below are what matter */
  } finally {
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
  }
}

let tmpDir: string;
let dbPath: string;
let projectRoot: string;
let savedEnvKey: string | undefined;

beforeEach(() => {
  savedEnvKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  tmpDir = mkdtempSync(join(tmpdir(), 'nexpath-env-supply-'));
  dbPath = join(tmpDir, 'store.db');
  projectRoot = join(tmpDir, 'project');
  // A Next.js project with git and a lockfile. The `.git` also anchors the probe HERE, so a stray
  // repository higher up the machine's tree can never be probed instead.
  mkdirSync(join(projectRoot, '.git'), { recursive: true });
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '^14.0.0' } }));
  writeFileSync(join(projectRoot, 'package-lock.json'), '{}\n');
});

afterEach(() => {
  if (savedEnvKey === undefined) delete process.env.OPENAI_API_KEY;
  else                            process.env.OPENAI_API_KEY = savedEnvKey;
  vi.restoreAllMocks();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function storedFacts(): Promise<Record<string, { value: unknown }> | null> {
  const { openStore, closeStore } = await import('../../store/db.js');
  const { getProjectEnvFacts } = await import('../../store/env-facts.js');
  const store = await openStore(dbPath);
  try {
    return (getProjectEnvFacts(store, projectRoot)?.facts ?? null) as Record<string, { value: unknown }> | null;
  } finally {
    closeStore(store);
  }
}

// The auto command's module graph is large: importing it cold took 3.2 s alone and 5.2 s inside the full suite, past
// vitest's 5 s default. It is imported once here, and each case gets a limit that measures the store, not the import.
beforeAll(async () => { await import('./auto.js'); }, 60_000);

describe('the first prompt of a session stores the probe facts the enhancement reads', { timeout: 30_000 }, () => {
  it('with no `nexpath env` ever run, the facts are there after the first prompt', async () => {
    expect(await storedFacts()).toBeNull();
    await runAutoCommand(['--project', projectRoot, '--db', dbPath, 'add a settings page for the display name']);
    const facts = await storedFacts();
    expect(facts, 'no probe facts stored — the popup would still need a manual command').not.toBeNull();
    expect(facts!['project_framework']?.value).toBe('nextjs');
    expect(facts!['has_version_control']?.value).toBe(true);
    expect(facts!['has_lockfile']?.value).toBe(true);
  });

  it('CONTROL — consent off: nothing is probed into the store', async () => {
    const { openStore, closeStore } = await import('../../store/db.js');
    const { setConfig } = await import('../../store/config.js');
    const store = await openStore(dbPath);
    setConfig(store, 'env_probe_enabled', 'false');
    closeStore(store);
    await runAutoCommand(['--project', projectRoot, '--db', dbPath, 'add a settings page for the display name']);
    const { getProjectEnvFacts } = await import('../../store/env-facts.js');
    const reopened = await openStore(dbPath);
    try {
      // Read the raw row: the getter is consent-gated and would say null either way.
      const raw = reopened.db.exec('SELECT env_facts FROM projects')[0]?.values[0]?.[0] ?? null;
      expect(raw).toBeNull();
      expect(getProjectEnvFacts(reopened, projectRoot)).toBeNull();
    } finally {
      closeStore(reopened);
    }
  });

  it('CONTROL — facts a user stored themselves are never overwritten', async () => {
    const { openStore, closeStore } = await import('../../store/db.js');
    const { upsertProject } = await import('../../store/projects.js');
    const { setProjectEnvFacts } = await import('../../store/env-facts.js');
    const store = await openStore(dbPath);
    upsertProject(store, { projectRoot, name: 'project' });
    const mine = { project_framework: { value: 'remix', confidence: 'high', detectedAt: 1 } };
    setProjectEnvFacts(store, projectRoot, mine as never, 1);
    closeStore(store);
    await runAutoCommand(['--project', projectRoot, '--db', dbPath, 'add a settings page for the display name']);
    expect(await storedFacts()).toEqual(mine);
  });
});
