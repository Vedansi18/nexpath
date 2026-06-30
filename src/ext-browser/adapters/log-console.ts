import type { LogPort } from '../../core/ports/log.port.js';

export class ConsoleLogAdapter implements LogPort {
  constructor(private readonly prefix = '[nexpath]') {}

  debug(key: string, data?: Record<string, unknown>): void {
    console.debug(this.prefix, key, data ?? '');
  }

  info(key: string, data?: Record<string, unknown>): void {
    console.info(this.prefix, key, data ?? '');
  }

  warn(key: string, data?: Record<string, unknown>): void {
    console.warn(this.prefix, key, data ?? '');
  }
}
