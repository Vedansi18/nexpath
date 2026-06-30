import { logger } from '../../logger.js';
import type { LogPort } from '../../core/ports/log.port.js';

/**
 * LoggerAdapter — wires LogPort to the existing nexpath file logger.
 *
 * Used by core pipeline functions (runStage2, classifyUserProfileLLM, etc.) so
 * that debug output still flows to ~/.nexpath/nexpath.log in CLI mode.
 */
export const loggerAdapter: LogPort = {
  debug: (event, data) => logger.debug(event, data),
  info:  (event, data) => logger.info(event, data),
  warn:  (event, data) => logger.warn(event, data),
};
