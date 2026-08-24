/**
 * RC50 — duplicate hook-invocation guard (Bhavnesh's 2026-08-23 report §8.1).
 *
 * Cursor on the tester's machine executes THREE registrations per submit:
 * the project-level `.cursor/hooks.json` (RC34), a byte-identical user-level
 * one, and a stale `~/.claude/settings.json` entry. Every registration runs
 * the same command — so once delivery works, one submit would open one popup
 * PER REGISTRATION. Cursor's payload carries a per-submit `generation_id`;
 * the first invocation records it, later ones with the same key answer
 * `continue` immediately (never a second popup, never a second `auto`).
 *
 * Fail-open by construction: no generation id, unreadable registry, or any fs
 * error ⇒ NOT a duplicate ⇒ exactly today's behaviour.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CURSOR_INVOCATION_REGISTRY_FILENAME = 'cursor-hook-invocations.json';
export const CURSOR_INVOCATION_MAX_ENTRIES = 16;
export const CURSOR_INVOCATION_MAX_AGE_MS = 10 * 60_000;

export function cursorInvocationRegistryPath(projectRoot: string): string {
  return join(projectRoot, '.nexpath', CURSOR_INVOCATION_REGISTRY_FILENAME);
}

/**
 * True when this (event, generationId) was already recorded inside the window
 * — the caller should answer `continue` and do nothing else. On first sight
 * the key is recorded and false is returned.
 */
export function checkAndRecordCursorInvocation(
  projectRoot: string,
  event: string,
  generationId: string | undefined,
  deps: {
    now?: () => number;
    readFileFn?: (p: string) => string;
    writeFileFn?: (p: string, d: string) => void;
  } = {},
): boolean {
  try {
    if (!generationId) return false;
    const now = deps.now ?? (() => Date.now());
    const path = cursorInvocationRegistryPath(projectRoot);
    const key = `${event}:${generationId}`;
    let entries: Array<{ key: string; at: number }> = [];
    try {
      const parsed = JSON.parse((deps.readFileFn ?? ((p: string) => readFileSync(p, 'utf8')))(path)) as unknown;
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (e): e is { key: string; at: number } =>
            !!e && typeof (e as { key?: unknown }).key === 'string' && typeof (e as { at?: unknown }).at === 'number',
        );
      }
    } catch { /* absent/corrupt ⇒ fresh */ }
    const t = now();
    entries = entries.filter((e) => t - e.at <= CURSOR_INVOCATION_MAX_AGE_MS);
    if (entries.some((e) => e.key === key)) return true;
    entries.push({ key, at: t });
    if (entries.length > CURSOR_INVOCATION_MAX_ENTRIES) entries = entries.slice(-CURSOR_INVOCATION_MAX_ENTRIES);
    const write = deps.writeFileFn ?? ((p: string, d: string) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, d, 'utf8');
    });
    write(path, JSON.stringify(entries));
    return false;
  } catch {
    return false; // fail-open — never block the primary invocation
  }
}
