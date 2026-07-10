/**
 * A version-stamped registry of the coding agents nexpath integrates with and the
 * operating modes each exposes. Every known mode is classified onto a coarse operating
 * band — planning/read-only, normal, or autonomous execution — so downstream checks can
 * compare the agent's current mode against what the work in progress calls for.
 *
 * The mode vocabulary evolves between agent releases, so the map is OPEN: a mode (or an
 * agent) that is not listed resolves to `undefined` — an unrecognised or newer mode is
 * treated as neutral, never forced into a band.
 */

/** The coarse operating band a mode represents: read-only/planning, normal, or autonomous. */
export type ModeBand = 'plan' | 'normal' | 'execute';

export interface AgentCapabilities {
  /**
   * The date the agent's mode vocabulary was last confirmed against its documentation.
   * Bump it when the mode set is re-verified against a newer agent release.
   */
  version: string;
  /** Known mode identifier → the operating band it represents. */
  modes: Record<string, ModeBand>;
}

/**
 * Per-agent capability registry. Only the one integrated agent is present today; entries
 * are added as further agents are integrated.
 */
export const AGENT_CAPABILITIES: Record<string, AgentCapabilities> = {
  'claude-code': {
    version: '2026-06-11',
    modes: {
      plan:              'plan',
      default:           'normal',
      acceptEdits:       'execute',
      auto:              'execute',
      dontAsk:           'execute',
      bypassPermissions: 'execute',
    },
  },
};

/**
 * Resolve the operating band for a given agent + mode. Returns `undefined` when the agent
 * is unknown, the mode is unknown, or no mode is supplied — an unrecognised value is never
 * forced into a band.
 */
export function resolveModeBand(agentId: string, mode: string | undefined): ModeBand | undefined {
  if (mode === undefined) return undefined;
  return AGENT_CAPABILITIES[agentId]?.modes[mode];
}
