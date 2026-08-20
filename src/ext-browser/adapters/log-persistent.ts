import browser from 'webextension-polyfill';
import type { LogPort } from '../../core/ports/log.port.js';

/**
 * LogPort decorator that mirrors every event into a rolling buffer in
 * storage.local, alongside the wrapped adapter's normal console output.
 *
 * Why: MV3 tears the service worker down after ~30s idle and its console
 * history dies with the instance — a tester opening the SW DevTools after the
 * fact sees an empty console even though the pipeline ran fine (confirmed live
 * 2026-07-06). The CLI solved the same problem with a durable `nexpath log`;
 * this buffer is the browser equivalent, surfaced on the options page and via
 * the content script's whitelisted debug channel.
 */
export const RECENT_EVENTS_KEY = 'nexpath_recent_events';
export const RECENT_EVENTS_CAP = 100;

export interface PersistedLogEvent {
  at: number;
  level: 'debug' | 'info' | 'warn';
  key: string;
  data?: Record<string, unknown>;
}

export class PersistentLogAdapter implements LogPort {
  // Appends are read-modify-write on one storage key — chain them so two events
  // logged in the same tick can't clobber each other's write.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly inner: LogPort) {}

  debug(key: string, data?: Record<string, unknown>): void {
    this.inner.debug(key, data);
    this.append('debug', key, data);
  }

  info(key: string, data?: Record<string, unknown>): void {
    this.inner.info(key, data);
    this.append('info', key, data);
  }

  warn(key: string, data?: Record<string, unknown>): void {
    this.inner.warn(key, data);
    this.append('warn', key, data);
  }

  /** Resolves when all appends issued so far have been written (for tests/shutdown). */
  flush(): Promise<void> {
    return this.writeChain;
  }

  private append(level: PersistedLogEvent['level'], key: string, data?: Record<string, unknown>): void {
    const event: PersistedLogEvent = { at: Date.now(), level, key, ...(data !== undefined ? { data } : {}) };
    this.writeChain = this.writeChain.then(async () => {
      try {
        const result = await browser.storage.local.get(RECENT_EVENTS_KEY);
        const raw = result[RECENT_EVENTS_KEY];
        let events: PersistedLogEvent[] = [];
        if (typeof raw === 'string' && raw.length > 0) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) events = parsed as PersistedLogEvent[];
          } catch {
            // corrupted buffer — start fresh rather than losing new events too
          }
        }
        events.push(event);
        if (events.length > RECENT_EVENTS_CAP) events = events.slice(-RECENT_EVENTS_CAP);
        await browser.storage.local.set({ [RECENT_EVENTS_KEY]: JSON.stringify(events) });
      } catch {
        // storage unavailable — console output (inner adapter) already happened;
        // never let the log buffer break the pipeline.
      }
    });
  }
}
