# Replit — Capture Recon (B3)

**Release:** v0.1.5 (browser extension milestone — see `reviewduel-submodule` `docs/dev/v0.1.5-browser-extension-devplan.md` §7, phase B3)
**Date:** 2026-07-01 / 2026-07-02
**Method:** Manual DevTools Network + Elements inspection, relayed via screenshots (browser automation tool was disconnected for this session — see session-history `v015-b2-testing-recovery-and-ui-handoff-gap--discussion-log.md` §O–T for full detail).
**Test project:** `replit.com/@vedansi18/Hello-World` (a real Agent-built to-do list app), real prompts submitted: "hello", "build a to do list application", "change color to violet one", "make the header bold".

Per the devplan's mandatory-recon rule (§13.4): every value below was directly observed, not guessed. Where something remains unconfirmed it is called out explicitly as **NOT CONFIRMED**, not silently assumed.

---

## 1. Prompt-submit capture — ruled out: fetch, ruled out: readable WebSocket

**`fetch`/XHR:** Network tab (Fetch/XHR filter) across 4 separate real prompt submissions shows only two request patterns, both confirmed **unrelated** to chat content by opening their Payload:
- `graphql` requests → `operationName: "GetAgentFreeUsageV2"`, a persisted-query usage/quota check (polled independent of chat activity).
- Hash-named requests (e.g. `62b35a865152ab14c5942820`) → a **LaunchDarkly feature-flag/analytics event batch** (`kind: "feature"`, `flag-cookie-consent`, plus a `kind: "summary"` entry), status 202 (fire-and-forget beacon).

A DevTools Network full-text body search for the literal string of a submitted prompt ("header bold") returned **zero matches** across all Fetch/XHR/Doc/etc. traffic (44/56 requests searched). **Conclusion: prompt text does not travel through any HTTP fetch/XHR request or response body.**

**WebSocket:** 7 WS connections exist. Two are relevant:
- `river` (×2) — Replit's internal workspace/file/terminal sync protocol; `{"type":"ping"}`/`{"type":"pong"}` heartbeats plus separate binary frames.
- `river-chat` at `wss://production-chat.replit.com/api/river-chat` — domain name strongly implies this is the real Agent chat channel. **All frames are binary.** One opened frame (from a `river` connection) showed a hex dump matching **MessagePack** encoding (`88 A8 73 74 72 65 61 6D 49 64...` — a MessagePack fixmap+fixstr header for keys `streamId`, `heartbeat`, `controlFlags`), not protobuf — but that specific frame was a heartbeat control message, not chat content.

**Decision:** reverse-engineering Replit's private MessagePack wire schema to locate which field(s) carry prompt/response text is out of scope — impractical, undocumented, and inappropriate to attempt against a proprietary third-party service. **Prompt-submit and response-stop capture use DOM observation instead**, which turned out to be more reliable than the devplan's original fetch/WS-first plan anyway (see §3).

---

## 2. Confirmed DOM structure

All three selectors below were read directly from Chrome DevTools Elements panel on the live page — exact HTML, not inferred.

### 2.1 Submitted prompt (confirmed — source of truth for capture)

```html
<div data-cy="user-message" data-event-type="user-message" class="useView-module__vOh_Ha__view UserMessage-module_...">
  ...
  <div class="rendered-markdown">
    <div class="Markdown-module__eSbD4q__markdownTheme Markdown-module__eSbD4q__inheritShadesTextColor">
      <p>make the header bold</p>
    </div>
  </div>
</div>
```
Selector: `[data-cy="user-message"] .rendered-markdown` — read the `textContent`.

`data-cy` is Replit's own Cypress test-id attribute — chosen deliberately over the surrounding CSS-module class names (e.g. `UserMessage-module__ngyjq__...`), which include content hashes that will change on Replit's next deploy and are not a stable long-term selector.

### 2.2 Send button (confirmed)

```html
<button data-cy="ai-prompt-submit" data-action="submit" type="button" data-aria-pressable="true" ... disabled>
  <svg ...>...</svg>
</button>
```
Selector: `[data-cy="ai-prompt-submit"]`. Has a `disabled` attribute that toggles with Agent activity (see §3 response-stop).

### 2.3 Status text (confirmed, deliberately NOT used as the response-stop signal)

```html
<span class="AnimatedStatusText-module__0iY-IG__container">
  <span class="... Text-module__KIh4Sq__singleLine ...">Working</span>
  <span aria-hidden="true" class="AnimatedStatusText-module__0iY-IG__dots">...</span>
</span>
```
Text content varies during a turn (observed: "Deciding on friendly greeting", "Working", etc.) rather than being a fixed string, and the surrounding class names carry CSS-modules content hashes (`__0iY-IG__`, `__9t2cCa__`) that will break on Replit's next deploy. **Not used for response-stop detection** — see §3 for the more stable alternative found.

### 2.4 Prompt input — **CONFIRMED, 2026-07-02** — CodeMirror 6, not a plain textarea

```html
<div tabindex="-1" class="cm-scroller">
  <div spellcheck="false" autocorrect="off" autocapitalize="on" translate="no"
       contenteditable="true" style="tab-size: 4;"
       class="cm-content cm-lineWrapping"
       role="textbox" aria-multiline="true"
       autocomplete="off" aria-autocomplete="list">
  </div>
  <div class="cm-layer cm-layer-above cm-cursorLayer" ...></div>
  <div class="cm-layer cm-selectionLayer" ...></div>
  <div class="cm-layer cm-active-line-layer" ...></div>
  <div class="cm-layer cm-placeholder-layer" aria-hidden="true">
    <div class="cm-placeholder-dom _sdz_placeholder-text">Make, test, iterate…</div>
  </div>
</div>
```

**Confirmed via direct DOM inspection** (Ctrl+F search in Elements panel for the placeholder text "Make, test, iterate", not guessed). The `cm-*` class names (`cm-scroller`, `cm-content`, `cm-cursorLayer`, `cm-selectionLayer`, `cm-placeholder-layer`) are the standard, well-documented internal class names CodeMirror 6 assigns — Replit's prompt input is a full code-editor component, not a native `<textarea>`/`<input>`.

**This changes the inject-back approach from the devplan's original plan.** "Native setter + InputEvent" (`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set`) only works on real form elements — it has no meaning for a `contenteditable` CodeMirror instance, which maintains its own internal editor state (a `Text`/`EditorState` model) separate from the raw DOM. Directly mutating `textContent` would show text visually but leave CodeMirror's internal model out of sync — a well-known limitation of manipulating rich/code editors via the DOM directly, likely to produce broken or reverted text on the next keystroke or re-render.

**Approach used instead: simulated paste event.** CodeMirror 6 has built-in `paste` event handling that correctly updates its internal model (this is how real users pasting text into it already works). Selector: `.cm-content[contenteditable="true"]`. Focus the element, select its contents, then dispatch a synthetic `ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })` with the target text in `clipboardData`. Self-verified after dispatch by checking whether `textContent` actually changed — if not, falls back to `navigator.clipboard.writeText()` + an on-page toast telling the user to paste manually, per the devplan's existing fallback requirement.

**Not yet independently live-verified** (unlike the capture side, which has direct browser-console proof) — this specific mechanism (does Replit's CodeMirror instance actually accept a synthetic paste event the same way it accepts a real one) needs to be confirmed by the user in a real browser before being considered done.

---

## 3. Final capture strategy (confirmed, locked in)

| Signal | Method | Selector | Why |
|---|---|---|---|
| Prompt-submit | `MutationObserver` on the chat feed, watching for new `[data-cy="user-message"]` nodes | `[data-cy="user-message"] .rendered-markdown` | Captures the actually-sent, confirmed text regardless of submission method (click, Enter key, paste) — no race condition against React clearing the input field. More robust than the devplan's original "read textarea on send-click" plan. |
| Response-stop | `MutationObserver` (childList, subtree) watching for the stop button's presence being removed from the DOM | `[data-cy="ai-prompt-stop"]` | **Corrected 2026-07-02** via live Elements-panel inspection: Replit does NOT toggle `disabled` on the submit button to signal generation — that attribute reflects whether the input box is empty. While generating, Replit swaps in a wholly different element (`data-cy="ai-prompt-stop"`, different SVG icon); response-stop fires when that element disappears. The original `[data-cy="ai-prompt-submit"]`/`disabled`-toggle plan (§2.2) was a mistaken assumption, not a confirmed mechanism — see §7. |
| Capture tier (per devplan §12 `BrowserExtensionAdapter.capture`) | `['mutation-observer', 'dom-events']` — **corrected 2026-07-04** | — | `'fetch'` and `'websocket'` are confirmed non-viable for Replit (§1). `'dom-events'` was originally rejected as less reliable than MutationObserver — live testing then proved the opposite for prompt-submit: live-typed messages don't render through the recon-confirmed selectors at all (first prompt captured via hydration, every live-typed follow-up silently missed, sweep running for minutes without a match). The source-side composer channel (capture-phase Enter/click reading the CodeMirror composer at submit — classic tier-4 dom-events) is now the channel that actually catches live-typed prompts; mutation-observer remains primary for hydration-rendered messages and all response-stop detection. All channels dedup through one consecutive-identical-collapse funnel. |

Telemetry: content script logs `[nexpath] capture: mutation-observer` per devplan §8.1.

---

## 4. Inject-back — implemented 2026-07-02, pending live confirmation

Input confirmed as CodeMirror 6 (§2.4), not a plain textarea. Implemented via simulated paste event + self-verification + clipboard fallback (see `src/ext-browser/content/agents/replit.ts`'s `injectPromptText`). Unit-tested against jsdom (which can simulate `ClipboardEvent` dispatch and DOM mutation, but cannot verify CodeMirror's actual internal-model behavior — that's a real browser-only concern). **Still needs a live test**: select an advisory option for real and confirm the text actually appears correctly in Replit's input, not just that an event was dispatched.

---

## 5. Open items

- [x] Confirm the prompt input's DOM structure (§2.4) — done, CodeMirror 6 confirmed
- [ ] Live-verify inject-back actually works against Replit's real CodeMirror instance (§4) — implemented, not yet confirmed working
- [ ] Firefox: this recon was done entirely in Chrome; DOM structure should be identical (same web app, no browser-specific rendering expected) but not independently re-verified in Firefox
- [x] Response-stop detection (§3, §7) — the original `disabled`-toggle mechanism was confirmed broken via live Elements-panel inspection 2026-07-02 (Replit swaps in a different `data-cy="ai-prompt-stop"` element while generating, rather than toggling `disabled` on the submit button); fixed to detect that element's removal instead. Implemented and unit-tested; still needs the user's live retest of a full generate cycle to confirm it fires for real.

## 6. Real bug found and fixed via manual testing: page-load history replay (2026-07-02)

`observeUserMessages` originally started with an empty seen-set and attached its `MutationObserver` directly — but Replit loads chat history into the DOM asynchronously *after* the content script attaches (at `document_idle`), so every historical message in an existing conversation got treated identically to a genuinely new one. User's manual test confirmed this directly: opening the SW console without submitting anything new showed a burst of `prompt_submit_received`/`prompt_classified` entries for old messages.

**Fixed with the exact same pattern already proven in this codebase** for the identical bug class: `src/ext-vscode/src/chat-history-watcher.ts`'s `primedTargets` mechanism, which fixed this for Cursor/Windsurf ("every Cursor restart re-emitted the entire prompt backlog, flooding Layer C's session-state machine and producing advisory storms that bypass the 3-prompt warmup + 5-prompt cooldown gates" — same failure mode, same root cause). `observeUserMessages` now does a synchronous priming scan of every `[data-cy="user-message"]` already in the DOM at setup time, registering them as seen *without* emitting captures, before attaching the observer. Only messages inserted after that point — genuinely new submissions — are captured. This is also implicitly what Claude Code's push-based hook guarantees for free (it can never fire for an old prompt, since the hook invocation *is* the new-prompt event).

## 7. Two more real bugs found via live testing, 2026-07-02 (after the stale-instance guard fix)

User retested the idempotent-injection guard fix and it worked — exactly one `capture: mutation-observer` line, no stale-instance duplication. But a genuinely new duplication surfaced, plus a pre-existing gap became visible:

**Bug A — duplicate capture during Replit's own page-load transition (fixed, then generalized after a second, differently-timed occurrence).** Evidence: submitting a prompt while the tab title still read "Loading… - Replit" produced exactly one `prompt_submit_received`/`prompt_classified` pair (`promptCount: 1`). The instant the tab title changed to the project's real name (Replit's own page finished loading/hydrating), a second identical-text pair appeared (`promptCount: 2`) — with the chat still showing "Working.", i.e. no new prompt was sent. Root cause: Replit swaps its chat DOM from a lightweight loading-shell render to the fully-hydrated real list around that transition, re-creating the `[data-cy="user-message"]` element as a *new* DOM node carrying the same text. `observeUserMessages`'s `seenMessages` `WeakSet` dedups by element identity, so a re-created node with identical content isn't recognized as already-seen.

**First fix attempt**: a secondary, short time-windowed text dedup (`recentTexts: Map<string, number>`, 4-second window) alongside the WeakSet. **Retested by the user and the duplication recurred** — this time the user pinpointed the exact trigger: the first `prompt_submit_received`/`prompt_classified` pair fired on hitting Submit, and a second identical pair fired when the "Working" status label first appeared, a separate re-render from the page-load one, with a gap that can exceed any fixed window depending on Replit's own response latency. **Fixed properly, no time bound**: replaced the window with an unbounded "collapse consecutive identical captures" guard (`lastEmittedText: string | null`) — any number of redundant re-renders of the same still-most-recent message collapse to exactly one emission, regardless of the gap between them, and the guard resets the instant a genuinely different message is captured (so an intentional identical resend after another prompt still counts normally). Accepted, documented tradeoff: sending the exact same text twice in a row with nothing in between is indistinguishable from a re-render artifact using DOM observation alone.

**Bug B — response-stop never fires — root cause confirmed via live Elements-panel evidence, then fixed (2026-07-02).** Across a full submit→"Working"→completed-response cycle, `response_stop_received` never appeared in the SW console even once. User inspected the submit button in both states as requested: idle showed `data-cy="ai-prompt-submit"` with `disabled="true"` (input box empty) — generating showed a *completely different* element, `data-cy="ai-prompt-stop"`, different SVG icon entirely. This confirms the original recon assumption (§2.2: "`disabled` toggles with Agent activity") was simply wrong — that attribute reflects whether the input box has text, not generation state. Replit swaps in a wholly separate stop button while generating rather than toggling `disabled` on the same node, so the old attribute-mutation-based detection could never fire.

**Fixed**: `observeSubmitButton` now watches for `[data-cy="ai-prompt-stop"]`'s presence being removed from the DOM (childList/subtree observation, not attribute filtering) — `wasGenerating` tracks whether that element currently exists; its disappearance after having been present is the response-stop signal. Test suite for `observeSubmitButton` was rewritten to match (appear/disappear semantics instead of disabled-attribute toggling); also surfaced and fixed a related pre-existing test-isolation gap — the module's own auto-run `bootstrap()` creates a long-lived, never-disconnected observer at import time that persists for the whole test file, and a later test's `beforeEach` DOM-clearing could itself register as a spurious "removed" transition that leaked into an unrelated test's assertion. Fixed by draining pending mutation notifications (`await flush()`) against the outgoing spy before installing each test's fresh one.

**Verified**: 145 files / 5025 tests green (+1), `tsc --noEmit` clean, fresh rebuild clean, zero regression on frozen files. **Not yet independently live-verified against a real full generate cycle** — implemented and unit-tested against the exact confirmed DOM shape from the screenshots, but the user's live retest is still needed before this can be called done.
