import { describe, it, expect, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProgram } from '../index.js';
import { openStore, closeStore } from '../../store/db.js';
import { isFeedbackEligible } from '../../store/feedback-cadence.js';

describe('feedback-test command', () => {
  it('is registered as a top-level command but hidden from --help', () => {
    const prog = createProgram();
    const cmd = prog.commands.find((c) => c.name() === 'feedback-test');
    expect(cmd).toBeDefined();
    expect(prog.helpInformation()).not.toContain('feedback-test');
  });

  it('primes the cadence so the popup is eligible on the next Stop', async () => {
    const dbPath = join(tmpdir(), `nexpath-fbtest-${randomUUID()}.db`);
    try {
      const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const prog = createProgram();
      await prog.parseAsync(['node', 'nexpath', 'feedback-test', '--db', dbPath]);
      out.mockRestore();

      const store = await openStore(dbPath);
      expect(isFeedbackEligible(store)).toBe(true);
      closeStore(store);
    } finally {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}.lock`, { force: true });
    }
  });
});
