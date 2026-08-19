/**
 * Storage for dev-environment probe facts, with consent gating.
 *
 * Project-scoped facts live on the `projects` row (`env_facts` JSON +
 * `env_facts_detected_at`); machine-scoped facts live in the `config` table
 * under one JSON key. Everything is local-only — nothing is ever synced.
 *
 * Consent (`env_probe_enabled`, default ON):
 *  - READ gate: while disabled, every getter returns null so NO consumer can see
 *    stored facts — even if rows still exist on disk for a moment.
 *  - Auto-purge: turning consent off purges the stored facts (`purgeAllEnvFacts`,
 *    wired into the config setter) and `nexpath env --clear` purges on demand.
 */

import type { Database } from 'sql.js';
import { saveStore, type Store } from './db.js';
import { getConfig, deleteConfig } from './config.js';
import type { FactMap } from '../env/types.js';

export const ENV_PROBE_ENABLED_KEY = 'env_probe_enabled';
/** Config key holding the machine-scoped facts JSON (machine, not per-project). */
export const MACHINE_FACTS_KEY = 'env_machine_facts';

/** Stored facts plus when they were detected. */
export interface StoredFacts {
  facts: FactMap;
  detectedAt: number;
}

/** True unless consent has been explicitly turned off (default ON). */
export function isEnvProbeEnabled(db: Database): boolean {
  return getConfig(db, ENV_PROBE_ENABLED_KEY) !== 'false';
}

function parseFactMap(json: string | null | undefined): FactMap | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as FactMap;
  } catch {
    return null;
  }
}

// ── Project-scoped facts ─────────────────────────────────────────────────────

/**
 * Project rows are keyed by whatever path STRING the entry point happened to produce, and the
 * entry points disagree: `auto` registers `--project` verbatim, while `nexpath env` persists under
 * `resolve()`'d form — backslashes on Windows. Matching on the raw string therefore missed the row
 * and, because these are UPDATEs, missed it SILENTLY: `env_facts` was populated for 0 of 20
 * projects in a real store with 1,136 prompts (bug record §17.8).
 *
 * Every project-scoped accessor here matches on a separator-normalised comparison instead, so the
 * lookup is insensitive to which form registered the row. ⛔ This deliberately does NOT normalise
 * `upsertProject`/`getProject` — project IDENTITY across every other table stays exactly as it is;
 * only these lookups become form-insensitive.
 */
const PROJECT_ROOT_MATCHES = "REPLACE(project_root, '\\', '/') = REPLACE(?, '\\', '/')";

/** Store project facts on the projects row. No-op if the project is not registered. */
export function setProjectEnvFacts(
  store: Store,
  projectRoot: string,
  facts: FactMap,
  detectedAt: number,
): boolean {
  store.db.run(
    `UPDATE projects SET env_facts = ?, env_facts_detected_at = ? WHERE ${PROJECT_ROOT_MATCHES}`,
    [JSON.stringify(facts), detectedAt, projectRoot],
  );
  // §17.8: an UPDATE that matches nothing is indistinguishable from a successful store unless it
  // says so. Returning the outcome lets the caller stop reporting success it did not achieve.
  const stored = store.db.getRowsModified() > 0;
  saveStore(store);
  return stored;
}

/** Read project facts, or null when absent OR while consent is disabled (gated). */
export function getProjectEnvFacts(store: Store, projectRoot: string): StoredFacts | null {
  if (!isEnvProbeEnabled(store.db)) return null;
  const res = store.db.exec(
    `SELECT env_facts, env_facts_detected_at FROM projects WHERE ${PROJECT_ROOT_MATCHES}`,
    [projectRoot],
  );
  const row = res[0]?.values[0];
  if (!row) return null;
  const facts = parseFactMap(row[0] as string | null);
  if (!facts) return null;
  return { facts, detectedAt: (row[1] as number | null) ?? 0 };
}

// ── Env-trajectory state (baseline + pending, for change-event flap damping) ──

/**
 * The per-project trajectory state: `baseline` = the last CONFIRMED fact values (the
 * change-event reference), `pending` = the most recent raw probe (used to require a value
 * be stable across two consecutive probes before a change is confirmed — S4 flap damping).
 */
export interface EnvTrajectoryState {
  baseline: FactMap;
  pending: FactMap;
}

/** Read the trajectory state, or null when absent OR while consent is disabled (gated). */
export function getEnvTrajectory(store: Store, projectRoot: string): EnvTrajectoryState | null {
  if (!isEnvProbeEnabled(store.db)) return null;
  const res = store.db.exec(`SELECT env_trajectory FROM projects WHERE ${PROJECT_ROOT_MATCHES}`, [projectRoot]);
  const raw = res[0]?.values[0]?.[0] as string | null | undefined;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EnvTrajectoryState;
    if (!parsed || typeof parsed !== 'object' || !parsed.baseline || !parsed.pending) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the trajectory state on the projects row. No-op if the project is not registered. */
export function setEnvTrajectory(store: Store, projectRoot: string, state: EnvTrajectoryState): void {
  store.db.run(
    `UPDATE projects SET env_trajectory = ? WHERE ${PROJECT_ROOT_MATCHES}`,
    [JSON.stringify(state), projectRoot],
  );
  saveStore(store);
}

// ── Machine-scoped facts ─────────────────────────────────────────────────────

/** Store machine facts in the config table (one JSON blob). */
export function setMachineFacts(store: Store, facts: FactMap, detectedAt: number): void {
  store.db.run(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [MACHINE_FACTS_KEY, JSON.stringify({ facts, detectedAt } satisfies StoredFacts)],
  );
  saveStore(store);
}

/** Read machine facts, or null when absent OR while consent is disabled (gated). */
export function getMachineFacts(store: Store): StoredFacts | null {
  if (!isEnvProbeEnabled(store.db)) return null;
  const raw = getConfig(store.db, MACHINE_FACTS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredFacts;
    if (!parsed || typeof parsed !== 'object' || !parsed.facts) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Purge (consent-off auto-purge + `nexpath env --clear`) ───────────────────

/** Clear stored facts + trajectory state for one project, or all projects when no root is given. */
export function clearProjectEnvFacts(store: Store, projectRoot?: string): void {
  if (projectRoot) {
    store.db.run(
      `UPDATE projects SET env_facts = NULL, env_facts_detected_at = NULL, env_trajectory = NULL WHERE ${PROJECT_ROOT_MATCHES}`,
      [projectRoot],
    );
  } else {
    store.db.run('UPDATE projects SET env_facts = NULL, env_facts_detected_at = NULL, env_trajectory = NULL');
  }
  saveStore(store);
}

/** Purge ALL stored facts + trajectory state (project rows + machine blob). Used on consent-off. */
export function purgeAllEnvFacts(store: Store): void {
  store.db.run('UPDATE projects SET env_facts = NULL, env_facts_detected_at = NULL, env_trajectory = NULL');
  deleteConfig(store, MACHINE_FACTS_KEY);
  saveStore(store);
}

// ── Prompt-derived extracted params (A3 step 7, cached) ──────────────────────

/** One mined key/value from the user's own recent prompts. */
export interface PromptDerivedFact {
  readonly key: string;
  readonly value: string;
}

/**
 * A3 step 7 required the engine's `ExtractedParam` output to cross into PE. That extractor is an
 * LLM call and used to run inside the decision-session engine — which fired occasionally, over a
 * 5-prompt window, and is now disabled outright (`stop.ts` MPS-7). PE runs on EVERY prompt, so
 * wiring the extractor straight into the boundary would have turned an occasional call into a
 * per-prompt one.
 *
 * 🔒 Owner ruling: mine over a window and CACHE it, refreshing only after a threshold of new
 * prompts. These accessors are that cache — deliberately shaped like `env_facts`, including the
 * separator-insensitive key match (§17.8).
 */
export function setPromptDerivedFacts(
  store: Store,
  projectRoot: string,
  facts: readonly PromptDerivedFact[],
  detectedAt: number,
  atPromptCount: number,
): boolean {
  store.db.run(
    `UPDATE projects SET prompt_facts = ?, prompt_facts_detected_at = ?, prompt_facts_at_count = ?
      WHERE ${PROJECT_ROOT_MATCHES}`,
    [JSON.stringify(facts), detectedAt, atPromptCount, projectRoot],
  );
  const stored = store.db.getRowsModified() > 0;
  saveStore(store);
  return stored;
}

/** Read the cached prompt-derived facts, or null when never mined. */
export function getPromptDerivedFacts(
  store: Store,
  projectRoot: string,
): { facts: readonly PromptDerivedFact[]; detectedAt: number; atPromptCount: number } | null {
  const res = store.db.exec(
    `SELECT prompt_facts, prompt_facts_detected_at, prompt_facts_at_count FROM projects
      WHERE ${PROJECT_ROOT_MATCHES}`,
    [projectRoot],
  );
  const row = res[0]?.values?.[0];
  if (!row || row[0] == null) return null;
  try {
    const facts = JSON.parse(String(row[0])) as PromptDerivedFact[];
    if (!Array.isArray(facts)) return null;
    return { facts, detectedAt: Number(row[1] ?? 0), atPromptCount: Number(row[2] ?? 0) };
  } catch {
    return null;
  }
}

/**
 * Is a refresh due? True when never mined, or when the threshold of NEW prompts has accumulated
 * since the last mine. ⛔ The only cost dial in this feature — one LLM call per threshold crossing,
 * per project. Owner-set at 25.
 */
export const PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS = 25;

export function promptDerivedFactsRefreshDue(
  store: Store,
  projectRoot: string,
  currentPromptCount: number,
): boolean {
  const cached = getPromptDerivedFacts(store, projectRoot);
  if (!cached) return true;
  return currentPromptCount - cached.atPromptCount >= PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS;
}
