import type { ClockPort } from '../../core/ports/clock.port.js';

export class BrowserClockAdapter implements ClockPort {
  now(): number {
    return Date.now();
  }
}
