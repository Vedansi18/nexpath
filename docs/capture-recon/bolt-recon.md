# Bolt.new — Capture Recon (B4)

**Status: RECON COMPLETE — 2026-07-04.**
**Method:** Live automated DevTools-equivalent session driven by the assistant via claude-in-chrome in the user's own logged-in Chrome profile (first recon ever done this way — B3's was manual screenshots). Network requests read via the extension's network tracker; request/response shapes confirmed via a temporary page-context fetch tap (removed by tab reload afterwards); DOM read via sanitized in-page queries. Two real prompts submitted to project `bolt.new/~/sb1-1wsba8zs` ("what is machine learning" was pre-existing; "what is supervised learning exactly" submitted twice during recon).

Per devplan §13.4: every value below was directly observed. Remaining unknowns are explicitly marked **NOT CONFIRMED**.

---

## 1. Prompt-submit transport — CONFIRMED: same-origin page-context fetch

**`POST https://bolt.new/api/chat/v2` → 200.** Request body is JSON with keys:
`messages, isFirstPrompt, featurePreviews, errorReasoning, promptMode, selectedModel, projectId, codeStorageRepo, stripeStatus, usesInspectedElement, runningCommands, projectFiles, globalSystemPrompt, dependencies, hostingProvider, agent, problems, id, codeStorageAnnotations`.

- `messages` is the full conversation history (observed `msgCount: 5`); the **last entry is `{role: 'user', content: '<prompt string>'}`** — content is a plain string. This is exactly the devplan §8.2 predicted extraction: `messages.at(-1).content` where `role === 'user'`.
- Issued from the page context (our temporary tap on `window.fetch` — which chains on top of nexpath's own MAIN-world stub — saw it directly), so **nexpath's MAIN-world fetch wrapper CAN intercept it**. `window.__nexpath_emit_prompt__ === 'function'` confirmed live on the page: our extension loads and MAIN-world injection works on bolt.new.
- Secondary confirmation channel: **`POST https://bolt.new/api/chats/<projectId>?organization=<orgId>` → 204**, body `{messages: [{role:'user', content:'<prompt>'}]}` — a persistence call carrying ONLY the new message. Not used for capture (the /api/chat/v2 rule is sufficient), documented for completeness.

**Response:** `200`, `content-type: text/plain; charset=utf-8`, streamed. First bytes: `f:{"messageId":"<uuid>"}` then `8:[{"type":"branch"...` — the **Vercel AI SDK data-stream protocol** (prefixed lines: `f:` metadata, `0:` text deltas, `8:` data parts), not SSE `data:` lines.

**Supporting endpoints observed (not used for capture):** `GET /api/token-stats`, `GET /api/claude/updates/<projectId>` (404 idle-polling; confirms a Claude-based backend), `POST /api/snapshot/<projectId>`, GA event literally named `Bolt Prompt sent`, and a `prompt_result {service:'bolt-client', outcome:'success'}` console telemetry object at completion.

## 2. Confirmed DOM structure

### 2.1 Chat composer — TipTap/ProseMirror (NOT CodeMirror, NOT a textarea)

```
div.tiptap.ProseMirror  role="textbox"  contenteditable="true"
    aria-label="How can Bolt help you today? (or /command)"
  ↑ div._EditorContent_12v58_1   (hashed CSS-module class — do not use)
```

- Selector: **`.tiptap.ProseMirror`** (stable library class names, same reasoning as Replit's `cm-content`).
- **Enter submits** (confirmed live — typed prompt + Return produced the user bubble, the /api/chat/v2 POST, and a streamed reply).
- TipTap renders one `<p>` per line; its empty-state placeholder is CSS-rendered (not textContent), so an empty composer reads as `''` — no placeholder-capture risk (simpler than Replit's CodeMirror).
- ⚠️ **Critical inversion vs Replit:** on Bolt, `.cm-content` (CodeMirror 6) EXISTS but is the **file editor** (`aria-label="Editor"`), and the page also has 3 xterm terminal `<textarea>`s. Replit's composer selector would capture FILE CONTENTS on Bolt. Per-agent config is mandatory; the composer-channel's file-editor guard (anchor on the send button's container) applies here identically.

### 2.2 Send / stop buttons — stable aria-labels (better than Replit's data-cys)

- Idle: **`button[aria-label="Send message"]`** — `disabled` when the composer is empty (same semantics as Replit: disabled reflects empty input, NOT generation state).
- While generating: replaced by **`button[aria-label="Stop generation"]`** (enabled). Confirmed by sampling at T0 and T+3s after submit: only "Stop generation" existed; after completion only "Send message" (disabled) existed.
- Response-stop signal: **presence→absence of `button[aria-label="Stop generation"]`** — drops verbatim into capture-kit's `stopButtonSelector` detector (observer + poll).

### 2.3 User-message bubble — SAME render path live-typed and hydrated (unlike Replit)

Both the hydrated pre-existing message and the freshly live-typed one showed the identical ancestry:

```
p  →  div._MarkdownContent_1iu5k_54  →  div.overflow-hidden.bg-bolt-ds-utilHover.px-4…
   →  div.grid.grid-col-1.self-end  →  div.relative.flex.flex-col…  →  div.flex.flex-col.gap---chat-messages-gap
```

- No `data-testid`/`data-cy` anywhere near it. `_MarkdownContent_1iu5k_54` carries a deploy-hash (`1iu5k`); `self-end` marks user-alignment (agent messages are markdown too, but not `self-end`).
- Best available selector: **`.self-end [class*="_MarkdownContent_"]`** (prefix partial-match survives hash suffix changes; `self-end` scopes to user messages). Fragile-by-nature — acceptable because on Bolt this is the TERTIARY channel (fetch is primary, composer secondary), the exact defense-in-depth inversion of Replit.

### 2.4 Completion label

A **`Version N at <time>` card** appears in the chat per completed turn (confirmed: "Version 2 at Jul 04 3:44 PM" created by a pure Q&A turn). Usable as the independent completion-label detector (`/\bVersion \d+ at\b/`), analogous to Replit's "Worked for X".

## 3. Final capture strategy (confirmed, locked in)

| Signal | Method | Selector/endpoint | Notes |
|---|---|---|---|
| Prompt-submit (primary) | MAIN-world fetch interception | `POST` URL containing `/api/chat` on bolt hosts → `body.messages.at(-1).content` where `role==='user'` | The devplan's original tier-2 'fetch' plan finally applies (non-viable on Replit) |
| Prompt-submit (secondary) | Composer read at submit (dom-events) | `.tiptap.ProseMirror` + `button[aria-label="Send message"]` anchor; Enter submits | Same kit channel as Replit; per-agent selectors prevent the file-editor trap (§2.1) |
| Prompt-submit (tertiary) | MutationObserver + park/sweep | `.self-end [class*="_MarkdownContent_"]` | Defense-in-depth only |
| Response-stop | Stop-button presence removal (observer + poll) + `Version N at` completion label | `button[aria-label="Stop generation"]`; `/\bVersion \d+ at\b/` | Deliberately NOT signaled from the fetch stream end — single source of truth for stop stays DOM-side, deduped in the kit |
| Capture tiers (`adapters/browser/bolt.ts`) | `['fetch', 'dom-events', 'mutation-observer']` | — | |

All prompt channels must funnel through the kit's single `emitIfNewText` collapse so fetch + composer + observer can never double-emit (same rule that fixed Replit).

## 4. Inject-back

TipTap/ProseMirror contenteditable → **simulated paste via `inject-kit.ts`** (ProseMirror handles paste through its own transaction pipeline, same rationale as CodeMirror on Replit). Selector: `.tiptap.ProseMirror`. **NOT yet live-verified** — needs the same live confirmation Replit's inject-back eventually got.

## 5. Open items

- [ ] Inject-back live verification (§4) — implement first, then live test.
- [ ] `*.stackblitz.com` host variant: manifest + `resolveAgent()` already treat it as bolt; whether the same UI/DOM serves there is **NOT CONFIRMED** (bolt.new confirmed only).
- [ ] Landing-page (`bolt.new` home) prompt box: creates the project then hard-navigates to `/~/<slug>` (content scripts re-inject). First-prompt capture on the landing page **NOT CONFIRMED** — the landing composer wasn't inspected; acceptable gap since the project page is where sessions live (note: the project-creation prompt arrives in `/api/chat/v2`'s `messages` history anyway).
- [ ] Whether `Version N at` cards appear for EVERY turn type (confirmed for Q&A and observed for the build turn) — the label is a dedup'd secondary signal, so a miss is harmless.
