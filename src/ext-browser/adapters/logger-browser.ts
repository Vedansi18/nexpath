/**
 * Browser-safe drop-in for src/logger.ts.
 *
 * The CLI logger writes to ~/.nexpath/nexpath.log via node:fs — impossible in a
 * service worker / content script. The engine modules (OptionGenerator and its
 * runtime-substitution deps) import the global `logger` directly, so when they
 * are pulled into the extension bundle the build must resolve `logger` to this
 * file instead (see scripts/build-ext.mjs onResolve plugin).
 *
 * Same public surface as src/logger.ts (logger / log / initLogger / getLevel /
 * LogLevel / LOG_PATH) so any importer resolves. Output routes to the console,
 * gated by the same level ranking; `debug` is suppressed by default exactly like
 * the CLI, so engine internals stay quiet unless the level is raised. Never
 * throws — logging must not crash the advisory pipeline.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn:  1,
  info:  2,
  debug: 3,
};

/** No filesystem in the browser — kept only so importers of the name resolve. */
export const LOG_PATH = '';

let _level: LogLevel = 'info';

export function initLogger(_command: string, level?: LogLevel): void {
  if (level) _level = level;
}

export function getLevel(): LogLevel {
  return _level;
}

export function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] > LEVEL_RANK[_level]) return;
  try {
    const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level;
    // eslint-disable-next-line no-console
    (console[method] ?? console.log)(`[nexpath] ${event}`, data ?? '');
  } catch {
    // console failure must never crash the pipeline
  }
}

export const logger = {
  error: (event: string, data?: Record<string, unknown>) => log('error', event, data),
  warn:  (event: string, data?: Record<string, unknown>) => log('warn',  event, data),
  info:  (event: string, data?: Record<string, unknown>) => log('info',  event, data),
  debug: (event: string, data?: Record<string, unknown>) => log('debug', event, data),
};
