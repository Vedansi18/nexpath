import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store/db.js';
import { upsertProject } from '../store/index.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { buildPromptEnhancementGuidanceFactsV1, isSensitiveSignalRefV1 } from './guidance-facts.js';
import { promptEnhancementFactValueLinesV1, promptEnhancementSectionModelFactsV1 } from './fact-value-render.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';

/**
 * §17.13 — the source-signal slot must NAME the signal that fired.
 *
 * Measured before the fix, on a fired `absence:test_creation`: three facts landed in the slot, all
 * with `evidence: null`, so the renderer's "no resolved value means no line" rule produced nothing
 * and the composer saw an opaque fact id. The sim bodies then described the CATEGORY — "identify
 * any missing practices in her setup" — because the category was all the model had.
 *
 * ⚠️ The safety half of this file is not decoration. Giving the content-template producer an
 * identity to state made it name `secret in prompt` in a rendered line — measured, before any
 * fixture existed. The sensitive assertions below are what caught it and what keep it caught.
 */

async function slotFor(effectiveFlagType: string, triggerKind = 'absence'): Promise<{
  facts: readonly PromptEnhancementGuidanceFact[];
  lines: readonly string[];
}> {
  const dir = mkdtempSync(join(tmpdir(), 'ssg-id-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
  const store = await openStore(join(dir, 'store.db'));
  upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });

  const request = buildPromptEnhancementRequestForAuto({
    auto: { promptText: 'add the payment retry flow', projectRoot: dir, currentAgentMode: 'default' },
    store, session: SessionStateManager.load(store, dir), project: null,
    effectiveLanguage: 'en', configuredRole: null,
    effectiveFlagType, firedKey: effectiveFlagType, previousStage: 'idea',
    trigger: { kind: triggerKind },
    stageResult: {
      classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
      signalsPresent: [], signalsAbsent: [], fireRecommendation: true,
      selectedSignalKey: '', reason: 'ssg', degraded: false, projectFactCandidates: [],
    },
    streamBOutputs: [],
  } as never);

  const facts = buildPromptEnhancementGuidanceFactsV1(request);
  return { facts, lines: promptEnhancementFactValueLinesV1('source_signal_guidance', facts) };
}

describe('§17.13 — the signal names itself', () => {
  it('a fired absence states WHICH signal, not that some signal exists', async () => {
    const { lines } = await slotFor('absence:test_creation');
    expect(lines.join('\n'), 'the slot rendered nothing — the identity never resolved').toContain('test creation');
    expect(lines.join('\n')).toContain('not observed in this prompt');
  });

  it('the content-template record names the signal its precedent is about', async () => {
    const { lines } = await slotFor('absence:test_creation');
    expect(lines.join('\n')).toContain('an established guidance precedent');
  });

  it('and it says it ONCE — the same signal arrives under two spellings', async () => {
    // The fired trigger builds `absence:test_creation`; the refs lane carries the bare key. Both
    // become facts, and the dedupe key is the source ids — so without canonicalising, the body
    // printed the identical sentence twice. Invisible until both sides had something to say.
    const { lines } = await slotFor('absence:test_creation');
    const absenceLines = lines.filter((l) => l.includes('not observed in this prompt'));
    expect(absenceLines, 'the same signal is stated twice').toHaveLength(1);
  });
});

describe('§17.13 SAFETY — a sensitive signal is never named', () => {
  it('no rendered line contains the signal key, on any producer', async () => {
    const { lines } = await slotFor('absence:secret_in_prompt');

    expect(lines.length, 'the slot went silent — the withheld line is what tells the model a source exists').toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, 'a sensitive signal reached a body by name').not.toContain('secret in prompt');
      expect(line).not.toContain('secret_in_prompt');
      expect(line).toContain('withheld and must not be guessed');
    }
  });

  it('the canonical sensitive test matches the SHOUTED registry spelling too', () => {
    // The content-template producer's refs are ids like `ABSENCE_SECRET_IN_PROMPT`. The predicate
    // was lowercase-only, so that producer skipped the sensitive path entirely — and it only
    // mattered once it had an identity to state.
    expect(isSensitiveSignalRefV1('ABSENCE_SECRET_IN_PROMPT')).toBe(true);
    expect(isSensitiveSignalRefV1('absence:secret_in_prompt')).toBe(true);
    expect(isSensitiveSignalRefV1('absence:test_creation')).toBe(false);
  });

  it('and the sensitive facts still carry their safety hook and risk level', async () => {
    const { facts } = await slotFor('absence:secret_in_prompt');
    const sensitive = facts.filter((f) => f.sourceIds.some((id) => isSensitiveSignalRefV1(id)));
    expect(sensitive.length).toBeGreaterThan(0);
    for (const fact of sensitive) {
      expect(fact.claimVerbPolicy, `${fact.sourceIds[0]} lost its label-only ceiling`).toBe('source_label_only');
      expect(fact.safetyHooks).toContain('safety_sensitive_source');
      // ⛔ DEFENCE IN DEPTH, and this assertion exists because a mutation proved the others did
      // not cover it: removing the sensitive PRIVACY CLASS left every rendered line correct,
      // because the label-only ceiling alone blocks the renderer. But the key would then sit on
      // the fact as evidence — one policy change downstream from being stated. The content must
      // not exist on a sensitive fact at all, not merely fail to render.
      expect(
        fact.evidence,
        `${fact.sourceIds[0]} carries the sensitive key as a payload — only the renderer is stopping it`,
      ).toBeUndefined();
    }
  });
});

describe('§17.13 — WITHHELD means hidden, not empty', () => {
  it('a gated fact is WITHHELD and a contentless one is not', async () => {
    const gated = promptEnhancementSectionModelFactsV1(
      'source_signal_guidance', (await slotFor('absence:secret_in_prompt')).facts,
    );
    expect(gated.length).toBeGreaterThan(0);
    expect(
      gated.every((f) => f.contentGated),
      'a sensitive fact stopped reporting itself as gated — the model would be told nothing was hidden',
    ).toBe(true);

    // The contrast: a normal signal now HAS content, so nothing in this slot should be claiming a
    // secret. That was the whole defect — the model wrote around a secret that did not exist.
    const stated = promptEnhancementSectionModelFactsV1(
      'source_signal_guidance', (await slotFor('absence:test_creation')).facts,
    );
    expect(stated.some((f) => f.evidence !== undefined)).toBe(true);
  });
});
