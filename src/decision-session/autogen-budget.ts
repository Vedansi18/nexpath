/**
 * Per-user auto-gen LLM budget gate.
 *
 * Caps the auto-gen LLM spend (the ranking + per-topic generation calls) against a
 * monthly budget. The budget FIGURE is an internal business constraint and is NEVER
 * hardcoded in this public source — it is supplied at deploy time via the env var
 * below (or a config override). When neither is set the gate is OPEN (uncapped), so
 * this file carries no dollar/limit figure of its own.
 *
 * Spend is tracked as a per-project monthly call count in the config store; the
 * gate compares it to the configured budget. Fail-open: a gate read never throws.
 */

import { getConfig, setConfig } from '../store/config.js';
import type { Store } from '../store/db.js';

/** Deploy-time monthly auto-gen call budget (integer). Unset ⇒ uncapped. */
export const AUTOGEN_BUDGET_ENV = 'NEXPATH_AUTOGEN_CALL_BUDGET';
/** Config override for the same budget (takes second place to the env var). */
export const AUTOGEN_BUDGET_CONFIG_KEY = 'autogen_call_budget';

function monthKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const spendKey = (projectRoot: string, now: number): string => `autogen_calls:${projectRoot}:${monthKey(now)}`;

/**
 * The configured monthly call budget, or undefined when uncapped. Reads the env
 * first, then a config override. No figure is defined here — an unset budget means
 * no cap.
 */
export function autogenCallBudget(store: Store, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[AUTOGEN_BUDGET_ENV] ?? getConfig(store.db, AUTOGEN_BUDGET_CONFIG_KEY);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** The auto-gen LLM calls already made for a project this month. */
export function autogenCallsThisMonth(store: Store, projectRoot: string, now: number = Date.now()): number {
  const raw = getConfig(store.db, spendKey(projectRoot, now));
  const n = raw === undefined ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Whether another auto-gen LLM call is within budget (always true when uncapped). */
export function autogenBudgetAllows(store: Store, projectRoot: string, now: number = Date.now()): boolean {
  const budget = autogenCallBudget(store);
  return budget === undefined || autogenCallsThisMonth(store, projectRoot, now) < budget;
}

/** Record one auto-gen LLM call against this month's counter. */
export function recordAutogenCall(store: Store, projectRoot: string, now: number = Date.now()): void {
  setConfig(store, spendKey(projectRoot, now), String(autogenCallsThisMonth(store, projectRoot, now) + 1));
}
