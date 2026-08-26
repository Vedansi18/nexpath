import { describe, it, expect, vi } from 'vitest';
import {
  createComposerSubmitGate,
  type ComposerDecision,
} from './composer-submit-gate.js';
import type { HoldBudget, HoldBudgetDeps } from '../adapters/submit-hold-budget.js';

function stubBudget(opts: { timeout?: boolean } = {}) {
  const budget: HoldBudget = {
    remaining: () => 75_000,
    expired: () => false,
    async run<T>(work: () => Promise<T>) {
      if (opts.timeout === true) return { timedOut: true };
      try { return { timedOut: false, value: await work() }; }
      catch { return { timedOut: false, value: undefined }; }
    },
  };
  return (_d?: HoldBudgetDeps): HoldBudget => budget;
}

function makeEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as Event & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
    stopImmediatePropagation: ReturnType<typeof vi.fn>;
  };
}

function makeGate(over: Partial<Parameters<typeof createComposerSubmitGate>[0]> = {}) {
  const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
  // Composer empties by default — i.e. sends verify successfully.
  let composerText = '';
  const deps = {
    decide: vi.fn(async (): Promise<ComposerDecision> => ({ kind: 'allow' })),
    deliverReplacement: vi.fn(async () => true),
    reissueOriginal: vi.fn(async () => true),
    readComposerText: vi.fn(() => composerText),
    emit: (event: string, data?: Record<string, unknown>) => { events.push({ event, data }); },
    makeBudget: stubBudget(),
    isArmed: () => true,
    agent: 'bolt',
    ...over,
  };
  const gate = createComposerSubmitGate(deps as Parameters<typeof createComposerSubmitGate>[0]);
  return {
    gate, deps, events,
    names: () => events.map((e) => e.event),
    setComposer: (t: string) => { composerText = t; },
  };
}

const PROMPT = 'add tests for the checkout flow then deploy';
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createComposerSubmitGate', () => {
  describe('when it declines to take over, it touches nothing', () => {
    const cases: Array<[string, Partial<Parameters<typeof createComposerSubmitGate>[0]>, string]> = [
      ['the switch is off', { isArmed: () => false }, PROMPT],
      ['the prompt is blank', {}, '   '],
      ['the prompt is empty', {}, ''],
    ];
    for (const [name, over, prompt] of cases) {
      it(`${name} → returns false and never cancels the event`, () => {
        const { gate, deps } = makeGate(over);
        const ev = makeEvent();
        expect(gate.maybeIntercept(ev, prompt)).toBe(false);
        expect(ev.preventDefault).not.toHaveBeenCalled();
        expect(deps.decide).not.toHaveBeenCalled();
      });
    }

    it('reads the switch per event rather than caching it', () => {
      let armed = false;
      const { gate } = makeGate({ isArmed: () => armed });
      expect(gate.maybeIntercept(makeEvent(), PROMPT)).toBe(false);
      armed = true;
      expect(gate.maybeIntercept(makeEvent(), PROMPT)).toBe(true);
    });
  });

  describe('taking over a submission', () => {
    it('cancels the event so the site never sees the original submit', () => {
      const { gate } = makeGate();
      const ev = makeEvent();
      expect(gate.maybeIntercept(ev, PROMPT)).toBe(true);
      expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('uses stopIMMEDIATEPropagation — plain stopPropagation was proven insufficient on Bolt', () => {
      // Live-proven 2026-08-26: with stopPropagation, Bolt still submitted
      // (`prompt-attempted` fired). With stopImmediatePropagation it did not.
      // Bolt has a document-level listener registered before ours, and only the
      // immediate form stops listeners on the SAME node.
      const { gate } = makeGate();
      const ev = makeEvent();
      gate.maybeIntercept(ev, PROMPT);
      expect(ev.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    });

    it('cancels EVERY duplicate too — a duplicate that is not cancelled sends the original', () => {
      const { gate } = makeGate({ decide: vi.fn(() => new Promise<ComposerDecision>(() => {})) });
      const first = makeEvent();
      const second = makeEvent();
      gate.maybeIntercept(first, PROMPT);
      expect(gate.maybeIntercept(second, PROMPT)).toBe(true);
      expect(second.preventDefault).toHaveBeenCalledTimes(1);
      expect(second.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    });

    it('Enter and click for ONE submission produce one hold, not two', async () => {
      const { gate, deps, names } = makeGate({
        decide: vi.fn(() => new Promise<ComposerDecision>(() => {})), // hold open
      });
      expect(gate.maybeIntercept(makeEvent(), PROMPT)).toBe(true);
      expect(gate.maybeIntercept(makeEvent(), PROMPT)).toBe(true); // both cancelled
      await flush();
      expect(deps.decide).toHaveBeenCalledTimes(1);
      expect(names()).toContain('submit_hold_claim_duplicate');
    });

    it('stamps every event with the agent so the ring can tell sites apart', async () => {
      const { gate, events } = makeGate({ agent: 'lovable' });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(events[0]!.data).toMatchObject({ agent: 'lovable' });
    });
  });

  describe('ALLOW — the harder path: re-issue what we cancelled', () => {
    it('re-issues the original and verifies it actually sent', async () => {
      const { gate, deps, names } = makeGate();
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();

      expect(deps.reissueOriginal).toHaveBeenCalledTimes(1);
      expect(deps.deliverReplacement).not.toHaveBeenCalled();
      expect(names()).toEqual(['submit_hold_started', 'submit_hold_released_allow']);
      expect(names()).not.toContain('submit_reissue_unverified');
    });

    it('says so LOUDLY when the composer never clears (the prompt may be lost)', async () => {
      const { gate, names, setComposer } = makeGate();
      setComposer('still sitting in the box'); // never clears
      gate.maybeIntercept(makeEvent(), PROMPT);
      await vi.waitFor(() => expect(names()).toContain('submit_reissue_unverified'), { timeout: 4000 });
    });

    it('reports a re-issue that throws', async () => {
      const { gate, names } = makeGate({ reissueOriginal: vi.fn(async () => { throw new Error('no button'); }) });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await vi.waitFor(() => expect(names()).toContain('submit_reissue_failed'));
    });

    it('a timed-out hold re-issues the original', async () => {
      const { gate, deps, names } = makeGate({ makeBudget: stubBudget({ timeout: true }) });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(deps.reissueOriginal).toHaveBeenCalledTimes(1);
      expect(names()).toContain('submit_hold_expired');
    });

    it('a decider that throws re-issues the original', async () => {
      const { gate, deps, names } = makeGate({ decide: vi.fn(async () => { throw new Error('sw died'); }) });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(deps.reissueOriginal).toHaveBeenCalledTimes(1);
      expect(names()).toContain('submit_hold_released_error');
    });
  });

  describe('BLOCK — deliver the replacement instead', () => {
    const blockDeps = { decide: vi.fn(async (): Promise<ComposerDecision> => ({ kind: 'block', replacement: 'the better prompt' })) };

    it('submits the replacement and never re-issues the original', async () => {
      const { gate, deps, names } = makeGate(blockDeps);
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();

      expect(deps.deliverReplacement).toHaveBeenCalledWith('the better prompt');
      expect(deps.reissueOriginal).not.toHaveBeenCalled();
      // submit_replacement_sent is the confirmation that it actually went out —
      // the composer emptied — not merely that we asked for it.
      expect(names()).toEqual(['submit_hold_started', 'submit_hold_blocked', 'submit_replacement_sent']);
    });

    it('an empty replacement is treated as an allow', async () => {
      const { gate, deps } = makeGate({
        decide: vi.fn(async (): Promise<ComposerDecision> => ({ kind: 'block', replacement: '' })),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(deps.deliverReplacement).not.toHaveBeenCalled();
      expect(deps.reissueOriginal).toHaveBeenCalledTimes(1);
    });

    it('a replacement the composer never accepted is NOT reported sent — it falls back to the original', async () => {
      // deliverReplacement resolves true, but the composer still holds text, so
      // nothing actually went out. Reporting success here would silently lose the
      // user's turn — the RC13 lesson: a mechanism that "succeeds" without
      // delivering is worse than none.
      let t = 1_000;
      const { gate, deps, names, setComposer } = makeGate({
        ...blockDeps,
        deliverReplacement: vi.fn(async () => true),
        budget: { now: () => (t += 2_000) }, // clock races past the verify deadline
      });
      setComposer('the text never left the box');

      gate.maybeIntercept(makeEvent(), PROMPT);
      await vi.waitFor(() => expect(names()).toContain('submit_hold_substitution_failed'));
      expect(names()).not.toContain('submit_replacement_sent');
      await vi.waitFor(() => expect(deps.reissueOriginal).toHaveBeenCalledTimes(1));
    });

    it('a replacement that fails to land falls back to the ORIGINAL — the turn is never swallowed', async () => {
      const { gate, deps, names } = makeGate({
        ...blockDeps, deliverReplacement: vi.fn(async () => false),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(names()).toContain('submit_hold_substitution_failed');
      expect(deps.reissueOriginal).toHaveBeenCalledTimes(1);
    });

    it('a replacement that THROWS also falls back to the original', async () => {
      const { gate, deps } = makeGate({
        ...blockDeps, deliverReplacement: vi.fn(async () => { throw new Error('composer gone'); }),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(deps.reissueOriginal).toHaveBeenCalledTimes(1);
    });
  });

  describe('re-entrancy — our own submit must not be re-intercepted', () => {
    it('does not intercept while a replacement is being delivered', async () => {
      let seen: boolean | null = null;
      const { gate } = makeGate({
        decide: vi.fn(async (): Promise<ComposerDecision> => ({ kind: 'block', replacement: 'the better prompt' })),
        deliverReplacement: vi.fn(async () => {
          // This is what the site's own listener would see mid-delivery.
          seen = gate.maybeIntercept(makeEvent(), 'the better prompt');
          return true;
        }),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(seen).toBe(false);
      expect(gate.isReentrant()).toBe(false); // released afterwards
    });

    it('does not intercept while the original is being re-issued', async () => {
      let seen: boolean | null = null;
      const { gate } = makeGate({
        reissueOriginal: vi.fn(async () => {
          seen = gate.maybeIntercept(makeEvent(), PROMPT);
          return true;
        }),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(seen).toBe(false);
    });

    it('clears the re-entrancy flag even when delivery throws', async () => {
      const { gate } = makeGate({
        decide: vi.fn(async (): Promise<ComposerDecision> => ({ kind: 'block', replacement: 'x'.repeat(20) })),
        deliverReplacement: vi.fn(async () => { throw new Error('boom'); }),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(gate.isReentrant()).toBe(false);
    });
  });
});
