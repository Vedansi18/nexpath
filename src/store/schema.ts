import type { Database } from 'sql.js';

/**
 * Current row schema version stamped onto rows in versioned tables
 * (`content_templates`, `user_depth_level`, and the param-event log).
 * Readers accept any row whose `schema_version` is <= this value; rows written
 * by a newer, not-yet-understood writer are ignored so the caller can fall back
 * to its built-in default. New writer versions only ADD fields — they never
 * reinterpret existing ones — so old rows are never rewritten.
 */
export const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS prompts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root TEXT    NOT NULL,
  prompt_text  TEXT    NOT NULL,
  agent        TEXT,
  captured_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompts_project_id
  ON prompts (project_root, id);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root           TEXT    NOT NULL UNIQUE,
  name                   TEXT    NOT NULL,
  project_type           TEXT,
  language               TEXT,
  description            TEXT,
  detected_language      TEXT,
  decision_session_count INTEGER NOT NULL DEFAULT 0,
  env_facts              TEXT,
  env_facts_detected_at  INTEGER,
  env_trajectory         TEXT,
  created_at             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_states (
  project_root TEXT    PRIMARY KEY,
  session_id   TEXT    NOT NULL,
  state_json   TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skipped_sessions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root            TEXT    NOT NULL,
  session_id              TEXT    NOT NULL,
  flag_type               TEXT    NOT NULL,
  stage                   TEXT    NOT NULL,
  level_reached           INTEGER NOT NULL,
  skipped_at_prompt_count INTEGER NOT NULL,
  skipped_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skipped_sessions_project
  ON skipped_sessions (project_root, skipped_at);

CREATE TABLE IF NOT EXISTS pending_advisories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root TEXT    NOT NULL,
  stage        TEXT    NOT NULL,
  flag_type    TEXT    NOT NULL,
  pinch_label  TEXT    NOT NULL,
  session_id   TEXT    NOT NULL,
  prompt_count INTEGER NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  generated_l1 TEXT,
  generated_l2 TEXT,
  generated_l3 TEXT,
  prev_stage   TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_advisories_project
  ON pending_advisories (project_root, status, created_at);

CREATE TABLE IF NOT EXISTS feedback_signals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root TEXT    NOT NULL,
  kind         TEXT    NOT NULL,   -- 'advisory_fired' | 'option_selected'
  occurred_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_signals_project
  ON feedback_signals (project_root, occurred_at);

-- Per-project generated + user-uploaded option-content templates, keyed by
-- (project_root, signal_type, source). Shipped defaults live in source code,
-- NOT here. record_json holds the serializable template payload as written;
-- its shape is validated by the content-template engine on read. schema_version
-- enables forward-compatible reads (see SCHEMA_VERSION).
CREATE TABLE IF NOT EXISTS content_templates (
  project_root   TEXT    NOT NULL,
  signal_type    TEXT    NOT NULL,
  source         TEXT    NOT NULL,
  record_json    TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (project_root, signal_type, source)
);

-- Per-project workflow-maturity level + graduation state. A running aggregate
-- that survives prompt pruning: current_level is the user's detected maturity
-- band; the counters + timestamp drive graduation / down-graduation.
CREATE TABLE IF NOT EXISTS user_depth_level (
  project_root       TEXT    NOT NULL PRIMARY KEY,
  current_level      INTEGER NOT NULL,
  stability_counter  INTEGER NOT NULL DEFAULT 0,
  last_graduation_at INTEGER,
  hysteresis_counter INTEGER NOT NULL DEFAULT 0,
  schema_version     INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_enhancement_memory (
  project_root          TEXT    NOT NULL,
  signal_key            TEXT    NOT NULL,
  schema_version        INTEGER NOT NULL,
  evidence_count        INTEGER NOT NULL DEFAULT 0,
  positive_count        INTEGER NOT NULL DEFAULT 0,
  negative_count        INTEGER NOT NULL DEFAULT 0,
  current_evidence_state TEXT   NOT NULL,
  confidence_band       TEXT    NOT NULL,
  source_strength       TEXT    NOT NULL,
  protection_state      TEXT    NOT NULL,
  fatigue_state         TEXT    NOT NULL,
  suppression_state     TEXT    NOT NULL,
  last_used_at          INTEGER,
  last_evidence_at      INTEGER,
  decay_after           INTEGER,
  status                TEXT    NOT NULL,
  reason_codes_json     TEXT    NOT NULL,
  provenance_json       TEXT    NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (project_root, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_pe_memory_project_updated
  ON prompt_enhancement_memory (project_root, updated_at);

CREATE TABLE IF NOT EXISTS prompt_enhancement_source_use (
  source_use_id        TEXT    PRIMARY KEY,
  project_root         TEXT    NOT NULL,
  enhancement_id       TEXT    NOT NULL,
  body_id              TEXT    NOT NULL,
  body_revision        INTEGER NOT NULL,
  source_kind          TEXT    NOT NULL,
  source_id            TEXT    NOT NULL,
  section_ids_json     TEXT    NOT NULL,
  use_kind             TEXT    NOT NULL,
  memory_evidence      INTEGER NOT NULL DEFAULT 0,
  schema_version       INTEGER NOT NULL,
  reason_codes_json    TEXT    NOT NULL,
  created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pe_source_use_project_body
  ON prompt_enhancement_source_use (project_root, body_id, body_revision);

CREATE TABLE IF NOT EXISTS prompt_enhancement_generated_origin (
  generated_origin_id          TEXT    PRIMARY KEY,
  project_root                 TEXT    NOT NULL,
  enhancement_id               TEXT    NOT NULL,
  body_id                      TEXT    NOT NULL,
  body_revision                INTEGER NOT NULL,
  generated_origin_state       TEXT    NOT NULL,
  delivery_channel             TEXT    NOT NULL,
  prompt_submit_processing_policy TEXT NOT NULL,
  learning_eligible            INTEGER NOT NULL DEFAULT 0,
  learning_eligibility_json     TEXT    NOT NULL,
  source_use_ids_json          TEXT    NOT NULL,
  action_ids_json              TEXT    NOT NULL,
  fallback_state               TEXT    NOT NULL,
  privacy_storage_policy       TEXT    NOT NULL,
  schema_version               INTEGER NOT NULL,
  reason_codes_json            TEXT    NOT NULL,
  created_at                   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pe_generated_origin_project_body
  ON prompt_enhancement_generated_origin (project_root, body_id, body_revision);

CREATE TABLE IF NOT EXISTS prompt_enhancement_feedback (
  feedback_event_id     TEXT    PRIMARY KEY,
  project_root          TEXT    NOT NULL,
  enhancement_id        TEXT    NOT NULL,
  body_id               TEXT    NOT NULL,
  body_revision         INTEGER NOT NULL,
  feedback_category     TEXT    NOT NULL,
  feedback_scope_key    TEXT    NOT NULL,
  learning_eligibility  TEXT    NOT NULL,
  safety_impact_state   TEXT    NOT NULL,
  raw_text_stored       INTEGER NOT NULL DEFAULT 0,
  memory_evidence       INTEGER NOT NULL DEFAULT 0,
  schema_version        INTEGER NOT NULL,
  reason_codes_json     TEXT    NOT NULL,
  created_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pe_feedback_project_body
  ON prompt_enhancement_feedback (project_root, body_id, body_revision);

CREATE TABLE IF NOT EXISTS prompt_enhancement_status (
  project_root       TEXT    NOT NULL,
  status_key         TEXT    NOT NULL,
  status_value       TEXT    NOT NULL,
  schema_version     INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (project_root, status_key)
);

CREATE INDEX IF NOT EXISTS idx_pe_status_project_updated
  ON prompt_enhancement_status (project_root, updated_at);
`;

export function migrate(db: Database): void {
  db.run(DDL);
}

/**
 * Silently apply incremental schema migrations — no console output.
 * Safe to call from openStore() on every startup; each step checks column
 * existence before attempting ALTER TABLE.
 */
export function applyIncrementalMigrations(db: Database): void {
  const addIfMissing = (table: string, column: string, definition: string): void => {
    const res = db.exec(`PRAGMA table_info(${table})`);
    const cols = (res[0]?.values ?? []).map((row) => row[1] as string);
    if (!cols.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  // v0.1.1 — Phase B
  addIfMissing('projects', 'detected_language',      'TEXT');
  addIfMissing('projects', 'decision_session_count', 'INTEGER NOT NULL DEFAULT 0');

  // v0.1.1 — options-text-generation
  addIfMissing('pending_advisories', 'generated_l1', 'TEXT');
  addIfMissing('pending_advisories', 'generated_l2', 'TEXT');
  addIfMissing('pending_advisories', 'generated_l3', 'TEXT');

  // sub-10 — deferred option gen + cross-session guard
  addIfMissing('pending_advisories', 'prev_stage', 'TEXT');

  // v0.1.1 — dev-environment probe
  addIfMissing('projects', 'env_facts',             'TEXT');
  addIfMissing('projects', 'env_facts_detected_at', 'INTEGER');
  addIfMissing('projects', 'env_trajectory',        'TEXT');

  // sub-11 prompt enhancement store contract
  addIfMissing('prompt_enhancement_source_use', 'section_ids_json', "TEXT NOT NULL DEFAULT '[]'");
  addIfMissing('prompt_enhancement_generated_origin', 'learning_eligibility_json', "TEXT NOT NULL DEFAULT '{}'");
  addIfMissing('prompt_enhancement_generated_origin', 'action_ids_json', "TEXT NOT NULL DEFAULT '[]'");
  addIfMissing('prompt_enhancement_generated_origin', 'fallback_state', "TEXT NOT NULL DEFAULT 'unknown_not_applicable'");
  addIfMissing('prompt_enhancement_generated_origin', 'privacy_storage_policy', "TEXT NOT NULL DEFAULT 'raw_text_excluded_by_default'");
}

/**
 * Apply incremental schema migrations with console output.
 * Safe to run multiple times — each step checks column existence before ALTER.
 * Run via: nexpath db migrate
 */
export function runMigrations(db: Database): void {
  const addIfMissing = (table: string, column: string, definition: string): void => {
    const res = db.exec(`PRAGMA table_info(${table})`);
    const cols = (res[0]?.values ?? []).map((row) => row[1] as string);
    if (!cols.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`  + ${table}.${column}`);
    } else {
      console.log(`  ✓ ${table}.${column} (already present)`);
    }
  };

  // v0.1.1 — Phase B
  addIfMissing('projects', 'detected_language',      'TEXT');
  addIfMissing('projects', 'decision_session_count', 'INTEGER NOT NULL DEFAULT 0');

  // v0.1.1 — options-text-generation
  addIfMissing('pending_advisories', 'generated_l1', 'TEXT');
  addIfMissing('pending_advisories', 'generated_l2', 'TEXT');
  addIfMissing('pending_advisories', 'generated_l3', 'TEXT');

  // sub-10 — deferred option gen + cross-session guard
  addIfMissing('pending_advisories', 'prev_stage', 'TEXT');

  // v0.1.1 — dev-environment probe
  addIfMissing('projects', 'env_facts',             'TEXT');
  addIfMissing('projects', 'env_facts_detected_at', 'INTEGER');
  addIfMissing('projects', 'env_trajectory',        'TEXT');

  // sub-11 prompt enhancement store contract
  addIfMissing('prompt_enhancement_source_use', 'section_ids_json', "TEXT NOT NULL DEFAULT '[]'");
  addIfMissing('prompt_enhancement_generated_origin', 'learning_eligibility_json', "TEXT NOT NULL DEFAULT '{}'");
  addIfMissing('prompt_enhancement_generated_origin', 'action_ids_json', "TEXT NOT NULL DEFAULT '[]'");
  addIfMissing('prompt_enhancement_generated_origin', 'fallback_state', "TEXT NOT NULL DEFAULT 'unknown_not_applicable'");
  addIfMissing('prompt_enhancement_generated_origin', 'privacy_storage_policy', "TEXT NOT NULL DEFAULT 'raw_text_excluded_by_default'");
}
