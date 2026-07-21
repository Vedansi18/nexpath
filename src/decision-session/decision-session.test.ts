import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../telemetry/index.js', () => ({
  writeTelemetry: vi.fn(),
  TELEMETRY_PATH: '/mock/telemetry.jsonl',
}));
import {
  buildOptionList,
  getLevelSubtitle,
  SHOW_SIMPLER,
  SKIP_NOW,
  type DecisionContent,
} from './options.js';
import type { UserProfile } from '../classifier/types.js';
import { SIGNAL_DEFINITIONS } from '../classifier/signals.js';
import {
  buildSelectMessage,
  formatPinchLabel,
  formatQuestion,
  formatSubtitle,
  formatOptionLabel,
  runLevel,
  runDecisionSession,
  OPTION_SEPARATOR,
  OPT_OUT_SENTINEL,
  NEXPATH_HEADER,
  NEXPATH_HEADER_LINES,
} from './DecisionSession.js';
import type { DecisionSessionInput, SelectFn } from './DecisionSession.js';
import { resolvePinchFields } from './signal-pinch-fields.js';
import { pinchSignalTypeForFlag } from './content-template-source.js';
import { selectionRegister } from './selection-registry.js';
import { WHY_HELP_PER_CLASS } from './why-help.js';
import { R4_USER_OPEN } from './r4-bookends.js';
import type { Store } from '../store/db.js';
import { openStore } from '../store/db.js';
import { getSkippedSessions } from '../store/skipped-sessions.js';
import { getProject, upsertProject } from '../store/projects.js';
import { getConfig } from '../store/config.js';
import { writeTelemetry } from '../telemetry/index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<DecisionSessionInput> = {}): DecisionSessionInput {
  return {
    stage:                'implementation',
    flagType:             'stage_transition',
    pinchLabel:           'Hold up.',
    sessionId:            'session-test',
    projectRoot:          '/test/project',
    promptCount:          20,
    decisionSessionCount: 5,
    ...overrides,
  };
}

// selectFn that returns a specific value
function mockSelect(value: string): SelectFn {
  return vi.fn().mockResolvedValue(value);
}

// selectFn that returns a cancel symbol (simulates Ctrl+C)
function mockCancel(): SelectFn {
  return vi.fn().mockResolvedValue(Symbol('cancel'));
}

// ── getLevelSubtitle ──────────────────────────────────────────────────────────

describe('getLevelSubtitle', () => {
  it('returns null for Level 1 (no subtitle shown)', () => {
    expect(getLevelSubtitle(1)).toBeNull();
  });

  it('returns "— lighter options" for Level 2', () => {
    expect(getLevelSubtitle(2)).toBe('— lighter options');
  });

  it('returns "— minimum viable step" for Level 3', () => {
    expect(getLevelSubtitle(3)).toBe('— minimum viable step');
  });
});

// ── buildOptionList ───────────────────────────────────────────────────────────

describe('buildOptionList', () => {
  // Local DecisionContent fixtures — the static content sets were retired in the B11
  // cutover. buildOptionList is content-shape-agnostic: it appends "Show simpler →"
  // (levels 1-2 only) and "Skip for now" (always last) to a level's content options, so
  // these fixtures exercise every level/shape without the deleted static cascade.
  const mk = (sig: string, l1: number, l2: number, l3: number): DecisionContent => ({
    signalType:    sig,
    question:      'q',
    pinchFallback: 'p',
    L1: Array.from({ length: l1 }, (_, i) => ({ option: `${sig} L1 option ${i + 1}`, descBase: 'd' })),
    L2: Array.from({ length: l2 }, (_, i) => ({ option: `${sig} L2 option ${i + 1}`, descBase: 'd' })),
    L3: Array.from({ length: l3 }, (_, i) => ({ option: `${sig} L3 option ${i + 1}`, descBase: 'd' })),
  });
  const THREE = mk('THREE', 3, 2, 1); // 3 / 2 / 1 content options
  const FIVE  = mk('FIVE',  5, 2, 1); // 5 L1 content options
  const TWO   = mk('TWO',   2, 1, 1); // beginner-shaped 2 / 1 / 1

  it('Level 1: includes L1 content options + Show simpler + Skip (Skip last)', () => {
    const { options, hasNextLevel } = buildOptionList(THREE, 1);
    expect(options).toContain(SHOW_SIMPLER);
    expect(options).toContain(SKIP_NOW);
    expect(options[options.length - 1]).toBe(SKIP_NOW);
    expect(options[options.length - 2]).toBe(SHOW_SIMPLER);
    expect(hasNextLevel).toBe(true);
    for (const opt of THREE.L1.map((e) => e.option)) expect(options).toContain(opt);
  });

  it('Level 2: includes L2 content options + Show simpler + Skip', () => {
    const { options, hasNextLevel } = buildOptionList(THREE, 2);
    expect(options).toContain(SHOW_SIMPLER);
    expect(options[options.length - 1]).toBe(SKIP_NOW);
    expect(options[options.length - 2]).toBe(SHOW_SIMPLER);
    expect(hasNextLevel).toBe(true);
    for (const opt of THREE.L2.map((e) => e.option)) expect(options).toContain(opt);
  });

  it('Level 3: includes L3 content options + Skip only (no Show simpler)', () => {
    const { options, hasNextLevel } = buildOptionList(THREE, 3);
    expect(options).not.toContain(SHOW_SIMPLER);
    expect(options[options.length - 1]).toBe(SKIP_NOW);
    expect(hasNextLevel).toBe(false);
    for (const opt of THREE.L3.map((e) => e.option)) expect(options).toContain(opt);
  });

  it('Skip option is always the very last option on all levels', () => {
    for (const level of [1, 2, 3] as const) {
      expect(buildOptionList(THREE, level).options.at(-1)).toBe(SKIP_NOW);
    }
  });

  it('L1 has more options than L2 which has more than L3', () => {
    const l1 = buildOptionList(FIVE, 1).options;
    const l2 = buildOptionList(FIVE, 2).options;
    const l3 = buildOptionList(FIVE, 3).options;
    expect(l1.length).toBeGreaterThan(l2.length);
    expect(l2.length).toBeGreaterThan(l3.length);
  });

  it('3/2/1 set: L1 has 5 options, L2 has 4, L3 has 2', () => {
    expect(buildOptionList(THREE, 1).options).toHaveLength(5); // 3 + Show simpler + Skip
    expect(buildOptionList(THREE, 2).options).toHaveLength(4); // 2 + Show simpler + Skip
    expect(buildOptionList(THREE, 3).options).toHaveLength(2); // 1 + Skip
  });

  it('5-content L1 has 7 options (5 + Show simpler + Skip)', () => {
    expect(buildOptionList(FIVE, 1).options).toHaveLength(7);
  });

  it('beginner-shaped 2/1/1 set: L1 has 4, L2 has 3, L3 has 2', () => {
    expect(buildOptionList(TWO, 1).options).toHaveLength(4); // 2 + Show simpler + Skip
    expect(buildOptionList(TWO, 2).options).toHaveLength(3); // 1 + Show simpler + Skip
    expect(buildOptionList(TWO, 3).options).toHaveLength(2); // 1 + Skip
  });
});

// ── ANSI formatting helpers ───────────────────────────────────────────────────

describe('ANSI formatting helpers', () => {
  it('formatPinchLabel wraps text in bold cyan ANSI codes', () => {
    const result = formatPinchLabel('Hold up.');
    expect(result).toContain('Hold up.');
    expect(result).toContain('\x1b['); // ANSI escape
    expect(result).toContain('\x1b[0m'); // reset
  });

  it('formatPinchLabel uses bold cyan escape (\x1b[1;96m)', () => {
    expect(formatPinchLabel('test')).toContain('\x1b[1;96m');
  });

  it('formatQuestion wraps text in bold white ANSI codes', () => {
    const result = formatQuestion('Is the plan written?');
    expect(result).toContain('Is the plan written?');
    expect(result).toContain('\x1b[');
    expect(result).toContain('\x1b[0m');
  });

  it('formatQuestion uses bold white escape (\x1b[1;97m)', () => {
    expect(formatQuestion('test')).toContain('\x1b[1;97m');
  });

  it('formatSubtitle wraps text in dim yellow ANSI codes', () => {
    const result = formatSubtitle('— lighter options');
    expect(result).toContain('— lighter options');
    expect(result).toContain('\x1b[');
    expect(result).toContain('\x1b[0m');
  });

  it('formatSubtitle uses dim yellow escape (\x1b[2;33m)', () => {
    expect(formatSubtitle('test')).toContain('\x1b[2;33m');
  });

  it('each formatter uses a distinct ANSI color (pinch ≠ question ≠ subtitle)', () => {
    const pinch    = formatPinchLabel('x').split('x')[0];
    const question = formatQuestion('x').split('x')[0];
    const subtitle = formatSubtitle('x').split('x')[0];
    expect(pinch).not.toBe(question);
    expect(pinch).not.toBe(subtitle);
    expect(question).not.toBe(subtitle);
  });
});

// ── NEXPATH_HEADER ────────────────────────────────────────────────────────────

describe('NEXPATH_HEADER', () => {
  it('contains the triangle wordmark accent', () => {
    expect(NEXPATH_HEADER).toContain('▲');
  });

  it('contains the compact wordmark "NEXPATH CLI"', () => {
    expect(NEXPATH_HEADER).toContain('NEXPATH CLI');
  });

  it('contains a dim-gray horizontal rule line', () => {
    expect(NEXPATH_HEADER).toContain('─');
  });

  it('uses bold bright cyan for the triangle (matches pinch-label brand color)', () => {
    expect(NEXPATH_HEADER).toContain('\x1b[1;96m');
  });

  it('uses bold bright white for the wordmark', () => {
    expect(NEXPATH_HEADER).toContain('\x1b[1;97m');
  });

  it('ends with a trailing blank line for breathing room before the prompt', () => {
    expect(NEXPATH_HEADER.endsWith('\n\n')).toBe(true);
  });

  it('is a 3-row visual block (wordmark + rule + blank)', () => {
    expect(NEXPATH_HEADER_LINES).toBe(3);
    // The header string also produces 3 visible lines once ANSI is stripped:
    // line 1: ▲  NEXPATH CLI, line 2: rule, line 3: empty (trailing blank).
    const stripped = NEXPATH_HEADER.replace(/\x1b\[[0-9;]*m/g, '');
    const lineCount = stripped.split('\n').length - 1; // trailing '\n' creates empty tail
    expect(lineCount).toBe(NEXPATH_HEADER_LINES);
  });

  it('triangle appears before the wordmark', () => {
    const stripped = NEXPATH_HEADER.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped.indexOf('▲')).toBeLessThan(stripped.indexOf('NEXPATH'));
  });

  it('wordmark appears before the rule', () => {
    const stripped = NEXPATH_HEADER.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped.indexOf('NEXPATH')).toBeLessThan(stripped.indexOf('─'));
  });
});

// ── buildSelectMessage ────────────────────────────────────────────────────────

describe('buildSelectMessage', () => {
  it('Level 1: contains pinch label and question, no subtitle', () => {
    const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 1);
    expect(msg).toContain('Hold up.');
    expect(msg).toContain('Is the plan written?');
    expect(msg).not.toContain('lighter options');
    expect(msg).not.toContain('minimum viable');
  });

  it('Level 2: contains pinch label, "lighter options" subtitle, and question', () => {
    const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 2);
    expect(msg).toContain('Hold up.');
    expect(msg).toContain('lighter options');
    expect(msg).toContain('Is the plan written?');
  });

  it('Level 3: contains pinch label, "minimum viable step" subtitle, and question', () => {
    const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 3);
    expect(msg).toContain('Hold up.');
    expect(msg).toContain('minimum viable step');
    expect(msg).toContain('Is the plan written?');
  });

  it('Level 1: pinch label appears before the question in the message', () => {
    const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 1);
    expect(msg.indexOf('Hold up.')).toBeLessThan(msg.indexOf('Is the plan written?'));
  });

  it('Level 2: order is pinch → subtitle → question', () => {
    const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 2);
    const pinchPos    = msg.indexOf('Hold up.');
    const subtitlePos = msg.indexOf('lighter options');
    const questionPos = msg.indexOf('Is the plan written?');
    expect(pinchPos).toBeLessThan(subtitlePos);
    expect(subtitlePos).toBeLessThan(questionPos);
  });

  it('parts are separated by newlines', () => {
    const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 2);
    expect(msg).toContain('\n');
  });

  // dev-plan §11.2 — popup why-help block extension (Phase 4f)
  describe('§11.2 why-help block extension', () => {
    const universalEntry = WHY_HELP_PER_CLASS.class1_stage_transition;

    it('omits the why-help block when no whyHelpEntry is provided (backward-compat)', () => {
      const msg = buildSelectMessage('Hold up.', 'Q?', 1);
      expect(msg).not.toContain(R4_USER_OPEN);
    });

    it('appends R4_USER_OPEN + content + R4_USER_CLOSE[register] when whyHelpEntry is provided', () => {
      const msg = buildSelectMessage('Hold up.', 'Q?', 1, {
        whyHelpEntry: universalEntry,
        register:     'formal',
      });
      expect(msg).toContain(R4_USER_OPEN);
      expect(msg).toContain((universalEntry.content as { formal: string }).formal);
      expect(msg).toContain('— review the options below to determine the next step.');
    });

    it('places the why-help block AFTER the question (adjacency per C3 lock)', () => {
      const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 1, {
        whyHelpEntry: universalEntry,
        register:     'casual',
      });
      const questionPos = msg.indexOf('Is the plan written?');
      const whyHelpPos  = msg.indexOf(R4_USER_OPEN);
      expect(questionPos).toBeLessThan(whyHelpPos);
    });

    it('falls back to no-why-help when the register is not supported by the entry (class7 + formal)', () => {
      const c7 = WHY_HELP_PER_CLASS.class7_cool_geek_vibe_coder;
      const msg = buildSelectMessage('Hold up.', 'Q?', 1, {
        whyHelpEntry: c7,
        register:     'formal',
      });
      expect(msg).not.toContain(R4_USER_OPEN);
    });

    it('inserts the mood sentence between content and close when mood is rushed', () => {
      const msg = buildSelectMessage('Hold up.', 'Q?', 1, {
        whyHelpEntry: universalEntry,
        register:     'casual',
        mood:         'rushed',
      });
      expect(msg).toContain(R4_USER_OPEN);
      // The "rushed" casual mood sentence is non-empty and appears between content and close.
      const closeIdx = msg.indexOf('— pick from the options below to keep moving.');
      const openIdx  = msg.indexOf(R4_USER_OPEN);
      expect(openIdx).toBeLessThan(closeIdx);
      // The composed block has 4 lines for the rushed-mood case (open + content + mood + close).
      const block = msg.slice(openIdx, closeIdx + '— pick from the options below to keep moving.'.length);
      expect(block.split('\n')).toHaveLength(4);
    });

    it('routes class8-role-cluster via role parameter (founder → founder_casual)', () => {
      const c8 = WHY_HELP_PER_CLASS.class8_role_cluster;
      const msg = buildSelectMessage('Hold up.', 'Q?', 1, {
        whyHelpEntry: c8,
        register:     'casual',
        role:         'founder',
      });
      expect(msg).toContain((c8.content as { founder_casual: string }).founder_casual);
    });

    // §11.3 C3 lock — single `\n` separator between question and why-help.
    it('puts EXACTLY one `\\n` between the question and the R4_USER_OPEN of the why-help block (C3 adjacency)', () => {
      const universalEntry = WHY_HELP_PER_CLASS.class1_stage_transition;
      const msg = buildSelectMessage('Hold up.', 'Is the plan written?', 1, {
        whyHelpEntry: universalEntry,
        register:     'casual',
      });
      // Find the question line in the composed message — it has formatQuestion's
      // BOLD_WHITE wrapper, so search for the inner text + the closing reset code.
      const questionPlain = 'Is the plan written?';
      const questionStart = msg.indexOf(questionPlain);
      expect(questionStart).toBeGreaterThan(-1);
      // The end of the question line is wherever the BOLD_WHITE reset closes; pick the
      // first newline AFTER questionStart and assert the substring immediately following
      // it (up to R4_USER_OPEN) contains zero blank rows.
      const firstNlAfterQ = msg.indexOf('\n', questionStart);
      const r4OpenStart   = msg.indexOf(R4_USER_OPEN, firstNlAfterQ);
      expect(firstNlAfterQ).toBeGreaterThan(-1);
      expect(r4OpenStart).toBeGreaterThan(-1);
      // Between the first `\n` after the question and the start of R4_USER_OPEN there
      // must be NO additional characters (including no extra `\n`).
      expect(msg.slice(firstNlAfterQ + 1, r4OpenStart)).toBe('');
    });

    // §11.2 why-help block decomposition — verify the composed block emits the
    // dev-plan 3-or-4 sub-element structure (R4 open / R6 content / [mood] /
    // R4 close), each as its own line within the composed message.
    it('composed why-help block contains 3 sub-element lines (open / content / close) when no mood', () => {
      const universalEntry = WHY_HELP_PER_CLASS.class1_stage_transition;
      const msg = buildSelectMessage('Hold up.', 'Q?', 1, {
        whyHelpEntry: universalEntry,
        register:     'formal',
      });
      const openIdx   = msg.indexOf(R4_USER_OPEN);
      const closeText = '— review the options below to determine the next step.';
      const closeIdx  = msg.indexOf(closeText);
      const slice     = msg.slice(openIdx, closeIdx + closeText.length);
      expect(slice.split('\n')).toHaveLength(3);
    });

    it('composed why-help block contains 4 sub-element lines (open / content / mood / close) when mood is rushed', () => {
      const universalEntry = WHY_HELP_PER_CLASS.class1_stage_transition;
      const msg = buildSelectMessage('Hold up.', 'Q?', 1, {
        whyHelpEntry: universalEntry,
        register:     'casual',
        mood:         'rushed',
      });
      const openIdx   = msg.indexOf(R4_USER_OPEN);
      const closeText = '— pick from the options below to keep moving.';
      const closeIdx  = msg.indexOf(closeText);
      const slice     = msg.slice(openIdx, closeIdx + closeText.length);
      expect(slice.split('\n')).toHaveLength(4);
    });
  });
});

// ── runLevel ──────────────────────────────────────────────────────────────────

describe('runLevel', () => {
  it('returns the selected prompt text when a content option is chosen', async () => {
    // runLevel echoes the selected value back (no validation against its option list),
    // so any content-option string exercises the path (static content sets are retired).
    const firstOpt = 'A first-level content prompt.';
    const result   = await runLevel(makeInput(), 1, mockSelect(firstOpt));
    expect(result).toBe(firstOpt);
  });

  it('returns "next" when user selects "Show simpler options →" on Level 1', async () => {
    const result = await runLevel(makeInput(), 1, mockSelect(SHOW_SIMPLER));
    expect(result).toBe('next');
  });

  it('returns "next" when user selects "Show simpler options →" on Level 2', async () => {
    const result = await runLevel(makeInput(), 2, mockSelect(SHOW_SIMPLER));
    expect(result).toBe('next');
  });

  it('returns "skip" when user selects SKIP_NOW', async () => {
    const result = await runLevel(makeInput(), 1, mockSelect(SKIP_NOW));
    expect(result).toBe('skip');
  });

  it('returns "skip" on Ctrl+C (isCancel symbol)', async () => {
    const result = await runLevel(makeInput(), 1, mockCancel());
    expect(result).toBe('skip');
  });

  it('passes the correct option list to selectFn on Level 1', async () => {
    const selectFn = mockSelect(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 12 }), 1, selectFn);
    const call = (selectFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const values = call.options.map((o: { value: string }) => o.value);
    expect(values).toContain(SHOW_SIMPLER);
    expect(values).toContain(SKIP_NOW);
    expect(values[values.length - 1]).toBe(SKIP_NOW);
  });

  it('does NOT include "Show simpler options →" on Level 3', async () => {
    const selectFn = mockSelect(SKIP_NOW);
    await runLevel(makeInput(), 3, selectFn);
    const call = (selectFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const values = call.options.map((o: { value: string }) => o.value);
    expect(values).not.toContain(SHOW_SIMPLER);
  });

  it('value and label are equal for every non-separator, non-SKIP_NOW, non-SHOW_SIMPLER option (content prompts are pre-filled)', () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    return runLevel(makeInput(), 1, spy).then(() => {
      const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
      const realOpts = opts.filter(
        (o) => !o.value.startsWith(OPTION_SEPARATOR) && o.value !== SKIP_NOW && o.value !== SHOW_SIMPLER,
      );
      for (const opt of realOpts) {
        expect(opt.value).toBe(opt.label);
      }
    });
  });

  it('selecting an L2 content option returns that prompt text', async () => {
    const l2Option = 'A second-level content prompt.';
    const result   = await runLevel(makeInput(), 2, mockSelect(l2Option));
    expect(result).toBe(l2Option);
  });

  it('selecting an L3 content option returns that prompt text', async () => {
    const l3Option = 'A third-level content prompt.';
    const result   = await runLevel(
      makeInput({ stage: 'prd', flagType: 'stage_transition' }),
      3,
      mockSelect(l3Option),
    );
    expect(result).toBe(l3Option);
  });
});

// ── runDecisionSession ────────────────────────────────────────────────────────

describe('runDecisionSession', () => {
  it('returns { outcome: selected, selectedPrompt } when user picks a content option', async () => {
    const firstOpt = 'A first-level content prompt.';
    const result   = await runDecisionSession(makeInput(), undefined, mockSelect(firstOpt));
    expect(result.outcome).toBe('selected');
    if (result.outcome === 'selected') {
      expect(result.selectedPrompt).toBe(firstOpt);
    }
  });

  it('returns { outcome: skipped } when user selects SKIP_NOW', async () => {
    const result = await runDecisionSession(makeInput(), undefined, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('skipped');
  });

  it('returns { outcome: skipped } on Ctrl+C / Escape', async () => {
    const result = await runDecisionSession(makeInput(), undefined, mockCancel());
    expect(result.outcome).toBe('skipped');
  });

  it('advances to Level 2 when user selects "Show simpler options →" on Level 1', async () => {
    // First call: Show simpler; second call: skip
    const selectFn = vi.fn()
      .mockResolvedValueOnce(SHOW_SIMPLER)
      .mockResolvedValueOnce(SKIP_NOW);
    const result = await runDecisionSession(makeInput(), undefined, selectFn as SelectFn);
    expect(selectFn).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe('skipped');
  });

  it('advances to Level 3 when user selects "Show simpler options →" twice', async () => {
    const l3Option = 'A third-level content prompt.';
    const selectFn = vi.fn()
      .mockResolvedValueOnce(SHOW_SIMPLER)  // L1 → L2
      .mockResolvedValueOnce(SHOW_SIMPLER)  // L2 → L3
      .mockResolvedValueOnce(l3Option);      // L3 → selected
    const result = await runDecisionSession(makeInput(), undefined, selectFn as SelectFn);
    expect(selectFn).toHaveBeenCalledTimes(3);
    expect(result.outcome).toBe('selected');
    if (result.outcome === 'selected') {
      expect(result.selectedPrompt).toBe(l3Option);
    }
  });

  it('does not cascade beyond Level 3 (stops at L3 even if "next" somehow fires)', async () => {
    // If level 3 selectFn somehow returns SHOW_SIMPLER (shouldn't happen per UI),
    // it should be treated as a skip (defensive case)
    const selectFn = vi.fn()
      .mockResolvedValueOnce(SHOW_SIMPLER)
      .mockResolvedValueOnce(SHOW_SIMPLER)
      .mockResolvedValueOnce(SHOW_SIMPLER); // "next" on Level 3 → treated as skip
    const result = await runDecisionSession(makeInput(), undefined, selectFn as SelectFn);
    expect(result.outcome).toBe('skipped');
  });

  it('persists skip to store when store is provided', async () => {
    const store = await openStore(':memory:');
    try {
      const input = makeInput({ projectRoot: '/proj/test' });
      await runDecisionSession(input, store, mockSelect(SKIP_NOW));
      const rows = getSkippedSessions(store, '/proj/test');
      expect(rows).toHaveLength(1);
      expect(rows[0].flagType).toBe('stage_transition');
      expect(rows[0].stage).toBe('implementation');
      expect(rows[0].levelReached).toBe(1);
    } finally {
      store.db.close();
    }
  });

  it('persists correct level_reached when skip happens at Level 2', async () => {
    const store = await openStore(':memory:');
    try {
      const selectFn = vi.fn()
        .mockResolvedValueOnce(SHOW_SIMPLER)  // L1 → L2
        .mockResolvedValueOnce(SKIP_NOW);      // skip at L2
      await runDecisionSession(makeInput({ projectRoot: '/proj/test2' }), store, selectFn as SelectFn);
      const rows = getSkippedSessions(store, '/proj/test2');
      expect(rows[0].levelReached).toBe(2);
    } finally {
      store.db.close();
    }
  });

  it('persists correct level_reached when skip happens at Level 3', async () => {
    const store = await openStore(':memory:');
    try {
      const selectFn = vi.fn()
        .mockResolvedValueOnce(SHOW_SIMPLER)
        .mockResolvedValueOnce(SHOW_SIMPLER)
        .mockResolvedValueOnce(SKIP_NOW);
      await runDecisionSession(makeInput({ projectRoot: '/proj/test3' }), store, selectFn as SelectFn);
      const rows = getSkippedSessions(store, '/proj/test3');
      expect(rows[0].levelReached).toBe(3);
    } finally {
      store.db.close();
    }
  });

  it('does NOT persist to store when user selects a content option', async () => {
    const store = await openStore(':memory:');
    try {
      await runDecisionSession(makeInput({ projectRoot: '/proj/select' }), store, mockSelect('A content prompt to select.'));
      const rows = getSkippedSessions(store, '/proj/select');
      expect(rows).toHaveLength(0);
    } finally {
      store.db.close();
    }
  });

  it('does NOT persist when no store is provided (no crash)', async () => {
    // Should not throw even without a store
    const result = await runDecisionSession(makeInput(), undefined, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('skipped');
  });

  it('persists skip to store on Ctrl+C (cancel symbol)', async () => {
    const store = await openStore(':memory:');
    try {
      await runDecisionSession(makeInput({ projectRoot: '/proj/cancel-store' }), store, mockCancel());
      const rows = getSkippedSessions(store, '/proj/cancel-store');
      expect(rows).toHaveLength(1);
      expect(rows[0].levelReached).toBe(1);
    } finally {
      store.db.close();
    }
  });

  it('multiple skips create multiple rows (no dedup at storage layer)', async () => {
    const store = await openStore(':memory:');
    try {
      await runDecisionSession(makeInput({ projectRoot: '/proj/multi' }), store, mockSelect(SKIP_NOW));
      await runDecisionSession(makeInput({ projectRoot: '/proj/multi' }), store, mockSelect(SKIP_NOW));
      const rows = getSkippedSessions(store, '/proj/multi');
      expect(rows).toHaveLength(2);
    } finally {
      store.db.close();
    }
  });

  it('records promptCount and sessionId correctly in the skip row', async () => {
    const store = await openStore(':memory:');
    try {
      const input = makeInput({ promptCount: 42, sessionId: 'sess-xyz', projectRoot: '/proj/pc' });
      await runDecisionSession(input, store, mockSelect(SKIP_NOW));
      const rows = getSkippedSessions(store, '/proj/pc');
      expect(rows[0].skippedAtPromptCount).toBe(42);
      expect(rows[0].sessionId).toBe('sess-xyz');
    } finally {
      store.db.close();
    }
  });
});

// ── Phase H — decisionSessionCount, help line, SKIP_NOW label, sentinels ────────

describe('runDecisionSession — decisionSessionCount increment', () => {
  it('increments decision_session_count in projects table on each call', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/count', name: 'count' });
      const input = makeInput({ projectRoot: '/proj/count' });

      await runDecisionSession(input, store, mockSelect(SKIP_NOW));
      expect(getProject(store, '/proj/count')?.decisionSessionCount).toBe(1);

      await runDecisionSession(input, store, mockSelect(SKIP_NOW));
      expect(getProject(store, '/proj/count')?.decisionSessionCount).toBe(2);
    } finally {
      store.db.close();
    }
  });

  it('does not crash when store is undefined (no increment, no error)', async () => {
    const input = makeInput({ projectRoot: '/proj/no-store' });
    const result = await runDecisionSession(input, undefined, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('skipped');
  });
});

describe('runLevel — help line injection', () => {
  it('injects help item at bottom of options when decisionSessionCount < 12', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 0 }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const helpItem = opts.find((o) => o.value === `${OPTION_SEPARATOR}help`);
    expect(helpItem).toBeDefined();
    expect(helpItem?.label).toContain('Ctrl+X');
    expect(helpItem?.label).toContain('Ctrl+T');
    expect(helpItem?.label).toContain('frequency or role');
    expect(helpItem?.label).not.toContain('configure role');
  });

  it('does NOT inject help item when decisionSessionCount >= 12', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 12 }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const helpItem = opts.find((o) => o.value === `${OPTION_SEPARATOR}help`);
    expect(helpItem).toBeUndefined();
  });

  it('help item has non-empty styled label', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 1 }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const helpItem = opts.find((o) => o.value === `${OPTION_SEPARATOR}help`);
    expect(helpItem?.label.trim().length).toBeGreaterThan(0);
  });

  it('help item is preceded by 2 blank separator lines', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 0 }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const helpIdx = opts.findIndex((o) => o.value === `${OPTION_SEPARATOR}help`);
    expect(helpIdx).toBeGreaterThanOrEqual(2);
    expect(opts[helpIdx - 1]?.label).toBe('');
    expect(opts[helpIdx - 2]?.label).toBe('');
  });

  it('help hint is NOT in message header', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 0 }), 1, spy as SelectFn);
    const msg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].message as string;
    expect(msg).not.toContain('Ctrl+X');
    expect(msg).not.toContain('Ctrl+T');
  });
});

describe('runLevel — questionOverride (migrated-signal popup question)', () => {
  const OVERRIDE = 'A secret was just pasted into a prompt — treat it as leaked and rotate it?';

  it('uses questionOverride for the select `question` field when present', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ questionOverride: OVERRIDE }), 1, spy as SelectFn);
    const arg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as { question: string };
    expect(arg.question).toBe(OVERRIDE);
  });

  it('threads questionOverride into the message header (buildSelectMessage question line)', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ questionOverride: OVERRIDE }), 1, spy as SelectFn);
    const msg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].message as string;
    expect(msg).toContain(OVERRIDE);
  });

  it('falls back to the static content.question when no override is given', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    // Default input (stage_transition) resolves a real static DecisionContent question.
    await runLevel(makeInput(), 1, spy as SelectFn);
    const arg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as { question: string };
    expect(arg.question).not.toBe(OVERRIDE);
    expect(typeof arg.question).toBe('string');
    expect(arg.question.length).toBeGreaterThan(0);
  });
});

describe('runLevel — whyHelpOverride (migrated-signal popup why-help)', () => {
  const SECURITY = WHY_HELP_PER_CLASS.class_security_safety;
  const securityFormal = (SECURITY.content as { formal: string }).formal;
  // hardcore_pro → formal register (register.ts), so the formal why-help text is rendered.
  const proProfile = {
    nature: 'hardcore_pro', mood: 'focused', depth: 'high', role: null,
    precisionOrdinal: 'high', playfulnessOrdinal: 'low',
    precisionScore: 8, playfulnessScore: 2, depthScore: 8, computedAt: 0,
  } as unknown as import('../classifier/types.js').UserProfile;

  it('renders the override why-help (not the static fallback) in the popup message + block', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ profile: proProfile, whyHelpOverride: SECURITY }), 1, spy as SelectFn);
    const arg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as { message: string; whyHelpBlock?: string };
    expect(arg.message).toContain(securityFormal);
    expect(arg.whyHelpBlock).toBeTruthy();
  });

  it('routes a migrated ROLE-CLUSTER override to the user role end-to-end (founder → founder_casual, not pm) — B9', async () => {
    // The B9 role-cluster path: a migrated class-8 signal threads its role-structured why-help via
    // whyHelpOverride, and runLevel must select the founder sub-field by profile.role (the piece that
    // preserves the founder/indie/pm dimension the register-only engine can't carry in the option content).
    const ROLE_CLUSTER = WHY_HELP_PER_CLASS.class8_role_cluster;
    const c8 = ROLE_CLUSTER.content as { founder_casual: string; pm_formal: string };
    const founderProfile = {
      nature: 'hardcore_pro', mood: 'focused', depth: 'high', role: 'founder',
      precisionOrdinal: 'high', playfulnessOrdinal: 'low',
      precisionScore: 8, playfulnessScore: 2, depthScore: 8, computedAt: 0,
    } as unknown as import('../classifier/types.js').UserProfile;
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ profile: founderProfile, whyHelpOverride: ROLE_CLUSTER }), 1, spy as SelectFn);
    const arg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as { message: string };
    expect(arg.message).toContain(c8.founder_casual);      // the founder variant is selected...
    expect(arg.message).not.toContain(c8.pm_formal);        // ...and not another role's
  });

  it('without an override, the static content.whyHelp is used — no security why-help leaks in', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ profile: proProfile }), 1, spy as SelectFn);
    const arg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as { message: string };
    expect(arg.message).not.toContain(securityFormal);
  });
});

describe('runLevel — SKIP_NOW label split', () => {
  it('SKIP_NOW option has value === SKIP_NOW constant', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 5 }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const skipItem = opts.find((o) => o.value === SKIP_NOW);
    expect(skipItem).toBeDefined();
  });

  it('SKIP_NOW option label is plain text and differs from its value', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ decisionSessionCount: 5 }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const skipItem = opts.find((o) => o.value === SKIP_NOW);
    expect(skipItem?.label).not.toBe(SKIP_NOW);
    expect(skipItem?.label).toContain('Skip for now');
  });

  it('SKIP_NOW still resolves as "skip" outcome despite label change', async () => {
    const result = await runDecisionSession(
      makeInput({ decisionSessionCount: 5 }),
      undefined,
      mockSelect(SKIP_NOW),
    );
    expect(result.outcome).toBe('skipped');
  });
});

describe('runDecisionSession — OPT_OUT_SENTINEL handling', () => {
  it('returns skipped outcome when selectFn returns OPT_OUT_SENTINEL', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/optout', name: 'optout' });
      const result = await runDecisionSession(
        makeInput({ projectRoot: '/proj/optout' }),
        store,
        mockSelect(OPT_OUT_SENTINEL),
      );
      expect(result.outcome).toBe('skipped');
    } finally {
      store.db.close();
    }
  });

  it('writes advisory_frequency:<projectRoot>=off to config on OPT_OUT_SENTINEL', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/optout2', name: 'optout2' });
      await runDecisionSession(
        makeInput({ projectRoot: '/proj/optout2' }),
        store,
        mockSelect(OPT_OUT_SENTINEL),
      );
      expect(getConfig(store.db, 'advisory_frequency:/proj/optout2')).toBe('off');
    } finally {
      store.db.close();
    }
  });

  it('does NOT record a skipped_sessions row on OPT_OUT_SENTINEL (config change, not a skip)', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/optout3', name: 'optout3' });
      await runDecisionSession(
        makeInput({ projectRoot: '/proj/optout3' }),
        store,
        mockSelect(OPT_OUT_SENTINEL),
      );
      const rows = getSkippedSessions(store, '/proj/optout3');
      expect(rows).toHaveLength(0);
    } finally {
      store.db.close();
    }
  });
});

describe('runDecisionSession — __FREQ__ sentinel handling', () => {
  it('returns skipped outcome when selectFn returns __FREQ__:major_only', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/freq', name: 'freq' });
      const result = await runDecisionSession(
        makeInput({ projectRoot: '/proj/freq' }),
        store,
        mockSelect('__FREQ__:major_only'),
      );
      expect(result.outcome).toBe('skipped');
    } finally {
      store.db.close();
    }
  });

  it('writes the chosen frequency to config on __FREQ__:<value>', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/freq2', name: 'freq2' });
      await runDecisionSession(
        makeInput({ projectRoot: '/proj/freq2' }),
        store,
        mockSelect('__FREQ__:once_per_session'),
      );
      expect(getConfig(store.db, 'advisory_frequency:/proj/freq2')).toBe('once_per_session');
    } finally {
      store.db.close();
    }
  });

  it('writes off when __FREQ__:off is returned', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/freq3', name: 'freq3' });
      await runDecisionSession(
        makeInput({ projectRoot: '/proj/freq3' }),
        store,
        mockSelect('__FREQ__:off'),
      );
      expect(getConfig(store.db, 'advisory_frequency:/proj/freq3')).toBe('off');
    } finally {
      store.db.close();
    }
  });

  it('writes optimum when __FREQ__:optimum is returned', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/freq4', name: 'freq4' });
      await runDecisionSession(
        makeInput({ projectRoot: '/proj/freq4' }),
        store,
        mockSelect('__FREQ__:optimum'),
      );
      expect(getConfig(store.db, 'advisory_frequency:/proj/freq4')).toBe('optimum');
    } finally {
      store.db.close();
    }
  });

  it('writes the chosen role to config on __ROLE__:vibe_coder', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/role1', name: 'role1' });
      const result = await runDecisionSession(
        makeInput({ projectRoot: '/proj/role1' }),
        store,
        mockSelect('__ROLE__:vibe_coder'),
      );
      expect(result.outcome).toBe('skipped');
      expect(getConfig(store.db, 'role:/proj/role1')).toBe('vibe_coder');
    } finally {
      store.db.close();
    }
  });

  it('writes the chosen role to config on __ROLE__:founder', async () => {
    const store = await openStore(':memory:');
    try {
      upsertProject(store, { projectRoot: '/proj/role2', name: 'role2' });
      await runDecisionSession(
        makeInput({ projectRoot: '/proj/role2' }),
        store,
        mockSelect('__ROLE__:founder'),
      );
      expect(getConfig(store.db, 'role:/proj/role2')).toBe('founder');
    } finally {
      store.db.close();
    }
  });
});

// ── generatedOptions — runLevel and runDecisionSession ────────────────────────

describe('runLevel — generatedOptions wiring', () => {
  const GEN_L1 = ['[adapted] Do a quick spec review before continuing', '[adapted] Run the test suite now', '[adapted] Cross-check your task list'];
  const GEN_L2 = ['[adapted] Verify coverage on the happy path', '[adapted] Check the edge cases'];
  const GEN_L3 = ['[adapted] What one thing could break this?'];

  const generatedOptions = { l1: GEN_L1, l2: GEN_L2, l3: GEN_L3 };

  it('uses generated L1 options (not static) when generatedOptions is provided', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ generatedOptions }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string }[];
    const values = opts.map((o) => o.value);
    expect(values).toContain(GEN_L1[0]);
    expect(values).toContain(GEN_L1[1]);
    expect(values).toContain(GEN_L1[2]);
  });

  it('uses ONLY the generated L1 options — no record-composed fallback mixed in', async () => {
    // When generatedOptions is provided, runLevel serves exactly those (the deterministic
    // record composition is the fallback ONLY when generatedOptions is absent).
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ generatedOptions }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string }[];
    const content = opts
      .map((o) => o.value)
      .filter((v) => !v.startsWith(OPTION_SEPARATOR) && v !== SKIP_NOW && v !== SHOW_SIMPLER);
    expect(content).toEqual(GEN_L1);
  });

  it('uses generated L2 options at level 2', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ generatedOptions }), 2, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string }[];
    const values = opts.map((o) => o.value);
    expect(values).toContain(GEN_L2[0]);
    expect(values).toContain(GEN_L2[1]);
  });

  it('uses generated L3 options at level 3', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ generatedOptions }), 3, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string }[];
    const values = opts.map((o) => o.value);
    expect(values).toContain(GEN_L3[0]);
  });

  it('question line in the message comes from the record/pinch-fields layer, not from generatedOptions', async () => {
    // generatedOptions carries only option text; the popup question is resolved the same way
    // runLevel does — pinchSignalTypeForFlag → resolvePinchFields(signal, register).
    const sig       = pinchSignalTypeForFlag('stage_transition', 'implementation');
    const expectedQ = sig ? resolvePinchFields(sig, selectionRegister(undefined))?.question : undefined;
    expect(expectedQ).toBeTruthy();
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ generatedOptions }), 1, spy as SelectFn);
    const msg = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].message as string;
    expect(msg).toContain(expectedQ!);
  });

  it('selecting a generated L1 option returns that option text', async () => {
    const result = await runLevel(makeInput({ generatedOptions }), 1, mockSelect(GEN_L1[0]));
    expect(result).toBe(GEN_L1[0]);
  });

  it('selecting a generated L3 option returns that option text', async () => {
    const result = await runLevel(makeInput({ generatedOptions }), 3, mockSelect(GEN_L3[0]));
    expect(result).toBe(GEN_L3[0]);
  });

  it('SHOW_SIMPLER and SKIP_NOW are still present alongside generated options at level 1', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ generatedOptions }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string }[];
    const values = opts.map((o) => o.value);
    expect(values).toContain(SHOW_SIMPLER);
    expect(values).toContain(SKIP_NOW);
  });

  it('composes options from the record when generatedOptions is undefined (B11 — no static content)', async () => {
    const { composeDeterministicOptions } = await import('./engine-option-generator.js');
    const { shippedRecordLookup } = await import('./content-template-source.js');
    const recordGen = composeDeterministicOptions({ lookup: shippedRecordLookup('TASK_REVIEW'), level: 3, register: 'casual' });
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput({ generatedOptions: undefined }), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string }[];
    const values = opts.map((o) => o.value);
    expect(values).toContain(recordGen!.l1[0]); // record-composed option, not the deleted static content
  });
});

describe('runDecisionSession — generatedOptions wiring', () => {
  const GEN_L1 = ['[adapted] Do a quick spec review before continuing', '[adapted] Run the test suite now', '[adapted] Cross-check your task list'];
  const GEN_L2 = ['[adapted] Verify coverage on the happy path', '[adapted] Check the edge cases'];
  const GEN_L3 = ['[adapted] What one thing could break this?'];
  const generatedOptions = { l1: GEN_L1, l2: GEN_L2, l3: GEN_L3 };

  it('returns selected outcome with generated option text when user picks generated L1 option', async () => {
    const result = await runDecisionSession(makeInput({ generatedOptions }), undefined, mockSelect(GEN_L1[0]));
    expect(result.outcome).toBe('selected');
    if (result.outcome === 'selected') {
      expect(result.selectedPrompt).toBe(GEN_L1[0]);
    }
  });

  it('advances to L2 and returns generated L2 option text', async () => {
    const selectFn = vi.fn()
      .mockResolvedValueOnce(SHOW_SIMPLER)
      .mockResolvedValueOnce(GEN_L2[0]);
    const result = await runDecisionSession(makeInput({ generatedOptions }), undefined, selectFn as SelectFn);
    expect(result.outcome).toBe('selected');
    if (result.outcome === 'selected') {
      expect(result.selectedPrompt).toBe(GEN_L2[0]);
    }
  });

  it('advances to L3 and returns generated L3 option text', async () => {
    const selectFn = vi.fn()
      .mockResolvedValueOnce(SHOW_SIMPLER)
      .mockResolvedValueOnce(SHOW_SIMPLER)
      .mockResolvedValueOnce(GEN_L3[0]);
    const result = await runDecisionSession(makeInput({ generatedOptions }), undefined, selectFn as SelectFn);
    expect(result.outcome).toBe('selected');
    if (result.outcome === 'selected') {
      expect(result.selectedPrompt).toBe(GEN_L3[0]);
    }
  });

  it('skip still works normally when generatedOptions is provided', async () => {
    const result = await runDecisionSession(makeInput({ generatedOptions }), undefined, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('skipped');
  });
});

// ── W-05: formatOptionLabel + clack-path label styling ────────────────────────

describe('W-05: formatOptionLabel', () => {
  it('returns unchanged string when no \\n present', () => {
    expect(formatOptionLabel('Simple option text')).toBe('Simple option text');
  });

  it('prefixes continuation lines with \\n│    when \\n present', () => {
    const result = formatOptionLabel('Line 1\nLine 2\nLine 3');
    expect(result).toBe('Line 1\n│    Line 2\n│    Line 3');
  });

  it('handles a single \\n correctly', () => {
    const result = formatOptionLabel('First\nSecond');
    expect(result).toBe('First\n│    Second');
  });
});

describe('W-05: clack-path label styling', () => {
  const DIM_GRAY = '\x1b[2m';
  const RESET    = '\x1b[0m';
  const BOLD     = '\x1b[1m';

  it('SHOW_SIMPLER item gets DIM_GRAY styled label in clackOptions', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput(), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const showSimplerOpt = opts.find((o) => o.value === SHOW_SIMPLER);
    expect(showSimplerOpt).toBeDefined();
    expect(showSimplerOpt!.label).toContain(DIM_GRAY);
    expect(showSimplerOpt!.label).toContain('Show simpler options');
  });

  it('SHOW_SIMPLER label is NOT the raw string (has styling)', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput(), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const showSimplerOpt = opts.find((o) => o.value === SHOW_SIMPLER);
    expect(showSimplerOpt).toBeDefined();
    expect(showSimplerOpt!.label).not.toBe(SHOW_SIMPLER);
  });

  it('SKIP_NOW item gets BOLD+DIM_GRAY styled label in clackOptions', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    await runLevel(makeInput(), 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const skipNowOpt = opts.find((o) => o.value === SKIP_NOW);
    expect(skipNowOpt).toBeDefined();
    expect(skipNowOpt!.label).toContain(BOLD);
    expect(skipNowOpt!.label).toContain(DIM_GRAY);
    expect(skipNowOpt!.label).toContain('Skip for now');
  });

  it('multi-line option text (via generatedOptions) gets label with \\n│    prefix on continuation lines', async () => {
    const spy = vi.fn().mockResolvedValue(SKIP_NOW);
    const multiLineL1 = ['1. Step one\n2. Step two\n3. Step three', 'Short lighter option'];
    const input = makeInput({ generatedOptions: { l1: multiLineL1, l2: ['L2 opt'], l3: ['L3 opt'] } });
    await runLevel(input, 1, spy as SelectFn);
    const opts = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0].options as { value: string; label: string }[];
    const multiLineOpt = opts.find((o) => o.label.includes('\n│    '));
    expect(multiLineOpt).toBeDefined();
    expect(multiLineOpt!.label).toBe('1. Step one\n│    2. Step two\n│    3. Step three');
  });
});

// ── DecisionSession — telemetry events ────────────────────────────────────────

describe('runDecisionSession — telemetry: decision_session_started', () => {
  beforeEach(() => { vi.mocked(writeTelemetry).mockClear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('emits decision_session_started with flagType, stage, pinchLabel, sessionId', async () => {
    await runDecisionSession(makeInput(), undefined, mockSelect(SKIP_NOW));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_started',
      expect.objectContaining({
        flagType:   'stage_transition',
        stage:      'implementation',
        pinchLabel: 'Hold up.',
        sessionId:  'session-test',
      }),
      undefined,
    );
  });

  it('emits decision_session_started even when no store is provided', async () => {
    await runDecisionSession(makeInput(), undefined, mockSelect(SKIP_NOW));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_started',
      expect.any(Object),
      undefined,
    );
  });

  // ── Phase 4 — decision_session_started enriched payload (Items B + J) ──────

  it('decision_session_started carries decisionSessionCountInProject from input', async () => {
    await runDecisionSession(
      makeInput({ decisionSessionCount: 7 }),
      undefined,
      mockSelect(SKIP_NOW),
    );
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_started',
      expect.objectContaining({ decisionSessionCountInProject: 7 }),
      undefined,
    );
  });

  it('decision_session_started defaults decisionSessionCountInProject to 0 when input is 0', async () => {
    await runDecisionSession(
      makeInput({ decisionSessionCount: 0 }),
      undefined,
      mockSelect(SKIP_NOW),
    );
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_started',
      expect.objectContaining({ decisionSessionCountInProject: 0 }),
      undefined,
    );
  });

  it('decision_session_started carries recentPrompts from input when provided', async () => {
    const recentPrompts = [
      { index: 1, classifiedStage: 'planning',       confidence: 0.7, capturedAt: 100 },
      { index: 2, classifiedStage: 'implementation', confidence: 0.9, capturedAt: 200 },
    ];
    await runDecisionSession(
      makeInput({ recentPrompts }),
      undefined,
      mockSelect(SKIP_NOW),
    );
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_started',
      expect.objectContaining({ recentPrompts }),
      undefined,
    );
  });

  it('decision_session_started defaults recentPrompts to [] when input is undefined', async () => {
    await runDecisionSession(makeInput(), undefined, mockSelect(SKIP_NOW));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_started',
      expect.objectContaining({ recentPrompts: [] }),
      undefined,
    );
  });
});

describe('runLevel — NEXPATH_SIM=1 support', () => {
  beforeEach(() => { vi.mocked(writeTelemetry).mockClear(); });
  afterEach(() => {
    delete process.env['NEXPATH_SIM'];
    vi.restoreAllMocks();
  });

  it('auto-selects first content option without calling selectFn when NEXPATH_SIM=1', async () => {
    process.env['NEXPATH_SIM'] = '1';
    const selectFn = vi.fn();
    const { composeDeterministicOptions } = await import('./engine-option-generator.js');
    const { shippedRecordLookup } = await import('./content-template-source.js');
    const recordGen = composeDeterministicOptions({ lookup: shippedRecordLookup('TASK_REVIEW'), level: 3, register: 'casual' });
    const result = await runLevel(makeInput(), 1, selectFn as SelectFn);
    expect(selectFn).not.toHaveBeenCalled();
    expect(result).toBe(recordGen!.l1[0]); // record-composed option (B11 — no static content)
  }, 2000);

  it('emits decision_session_sim_dismissed with level and autoSelectedText when NEXPATH_SIM=1', async () => {
    process.env['NEXPATH_SIM'] = '1';
    await runLevel(makeInput(), 1, vi.fn() as SelectFn);
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_sim_dismissed',
      expect.objectContaining({
        level: 1,
        autoSelectedText: expect.any(String),
      }),
      undefined,
    );
  }, 2000);

  it('calls selectFn normally when NEXPATH_SIM is not set', async () => {
    const selectFn = mockSelect(SKIP_NOW);
    await runLevel(makeInput(), 1, selectFn);
    expect(selectFn).toHaveBeenCalledTimes(1);
  });
});

// ── runLevel — Phase 3 enriched decision_session_dismissed payload ────────────

describe('runLevel — telemetry: decision_session_dismissed enriched payload (Phase 3)', () => {
  beforeEach(() => { vi.mocked(writeTelemetry).mockClear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Common assertion helper — the 6 context fields land verbatim from `input`.
  const expectRichDismissPayload = (reason: 'cancel' | 'skip', level: 1 | 2 | 3) =>
    expect.objectContaining({
      level,
      reason,
      flagType:    'stage_transition',
      stage:       'implementation',
      pinchLabel:  'Hold up.',
      sessionId:   'session-test',
      promptCount: 20,
    });

  it('emits 6 context fields when user cancels (Ctrl+C) at Level 1', async () => {
    await runLevel(makeInput(), 1, mockCancel());
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_dismissed',
      expectRichDismissPayload('cancel', 1),
      undefined,
    );
  });

  it('emits 6 context fields when user clicks SKIP_NOW at Level 2', async () => {
    await runLevel(makeInput(), 2, mockSelect(SKIP_NOW));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_dismissed',
      expectRichDismissPayload('skip', 2),
      undefined,
    );
  });

  it('emits 6 context fields when user clicks a blank separator at Level 3', async () => {
    // Separator values look like __nexpath_sep__<n> — runLevel treats those as skip.
    await runLevel(makeInput(), 3, mockSelect(`${OPTION_SEPARATOR}0`));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_dismissed',
      expectRichDismissPayload('skip', 3),
      undefined,
    );
  });

  it('skipCountInProject reflects real DB state when store is provided', async () => {
    const store = await openStore(':memory:');
    try {
      // Seed 3 prior skips for this project so the next dismissal observes count=3.
      const { insertSkippedSession } = await import('../store/skipped-sessions.js');
      for (let i = 0; i < 3; i++) {
        insertSkippedSession(store, {
          projectRoot:          '/proj/skip-count',
          sessionId:            `prior-${i}`,
          flagType:             'absence:test_creation',
          stage:                'implementation',
          levelReached:         1,
          skippedAtPromptCount: 5 + i,
        });
      }

      vi.mocked(writeTelemetry).mockClear();
      await runLevel(
        makeInput({ projectRoot: '/proj/skip-count' }),
        1,
        mockSelect(SKIP_NOW),
        store,
      );

      expect(writeTelemetry).toHaveBeenCalledWith(
        '/proj/skip-count',
        'decision_session_dismissed',
        expect.objectContaining({ skipCountInProject: 3 }),
        store,
      );
    } finally {
      store.db.close();
    }
  });

  it('skipCountInProject is null when no store is provided (graceful degradation)', async () => {
    await runLevel(makeInput(), 1, mockSelect(SKIP_NOW));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_dismissed',
      expect.objectContaining({ skipCountInProject: null }),
      undefined,
    );
  });

  it('runDecisionSession plumbs store through runLevel — full chain delivers rich payload', async () => {
    // End-to-end guard: if a future refactor accidentally drops `store` from
    // the runLevel() call inside runDecisionSession, this test catches it
    // even though both runLevel and runDecisionSession individually still work.
    const store = await openStore(':memory:');
    try {
      const { insertSkippedSession } = await import('../store/skipped-sessions.js');
      for (let i = 0; i < 2; i++) {
        insertSkippedSession(store, {
          projectRoot:          '/proj/plumb',
          sessionId:            `prior-${i}`,
          flagType:             'absence:test_creation',
          stage:                'implementation',
          levelReached:         1,
          skippedAtPromptCount: 5 + i,
        });
      }

      vi.mocked(writeTelemetry).mockClear();
      await runDecisionSession(
        makeInput({ projectRoot: '/proj/plumb' }),
        store,
        mockSelect(SKIP_NOW),
      );

      expect(writeTelemetry).toHaveBeenCalledWith(
        '/proj/plumb',
        'decision_session_dismissed',
        expect.objectContaining({
          level:              1,
          reason:             'skip',
          flagType:           'stage_transition',
          skipCountInProject: 2,
        }),
        store,
      );
    } finally {
      store.db.close();
    }
  });
});
