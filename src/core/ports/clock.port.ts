/**
 * ClockPort — abstracts wall-clock access for testability.
 *
 * CLI/browser implementation: SystemClockAdapter (returns Date.now()).
 */
export interface ClockPort {
  now(): number;
}
