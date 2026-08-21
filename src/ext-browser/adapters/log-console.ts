import type { LogPort } from '../../core/ports/log.port.js';

export class ConsoleLogAdapter implements LogPort {
  constructor(private readonly prefix = '[nexpath]') {}

  // console.log, not .debug — Chrome DevTools categorizes .debug output as "Verbose",
  // which is hidden by default in the console's level filter. Most of the SW's own
  // diagnostic output goes through this method, so keeping it default-visible matters
  // for anyone actually checking the SW console while testing.
  debug(key: string, data?: Record<string, unknown>): void {
    console.log(this.prefix, key, data ?? '');
  }

  info(key: string, data?: Record<string, unknown>): void {
    console.info(this.prefix, key, data ?? '');
  }

  warn(key: string, data?: Record<string, unknown>): void {
    console.warn(this.prefix, key, data ?? '');
  }
}
