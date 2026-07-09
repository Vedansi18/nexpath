/**
 * Content-template SOURCE lookup — the migrated-signal side of the §6.1 dual-source
 * resolver. Bridges a signalType to a source-cascade `RecordCandidateLookup` that the
 * content-template engine (`resolveRecord` / `composeAdvisory`) walks.
 *
 * Only the `shipped` tier is populated today (the 142 shipped preset records — the 136 canonical
 * class-1..9 signals + the 6 new §4.E2 signals registered at A9). The
 * `uploaded` / `autogen` / `default` tiers return undefined — per-user and
 * closest-default records are later phases (upload / AR-6 §4.E7). When no shipped
 * record exists for a signalType, every tier is undefined → the engine resolves
 * `null` → the live caller falls back to the static set (safe, no blank advisory).
 */

import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import type { RecordCandidateLookup } from './content-template-engine.js';
import type { ContentTemplateRecord, LevelForm, MaturityLevel, TwoChannelCell } from './content-template-schema.js';
import { validateContentTemplateRecord, MATURITY_LEVELS } from './content-template-schema.js';
import { sanitizePromptDerivedValue } from './content-template-grounding.js';
import { retainsTopicAnchor } from './content-anchor.js';
import { getContentTemplate } from '../store/content-templates.js';
import type { Store } from '../store/db.js';

/** signalType → shipped content-template record (O(1) index over the shipped presets). */
const SHIPPED_BY_SIGNAL: ReadonlyMap<string, ContentTemplateRecord> = new Map(
  SHIPPED_CONTENT_TEMPLATES.map((r) => [r.signalType, r]),
);

/** True when a shipped content-template record exists for the signalType. */
export function hasShippedRecord(signalType: string): boolean {
  return SHIPPED_BY_SIGNAL.has(signalType);
}

/**
 * The content-template record signalType for a fired flagType, via the
 * `ABSENCE_<UPPER(key)>` convention (§6.1 item 10c coverage-map). Returns undefined for a
 * non-absence flagType (stage transitions etc. have no content-template mapping today).
 */
export function recordSignalTypeForFlag(flagType: string): string | undefined {
  return flagType.startsWith('absence:')
    ? `ABSENCE_${flagType.slice('absence:'.length).toUpperCase()}`
    : undefined;
}

/** Destination-stage → the stage-transition record's signalType. Static-content-independent. */
const TRANSITION_SIGNAL_BY_STAGE: Readonly<Record<string, string>> = {
  prd:            'IDEA_TO_PRD',
  architecture:   'PRD_TO_ARCHITECTURE',
  task_breakdown: 'ARCHITECTURE_TO_TASKS',
  review_testing: 'IMPLEMENTATION_TO_REVIEW',
  release:        'REVIEW_TO_RELEASE',
  feedback_loop:  'RELEASE_TO_FEEDBACK',
};

/**
 * The record signalType a fired advisory serves its pinch header / question from, for BOTH absence
 * flags (the `ABSENCE_<UPPER>` convention) and stage transitions (by DESTINATION stage; the
 * within-implementation fallback is TASK_REVIEW). Mirrors the static resolution's signalType without
 * touching the static content — used to resolve the register-keyed pinch fields after the cutover.
 */
export function pinchSignalTypeForFlag(flagType: string, stage: string): string | undefined {
  if (flagType === 'stage_transition') return TRANSITION_SIGNAL_BY_STAGE[stage] ?? 'TASK_REVIEW';
  return recordSignalTypeForFlag(flagType);
}

/**
 * A source-cascade lookup for one signalType: the `shipped` tier yields that signal's
 * shipped record; the other tiers yield undefined (no per-user / closest-default
 * records ship yet). Handed to the engine's `resolveRecord` / `composeAdvisory`.
 */
export function shippedRecordLookup(signalType: string): RecordCandidateLookup {
  return (source) => (source === 'shipped' ? SHIPPED_BY_SIGNAL.get(signalType) : undefined);
}

// ── Per-user (autogen) overlay — the tier-b per-cell cascade over the preset ────

/**
 * Overlay a per-user record on the shipped preset PER CELL: for each maturity level,
 * sanitize the per-user cell (AG-8 re-check on read), then serve it ONLY when it
 * retains the topic anchor (AG-3/AG-4 non-degradation — a keyword-bearing topic must
 * keep an anchor word, a keyword-less one must overlap the preset); otherwise fall
 * back to the preset cell. The first source holding a cell wins the WHOLE cell (no
 * intra-cell blending). Structure + the sensitive-action safeguard come from the
 * preset unchanged.
 */
function overlayAutogenOnPreset(autogen: ContentTemplateRecord, preset: ContentTemplateRecord): ContentTemplateRecord {
  const floorCell = preset.levelForms[1]?.cell; // schema-mandated floor — the anchor reference
  const levelForms: Partial<Record<MaturityLevel, LevelForm>> = {};
  for (const lvl of MATURITY_LEVELS) {
    const a = autogen.levelForms[lvl];
    if (a && floorCell) {
      const sanitized: TwoChannelCell = {
        option:  sanitizePromptDerivedValue(a.cell.option),
        whyDesc: sanitizePromptDerivedValue(a.cell.whyDesc),
      };
      if (retainsTopicAnchor(preset.signalType, sanitized, preset.levelForms[lvl]?.cell ?? floorCell)) {
        levelForms[lvl] = { kind: a.kind, cell: sanitized };
        continue;
      }
    }
    if (preset.levelForms[lvl]) levelForms[lvl] = preset.levelForms[lvl]!;
  }
  return { ...preset, source: 'autogen', levelForms };
}

/**
 * A source-cascade lookup that overlays a stored per-user (autogen) record on the
 * shipped preset, per cell. The `autogen` tier serves the merged record when a valid
 * stored record exists (schema-validated on read — an invalid one is ignored); the
 * `shipped` tier serves the raw preset as the fallback. Drop-in replacement for
 * `shippedRecordLookup` that adds the per-user tier.
 */
export function autogenAwareLookup(store: Store, projectRoot: string, signalType: string): RecordCandidateLookup {
  const preset = SHIPPED_BY_SIGNAL.get(signalType);
  return (source) => {
    if (source === 'autogen') {
      if (!preset) return undefined;
      const stored = getContentTemplate(store.db, projectRoot, signalType, 'autogen')?.record;
      if (stored === undefined || stored === null) return undefined;
      if (!validateContentTemplateRecord(stored).ok) return undefined; // read-side schema gate
      return overlayAutogenOnPreset(stored as ContentTemplateRecord, preset);
    }
    if (source === 'shipped') return preset;
    return undefined;
  };
}
