import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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

describe('§17.13 SAFETY — every producer keyed by SIGNAL, not just the two that were checked', () => {
  // ⛔ Written after the memory producer was MEASURED leaking, once the absence and content-template
  // lanes were already fixed. The lesson is the shape, not the site: any producer whose ref is keyed
  // by signal can name a sensitive one, so the sweep must cover all of them rather than the ones a
  // fixture happened to reach. The earlier sensitive test never exercised memory, because a probe
  // with no stored memory rows produces no memory refs.
  async function withMemoryRefs(refs: readonly string[]): Promise<readonly string[]> {
    const dir = mkdtempSync(join(tmpdir(), 'ssg-mem-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const store = await openStore(join(dir, 'store.db'));
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
    const base = buildPromptEnhancementRequestForAuto({
      auto: { promptText: 'ship the billing change', projectRoot: dir, currentAgentMode: 'default' },
      store, session: SessionStateManager.load(store, dir), project: null,
      effectiveLanguage: 'en', configuredRole: null, effectiveFlagType: 'absence:test_creation',
      firedKey: 'absence:test_creation', previousStage: 'idea', trigger: { kind: 'absence' },
      stageResult: {
        classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
        signalsPresent: [], signalsAbsent: [], fireRecommendation: true, selectedSignalKey: '',
        reason: 'mem', degraded: false, projectFactCandidates: [],
      },
      streamBOutputs: [],
    } as never) as never as { sourceSignals: Record<string, unknown> };
    const facts = buildPromptEnhancementGuidanceFactsV1(
      { ...base, sourceSignals: { ...base.sourceSignals, missingMemoryCandidateRefs: refs } } as never,
    );
    return promptEnhancementFactValueLinesV1('source_signal_guidance', facts);
  }

  it('a sensitive MEMORY candidate is never named, while an ordinary one still is', async () => {
    const lines = await withMemoryRefs(['memory:secret_in_prompt', 'memory:test_creation']);
    expect(
      lines.join(String.fromCharCode(10)),
      'a sensitive signal reached a body through the memory lane',
    ).not.toContain('secret in prompt');
    // The paired half: the lane still works, so the assertion above is not passing on silence.
    expect(lines.join(String.fromCharCode(10))).toContain('a repeated gap');
  });
});

describe('§17.13 SAFETY — the sweep guards itself, so a NEW producer cannot skip it', () => {
  // ⚠️ Three of the four sensitive-signal defects in this record were the SAME defect at a different
  // producer, and each was found by remembering to look again. That is not a guard.
  //
  // These two assertions turn the sweep into one: the first drives a sensitive signal down EVERY
  // ref lane at once and asserts nothing names it; the second pins how many producers write into
  // this slot, so adding a sixth fails here and tells its author to extend the first.

  const SENSITIVE_IN_EVERY_LANE = {
    normalizedStageAbsenceSignalRefs: ['absence:secret_in_prompt'],
    contentTemplateRecordFactRefs: ['ABSENCE_SECRET_IN_PROMPT'],
    missingMemoryCandidateRefs: ['memory:secret_in_prompt'],
    rightGoodWorkStyleEnvRuntimeRefs: ['mistake:secret_in_prompt'],
  };

  it('a sensitive signal sent down EVERY lane at once names itself nowhere', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssg-sweep-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const store = await openStore(join(dir, 'store.db'));
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
    const base = buildPromptEnhancementRequestForAuto({
      auto: { promptText: 'ship the billing change', projectRoot: dir, currentAgentMode: 'default' },
      store, session: SessionStateManager.load(store, dir), project: null,
      effectiveLanguage: 'en', configuredRole: null, effectiveFlagType: 'absence:secret_in_prompt',
      firedKey: 'absence:secret_in_prompt', previousStage: 'idea', trigger: { kind: 'absence' },
      stageResult: {
        classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
        signalsPresent: [], signalsAbsent: [], fireRecommendation: true, selectedSignalKey: '',
        reason: 'sweep', degraded: false, projectFactCandidates: [],
      },
      streamBOutputs: [],
    } as never) as never as { sourceSignals: Record<string, unknown> };

    const facts = buildPromptEnhancementGuidanceFactsV1(
      { ...base, sourceSignals: { ...base.sourceSignals, ...SENSITIVE_IN_EVERY_LANE } } as never,
    );
    const rendered = promptEnhancementFactValueLinesV1('source_signal_guidance', facts).join(' | ');

    expect(rendered.length, 'nothing rendered at all — this would pass on a broken slot').toBeGreaterThan(0);
    expect(rendered, 'a lane named the sensitive signal').not.toContain('secret in prompt');
    expect(rendered).not.toContain('secret_in_prompt');
  });

  it('and the producer COUNT is pinned, so a new one has to join the sweep', () => {
    // Deliberately a count and not a list: the point is to stop a producer being added silently,
    // and the failure message is the instruction.
    const src = readFileSync('src/prompt-enhancement/guidance-facts.ts', 'utf8');
    const producers = src.split("targetSectionKind: 'source_signal_guidance'").length - 1;
    expect(
      producers,
      'a producer was added to or removed from the source-signal slot — add its ref lane to '
      + 'SENSITIVE_IN_EVERY_LANE above and confirm it applies isSensitiveSignalRefV1',
    ).toBe(5);
  });
});

describe('§17.13 — the LAST hop: the composer may not throw the name away', () => {
  // ⚠️ Measured in the sim (sim-s12-zara-I§UE12-VERIFY-20260819.log, P18a): with the payload fixed,
  // the composer received the signal and still wrote "since this issue hasn't been observed in the
  // current session" — my sentence, reworded, with the one word that mattered removed. Its own
  // instruction told it to reword rather than paste, and the identity went with the rewording.
  //
  // The composer's wording cannot be asserted without a live call, so what is pinned here is the
  // INSTRUCTION: the rules that must be in front of the model. The sim is the check that they work.
  const composerSource = (): string => readFileSync('src/prompt-enhancement/llm-composer.ts', 'utf8');

  it('the signal NAME is required to survive the rewording', () => {
    const src = composerSource();
    expect(
      src.includes('That name MUST appear,'),
      'the composer is free to drop the signal name again — the payload fix stops at the last hop',
    ).toBe(true);
  });

  it('the rule names the phrasings the model actually converged to', () => {
    // ⚠️ Strengthened after the second sim: the first version said the name "must survive", and the
    // model complied in one body out of two. The failures are now quoted in the rule itself, because
    // the observed failure mode is not defiance — it is generalising the name into a category
    // ("the missing practices indicated", "what signals might be relevant here").
    const src = composerSource();
    expect(src).toContain('the missing practices indicated');
    expect(src).toContain('what signals might be relevant here');
    expect(src.includes('name EACH of their signals'), 'multi-signal merging is unguarded').toBe(true);
  });

});
