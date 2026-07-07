import { describe, it, expect } from 'vitest';
import { NEXPATH_HEADER } from './DecisionSession.js';
import {
  buildFeedbackRenderOptions,
  runFeedbackPopup,
  FEEDBACK_OPTIONS,
  FEEDBACK_QUESTION,
  FEEDBACK_PINCH_LABEL,
  FEEDBACK_NOTE,
  type FeedbackRenderFn,
} from './feedback-popup.js';
import {
  renderLoop,
  stripAnsi,
  type SelectableItem,
  type KeyEvent,
  type KeyEventName,
} from './render-loop.js';

describe('buildFeedbackRenderOptions', () => {
  const layout = buildFeedbackRenderOptions(30, 100);

  it('uses the branded wordmark as the page header', () => {
    expect(layout.pageHeader).toBe(NEXPATH_HEADER);
  });

  it('uses the "feedback" pinch label and the English question', () => {
    expect(layout.pinchLabel).toBe(FEEDBACK_PINCH_LABEL);
    expect(layout.pinchLabel).toBe('feedback');
    expect(layout.question).toBe(FEEDBACK_QUESTION);
  });

  it('renders the four ratings in order: Bad, Good, Fine, Excellent', () => {
    expect(layout.options.map((o) => o.label)).toEqual(['Bad', 'Good', 'Fine', 'Excellent']);
  });

  it('includes the transparency note above the question (with a blank line)', () => {
    expect(layout.subtitle).toBe(`${FEEDBACK_NOTE}\n`);
    expect(FEEDBACK_NOTE).toMatch(/installation ID/i);
  });

  it('options are plain content items (no desc-base, no separators/meta)', () => {
    for (const o of layout.options) {
      expect(o.descBase).toBeUndefined();
      expect(o.isSeparator).toBeFalsy();
      expect(o.isMeta).toBeFalsy();
    }
  });

  it('passes through the terminal dimensions', () => {
    expect(layout.rows).toBe(30);
    expect(layout.cols).toBe(100);
  });
});

describe('runFeedbackPopup', () => {
  const pick = (value: string): FeedbackRenderFn =>
    async () => ({ value, label: 'x' } as SelectableItem);

  it('maps each option to its rating', async () => {
    for (const o of FEEDBACK_OPTIONS) {
      const result = await runFeedbackPopup({ render: pick(o.value), rows: 24, cols: 80 });
      expect(result).toEqual({ outcome: 'selected', rating: o.rating });
    }
  });

  it('returns dismissed when the popup is cancelled (null)', async () => {
    const result = await runFeedbackPopup({ render: async () => null, rows: 24, cols: 80 });
    expect(result).toEqual({ outcome: 'dismissed' });
  });

  it('returns dismissed for an unrecognised picked value', async () => {
    const result = await runFeedbackPopup({ render: pick('not-a-rating'), rows: 24, cols: 80 });
    expect(result).toEqual({ outcome: 'dismissed' });
  });

  it('feeds the built layout to the renderer', async () => {
    let seenQuestion = '';
    const render: FeedbackRenderFn = async (layout) => {
      seenQuestion = layout.question;
      return null;
    };
    await runFeedbackPopup({ render, rows: 24, cols: 80 });
    expect(seenQuestion).toBe(FEEDBACK_QUESTION);
  });
});

describe('renders with the real render loop', () => {
  async function* keys(...names: KeyEventName[]): AsyncGenerator<KeyEvent> {
    for (const name of names) yield { name };
  }
  function captureOut() {
    let buf = '';
    const out = { write: (s: string) => { buf += s; return true; } } as unknown as NodeJS.WritableStream;
    return { out, text: () => stripAnsi(buf) };
  }

  it('draws the wordmark, pinch, question and all four ratings', async () => {
    const { out, text } = captureOut();
    await renderLoop({ layout: buildFeedbackRenderOptions(30, 100), keyEvents: keys('escape'), out });
    const drawn = text();
    expect(drawn).toContain('NEXPATH CLI');
    expect(drawn).toContain('feedback');
    expect(drawn).toContain("How's nexpath working out for you?");
    expect(drawn).toContain('installation ID');
    // Note is above the question.
    expect(drawn.indexOf('installation ID')).toBeLessThan(drawn.indexOf("How's nexpath"));
    for (const label of ['Bad', 'Good', 'Fine', 'Excellent']) expect(drawn).toContain(label);
  });

  it('Enter selects the initially-focused first rating (Bad)', async () => {
    const { out } = captureOut();
    const picked = await renderLoop({ layout: buildFeedbackRenderOptions(30, 100), keyEvents: keys('enter'), out });
    expect(picked?.value).toBe(FEEDBACK_OPTIONS[0].value);
  });

  it('Escape dismisses (renderLoop resolves null)', async () => {
    const { out } = captureOut();
    const picked = await renderLoop({ layout: buildFeedbackRenderOptions(30, 100), keyEvents: keys('escape'), out });
    expect(picked).toBeNull();
  });

  it('arrow-down then Enter selects the second rating (Good)', async () => {
    const { out } = captureOut();
    const picked = await renderLoop({ layout: buildFeedbackRenderOptions(30, 100), keyEvents: keys('arrow-down', 'enter'), out });
    expect(picked?.value).toBe(FEEDBACK_OPTIONS[1].value);
  });
});
