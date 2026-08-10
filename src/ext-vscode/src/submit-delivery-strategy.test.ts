/**
 * H4 — delivery strategy: direct injection is PRIMARY, clipboard is last resort.
 *
 * These exist because the shipped wiring had this exactly backwards: the submit
 * poller's onInject went straight to the clipboard delivery, so the real
 * command-based injector was never called on the submit path. The ordering is
 * therefore pinned, not assumed.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  deliverSubmitReplacement,
  CLIPBOARD_FALLBACK_NOTICE,
} from './submit-delivery-strategy.js';

function deps(over: Record<string, unknown> = {}) {
  return {
    injectDirect: vi.fn().mockResolvedValue(true),
    fallbackClipboard: vi.fn().mockResolvedValue(true),
    notify: vi.fn(),
    ...over,
  } as never;
}

describe('⭐ direct injection is the PRIMARY path', () => {
  it('injects directly and never touches the clipboard', async () => {
    const d = deps();
    const r = await deliverSubmitReplacement('refined', d);
    expect(r).toEqual({ outcome: 'injected', landed: true });
    expect((d as never as { injectDirect: ReturnType<typeof vi.fn> }).injectDirect)
      .toHaveBeenCalledWith('refined');
    expect((d as never as { fallbackClipboard: ReturnType<typeof vi.fn> }).fallbackClipboard)
      .not.toHaveBeenCalled();
  });

  it('shows NO notification on the normal path', async () => {
    // The user should see only their refined prompt appear.
    const d = deps();
    await deliverSubmitReplacement('refined', d);
    expect((d as never as { notify: ReturnType<typeof vi.fn> }).notify).not.toHaveBeenCalled();
  });

  it('MUTATION GUARD: clipboard must not be tried before injection', async () => {
    const order: string[] = [];
    const d = deps({
      injectDirect: vi.fn(async () => { order.push('inject'); return false; }),
      fallbackClipboard: vi.fn(async () => { order.push('clipboard'); return true; }),
    });
    await deliverSubmitReplacement('refined', d);
    expect(order).toEqual(['inject', 'clipboard']);
  });
});

describe('post-inject verification — "accepted" is not "landed"', () => {
  it('falls back when verification says the text did not land', async () => {
    const d = deps({ verifyLanded: vi.fn().mockResolvedValue(false) });
    const r = await deliverSubmitReplacement('refined', d);
    expect(r.outcome).toBe('clipboard_fallback');
    expect(r.landed).toBe(false);
  });

  it('stays injected when verification confirms it landed', async () => {
    const d = deps({ verifyLanded: vi.fn().mockResolvedValue(true) });
    const r = await deliverSubmitReplacement('refined', d);
    expect(r.outcome).toBe('injected');
    expect((d as never as { fallbackClipboard: ReturnType<typeof vi.fn> }).fallbackClipboard)
      .not.toHaveBeenCalled();
  });

  it('a throwing verifier is treated as "did not land"', async () => {
    const d = deps({ verifyLanded: vi.fn().mockRejectedValue(new Error('x')) });
    expect((await deliverSubmitReplacement('refined', d)).outcome).toBe('clipboard_fallback');
  });

  it('no verifier ⇒ the command result is trusted', async () => {
    const d = deps();
    expect((await deliverSubmitReplacement('refined', d)).outcome).toBe('injected');
  });
});

describe('fallback is reached ONLY after direct injection failed', () => {
  it('notifies so the cancelled turn is never a silent loss', async () => {
    // The hook already exited 2, so the original prompt is gone. Without this the
    // user sees a cancelled prompt and no explanation.
    const d = deps({ injectDirect: vi.fn().mockResolvedValue(false) });
    const r = await deliverSubmitReplacement('refined', d);
    expect(r.outcome).toBe('clipboard_fallback');
    expect((d as never as { notify: ReturnType<typeof vi.fn> }).notify)
      .toHaveBeenCalledWith(CLIPBOARD_FALLBACK_NOTICE);
  });

  it('a throwing injector still reaches the fallback', async () => {
    const d = deps({ injectDirect: vi.fn().mockRejectedValue(new Error('boom')) });
    expect((await deliverSubmitReplacement('refined', d)).outcome).toBe('clipboard_fallback');
  });

  it('reports failed when both paths fail — caller must surface it', async () => {
    const d = deps({
      injectDirect: vi.fn().mockResolvedValue(false),
      fallbackClipboard: vi.fn().mockResolvedValue(false),
    });
    const r = await deliverSubmitReplacement('refined', d);
    expect(r).toEqual({ outcome: 'failed', landed: false });
    expect((d as never as { notify: ReturnType<typeof vi.fn> }).notify).not.toHaveBeenCalled();
  });

  it('refuses an empty replacement rather than clearing the composer', async () => {
    const d = deps();
    expect((await deliverSubmitReplacement('', d)).outcome).toBe('failed');
    expect((d as never as { injectDirect: ReturnType<typeof vi.fn> }).injectDirect)
      .not.toHaveBeenCalled();
  });
});

describe('landed drives auto-submit eligibility', () => {
  it('only a direct injection reports landed:true', async () => {
    // Auto-submit after a clipboard fallback would press Enter on a composer the
    // user has not pasted into yet.
    expect((await deliverSubmitReplacement('x', deps())).landed).toBe(true);
    expect((await deliverSubmitReplacement('x', deps({
      injectDirect: vi.fn().mockResolvedValue(false),
    }))).landed).toBe(false);
  });
});
