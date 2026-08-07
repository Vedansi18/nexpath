import { describe, it, expect, vi } from 'vitest';
import { isPeOriginTurn } from './pe-origin.js';
import type { PendingPromptEnhancementRow } from './pe-store-reader.js';

const fakePe: PendingPromptEnhancementRow = {
  id: 1,
  projectRoot: '/proj',
  sessionId: 'sess-1',
  promptCount: 1,
  status: 'pending',
  createdAt: 1700000000000,
  requestJson: '{"prompt":"x"}',
  resultJson: '{"body":"y"}',
};

describe('isPeOriginTurn', () => {
  it('returns true when a pending PE row exists for the project', async () => {
    const readPendingPe = vi.fn().mockResolvedValue(fakePe);
    expect(await isPeOriginTurn('/proj', { readPendingPe })).toBe(true);
    expect(readPendingPe).toHaveBeenCalledWith('/proj', { dbPath: undefined });
  });

  it('returns false when no pending PE row exists', async () => {
    const readPendingPe = vi.fn().mockResolvedValue(null);
    expect(await isPeOriginTurn('/proj', { readPendingPe })).toBe(false);
  });

  it('forwards an explicit dbPath override', async () => {
    const readPendingPe = vi.fn().mockResolvedValue(null);
    await isPeOriginTurn('/proj', { readPendingPe, dbPath: '/custom/db' });
    expect(readPendingPe).toHaveBeenCalledWith('/proj', { dbPath: '/custom/db' });
  });

  it('is fail-safe: a rejected reader is treated as DS-origin (false), never throws', async () => {
    const readPendingPe = vi.fn().mockRejectedValue(new Error('store unavailable'));
    await expect(isPeOriginTurn('/proj', { readPendingPe })).resolves.toBe(false);
  });

  it('uses the real readPendingPromptEnhancement by default (wiring smoke test)', async () => {
    // No injected reader, no dbPath under a project root that certainly has no
    // pending PE row — proves the default wiring resolves and returns false
    // rather than throwing, without needing a real store file.
    await expect(isPeOriginTurn('/definitely-not-a-real-project-root-zzq')).resolves.toBe(false);
  });
});
