/**
 * LogPort — abstracts structured debug/info logging.
 *
 * CLI implementation: LoggerAdapter (wraps nexpath file logger).
 * Browser implementation: ConsoleLogAdapter (uses console.debug/info).
 */
export interface LogPort {
  debug(key: string, data?: Record<string, unknown>): void;
  info(key: string, data?: Record<string, unknown>): void;
  warn(key: string, data?: Record<string, unknown>): void;
}
