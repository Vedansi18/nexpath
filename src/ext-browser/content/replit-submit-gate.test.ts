import { describe, it, expect, vi } from 'vitest';
import {
  createReplitSubmitGate,
  REPLIT_INTERCEPT_READY,
  type ReplitDecision,
} from './replit-submit-gate.js';
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
  } as unknown as Event & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
}

function makeGate(over: Partial<Parameters<typeof createReplitSubmitGate>[0]> = {}) {
  const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
  // Composer empties by default — i.e. sends verify successfully.
  let composerText = '';
  const deps = {
    decide: vi.fn(async (): Promise<ReplitDecision> => ({ kind: 'allow' })),
    deliverReplacement: vi.fn(async () => true),
    reissueOriginal: vi.fn(async () => true),
    readComposerText: vi.fn(() => composerText),
    emit: (event: string, data?: Record<string, unknown>) => { events.push({ event, data }); },
    makeBudget: stubBudget(),
    isArmed: () => true,
    ready: true,
    ...over,
  };
  const gate = createReplitSubmitGate(deps as Parameters<typeof createReplitSubmitGate>[0]);
  return {
    gate, deps, events,
    names: () => events.map((e) => e.event),
    setComposer: (t: string) => { composerText = t; },
  };
}

const PROMPT = 'add tests for the checkout flow then deploy';
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createReplitSubmitGate', () => {
  describe('it is NOT armed in the shipped build', () => {
    it('REPLIT_INTERCEPT_READY is false until a live allow-path cycle is proven', () => {
      // Deliberate: the re-issue path can lose a prompt if it silently fails, and
      // unit tests cannot prove a real submit re-sends.
      expect(REPLIT_INTERCEPT_READY).toBe(false);
    });

    it('with the shipped readiness value the gate never intercepts', () => {
      const { gate } = makeGate({ ready: REPLIT_INTERCEPT_READY });
      const ev = makeEvent();
      expect(gate.maybeIntercept(ev, PROMPT)).toBe(false);
      expect(ev.preventDefault).not.toHaveBeenCalled();
      expect(ev.stopPropagation).not.toHaveBeenCalled();
    });
  });

  describe('when it declines to take over, it touches nothing', () => {
    const cases: Array<[string, Partial<Parameters<typeof createReplitSubmitGate>[0]>, string]> = [
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
    it('cancels the event so Replit never sees the original submit', () => {
      const { gate } = makeGate();
      const ev = makeEvent();
      expect(gate.maybeIntercept(ev, PROMPT)).toBe(true);
      expect(ev.preventDefault).toHaveBeenCalledTimes(1);
      expect(ev.stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('Enter and click for ONE submission produce one hold, not two', async () => {
      const { gate, deps, names } = makeGate({
        decide: vi.fn(() => new Promise<ReplitDecision>(() => {})), // hold open
      });
      expect(gate.maybeIntercept(makeEvent(), PROMPT)).toBe(true);
      expect(gate.maybeIntercept(makeEvent(), PROMPT)).toBe(true); // both cancelled
      await flush();
      expect(deps.decide).toHaveBeenCalledTimes(1);
      expect(names()).toContain('submit_hold_claim_duplicate');
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
    const blockDeps = { decide: vi.fn(async (): Promise<ReplitDecision> => ({ kind: 'block', replacement: 'the better prompt' })) };

    it('submits the replacement and never re-issues the original', async () => {
      const { gate, deps, names } = makeGate(blockDeps);
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();

      expect(deps.deliverReplacement).toHaveBeenCalledWith('the better prompt');
      expect(deps.reissueOriginal).not.toHaveBeenCalled();
      expect(names()).toEqual(['submit_hold_started', 'submit_hold_blocked']);
    });

    it('an empty replacement is treated as an allow', async () => {
      const { gate, deps } = makeGate({
        decide: vi.fn(async (): Promise<ReplitDecision> => ({ kind: 'block', replacement: '' })),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(deps.deliverReplacement).not.toHaveBeenCalled();
      expect(deps.reissueOriginal).toHaveBeenCalledTimes(1);
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
        decide: vi.fn(async (): Promise<ReplitDecision> => ({ kind: 'block', replacement: 'the better prompt' })),
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
        decide: vi.fn(async (): Promise<ReplitDecision> => ({ kind: 'block', replacement: 'x'.repeat(20) })),
        deliverReplacement: vi.fn(async () => { throw new Error('boom'); }),
      });
      gate.maybeIntercept(makeEvent(), PROMPT);
      await flush(); await flush();
      expect(gate.isReentrant()).toBe(false);
    });
  });
});
