/**
 * Installs the composer submit gate for one agent.
 *
 * Each agent module calls this once with its own inject function and send-button
 * selector; everything else — resolving the switch, the service-worker
 * round-trip, the ring events — is identical across sites and lives here.
 *
 * ── WHY THE SWITCH IS RESOLVED PER AGENT MODULE ─────────────────────────────
 * Content-script entry points are bundled SEPARATELY (esbuild inlines a module's
 * top-level code into every entry that imports it), so module-level state does
 * not cross bundles: a value the injector's bundle resolves is invisible here.
 * Resolving locally — once at load, then on every storage change — is
 * self-contained and cheap. `armed` starts false, so an unresolved switch never
 * intercepts, which is the safe direction.
 */
import browser from 'webextension-polyfill';
import { resolveSubmitFlow, submitFlowStorageKeys } from '../../adapters/submit-flow-config.js';
import { createComposerSubmitGate, type ComposerDecision } from '../composer-submit-gate.js';
import { setComposerSubmitInterceptor } from './capture-kit.js';
import { resolveProjectRootFromLocation } from './agent-hosts.js';
import { fetchGateOwnsSite } from '../../inject/submit-substitution.js';

export interface InstallSubmitGateOptions {
  agent: string;
  /** The site's real send control, clicked to submit what is in the composer. */
  submitButtonSelector: string;
  /** The agent's own inject-and-send helper (simulated paste + submit). */
  injectPromptText: (text: string) => Promise<void>;
}

export function installSubmitGate(opts: InstallSubmitGateOptions): void {
  let armed = false;

  const applySwitch = (): void => {
    void resolveSubmitFlow(opts.agent)
      .then((r) => { armed = r.enabled; })
      .catch(() => { armed = false; });
  };
  applySwitch();
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const watched = new Set(submitFlowStorageKeys());
      if (Object.keys(changes).some((k) => watched.has(k))) applySwitch();
    });
  } catch {
    /* no storage events — the load-time resolution still applies */
  }

  const sendToSw = (msg: unknown): void => {
    try {
      void browser.runtime.sendMessage(msg).catch(() => { /* worker asleep */ });
    } catch { /* extension context invalidated mid-navigation */ }
  };

  const projectRootOf = (): string =>
    resolveProjectRootFromLocation(
      window.location.hostname, window.location.pathname, window.location.origin,
    ) ?? '';

  const clickSend = (): boolean => {
    const btn = document.querySelector<HTMLElement>(opts.submitButtonSelector);
    if (!btn) return false;
    btn.click();
    return true;
  };

  let gate: ReturnType<typeof createComposerSubmitGate> | null = null;

  setComposerSubmitInterceptor((ev, prompt, input, composer) => {
    gate ??= createComposerSubmitGate({
      agent: opts.agent,
      // Two conditions. The second is what keeps the two mechanisms from ever
      // both owning a submission: where the page's fetch patch does the
      // rewriting (Lovable), this gate stands down completely.
      isArmed: () => armed && !fetchGateOwnsSite(opts.agent),
      emit: (event, data) => {
        sendToSw({ type: 'nexpath:submit-flow-event', site: opts.agent, event, data: data ?? {} });
      },
      readComposerText: () => {
        try { return composer.readComposerText(input); } catch { return ''; }
      },
      decide: async (ctx) => {
        const res = await browser.runtime.sendMessage({
          type: 'nexpath:submit-decision-request',
          site: opts.agent,
          projectRoot: projectRootOf(),
          requestId: `${ctx.submitId}#${performance.now().toFixed(0)}`,
          prompt: ctx.prompt,
          submitId: ctx.submitId,
        }) as { decision?: { kind?: string; replacement?: string } } | undefined;
        const d = res?.decision;
        if (d?.kind === 'block' && typeof d.replacement === 'string' && d.replacement.length > 0) {
          return { kind: 'block', replacement: d.replacement } satisfies ComposerDecision;
        }
        return { kind: 'allow' };
      },
      // The agent's inject helper performs the simulated paste AND the send
      // (it verifies the text landed first), so one call delivers the prompt.
      deliverReplacement: async (text) => {
        // Mark it BEFORE it lands. The replacement is submitted through the
        // site's own composer, so the capture channels see it as a brand-new
        // prompt — without this it re-enters the pipeline, double-counts the
        // turn and can prepare a second enhancement. Same marker the shipped
        // response-stop inject path uses; the worker's cross-page dedup
        // collapses the echo.
        sendToSw({ type: 'nexpath:prompt-injected', projectRoot: projectRootOf(), text });
        await opts.injectPromptText(text);
        return true;
      },
      // The original is still sitting in the composer — we cancelled the user's
      // own submit, so re-issuing means pressing the site's send control.
      reissueOriginal: async () => clickSend(),
    });
    return gate.maybeIntercept(ev, prompt);
  });
}
