# Lovable — Capture Recon (B5)

**Release:** v0.1.5 (browser extension milestone — see `reviewduel-submodule` `docs/dev/v0.1.5-browser-extension-devplan.md` §9, phase B5)
**Status: RECON COMPLETE — 2026-07-06.**
**Method:** Live automated session driven by the assistant via claude-in-chrome in the user's
own logged-in Chrome profile (same method as B4's Bolt recon). Fresh Lovable account; project
created during recon (`Sweet Quotes`, `lovable.dev/projects/21239a50-…`); 2 real prompts spent
("Build a simple quotes page with three quote cards" from the dashboard box, "Make the quote
cards responsive" in-project). Transport confirmed via constructor taps (WebSocket + EventSource
+ fetch) installed in the page BEFORE the in-project prompt — decisive, not inferred.

Per devplan §13.4: every value below was directly observed. Remaining unknowns are explicitly
marked **NOT CONFIRMED**.

## 1. Project URL shape — CONFIRMED

`https://lovable.dev/projects/<uuid>` (e.g. `/projects/21239a50-17b8-4fa3-a8ca-03ab8d24d0c3`).
Dashboard is `/dashboard`; marketing home is `/`. → `resolveProjectRootFromLocation` rule:
`/^\/projects\/([^/]+)/` → `origin + '/projects/' + id`; anything else on lovable.dev → null.

**Dashboard → project navigation is a HARD navigation** (page context dies — probe did not
survive; unlike Bolt and Replit, which soft-navigate). Consequence: the in-memory rejected-capture
stash dies with the dashboard page → the stash must survive same-tab navigations
(sessionStorage-backed) for Lovable's dashboard flow to deliver.

## 2. Transport — CONFIRMED: page-context fetch (devplan's WebSocket guess was WRONG)

**`POST https://api.lovable.dev/projects/<uuid>/chat`** — plain `window.fetch` from the page
(caught by an in-page fetch tap; zero `ws-open` / `es-open` events fired during a full prompt
cycle). Cross-origin (page `lovable.dev` → `api.lovable.dev`) but interception happens at the
page's own `fetch`, so nexpath's MAIN-world wrapper sees it.

Request body (JSON, observed head):
`{"id":"umsg_01kwv…","message":"Make the quote cards responsive","files":[],"selected_elements":[],…}`
→ **prompt field is the flat string `message`**; user-message ids start with `umsg_`.

Endpoint-matching discipline (B4's `/api/chats` persist-replay lesson): match the URL **pathname
ending in `/chat`** on `api.lovable.dev`, POST only, AND require the strict body shape
(`id` starts with `umsg_`, `message` is a non-empty string) — lookalike endpoints must produce
null from the extractor.

## 3. Composer / submit DOM — CONFIRMED

- Composer: **TipTap/ProseMirror** (same family as Bolt) — `.tiptap.ProseMirror` with
  `role="textbox"` and **`aria-label="Chat input"`** (both on the dashboard creation box and the
  in-project composer). Enter submits; one `<p>` per line; empty ⇒ send button disabled.
- Submit button: **`button[aria-label="Send message"]`** (identical aria-label to Bolt),
  `disabled` ⇔ composer empty. Shares a container with the composer (the kit's composer-channel
  adjacency requirement holds).
- Other buttons in the container: `Additional actions` (+ menu, `data-testid="chat-input-action-menu-trigger"`),
  `Enable plan mode` ("Build" mode toggle), `Start voice recording`.

## 4. User-message DOM — CONFIRMED (semantic attributes, identical on both render paths)

- Every chat message: `div[data-message-id]` with the pattern
  `main:agent#<seq>#usr:<hash>` for USER messages and `main:agent#<seq>#ast:<hash>` for
  assistant messages → **user-message selector: `[data-message-id*="#usr"]`**.
- The user bubble also carries `data-current-user="true"` (class `group/user-message`) — second
  confirmation handle.
- Message body text lives in an inner `div.prose[data-selectable="true"]` → extract prompt text
  from `.prose` (the bubble's outer textContent includes the timestamp "Today at 5:08 PM…" —
  extracting from `.prose` avoids it).
- **Hydrated (post-reload) and live-typed DOM are IDENTICAL** (same `data-message-id` values and
  structure verified before and after a full page reload) — no B3-style dual-render-path trap.

## 5. Response-stop signals — CONFIRMED (button swap; no completion label)

- Generating: `button[aria-label="Stop generating"]` present, send button GONE (element swap,
  Bolt-style — both states directly observed across two generations).
- Idle: `button[aria-label="Send message"]` present.
- **No "Worked for"/version-card completion label exists** — turn completion renders an edit
  card ("Added quotes page" + Details/Preview) whose title verb varies; too fragile for a
  secondary signal. Decision: response-stop = stop-button removal only (observer + the kit's
  1500ms poll safety net). `completionLabel` config deliberately omitted.

## 6. Landing/home flow — PARTIALLY CONFIRMED

- Dashboard (`/dashboard`) has the creation prompt box (TipTap, same selectors); submitting
  creates the project and **HARD-navigates** to `/projects/<uuid>` (§1).
- The user message renders in the project page chat with the standard `#usr` message DOM.
- **NOT CONFIRMED: whether the project page re-POSTs `/chat` at load for the creation prompt**
  (the tap was installed after the navigation). Delivery of the dashboard-typed prompt therefore
  relies on: sessionStorage-surviving stash (primary, nav-mode-independent) + the mutation
  observer seeing the rendered `#usr` message on the project page (it renders after bootstrap;
  priming happens on an empty chat) + the fetch rule if a re-POST exists. Verify during
  implementation's live E2E which channels fire; the funnel + SW same-text dedup absorb overlap.
- Marketing home `/` (logged-out) also has a prompt box — logged-out flows are out of scope.

## 7. Final capture strategy (locked in)

| Signal | Method | Selector/endpoint | Notes |
|---|---|---|---|
| Prompt-submit (primary) | MAIN-world fetch interception | POST, host `api.lovable.dev`, pathname ends `/chat` → `body.message` where `body.id` starts `umsg_` | Kit fetch channel (`listenForFetchPrompts`), strict body guard per B4 lesson |
| Prompt-submit (secondary) | Composer read at submit | `.tiptap.ProseMirror[aria-label="Chat input"]` + `button[aria-label="Send message"]` | Same kit channel as Bolt/Replit |
| Prompt-submit (tertiary) | MutationObserver + park/sweep | `[data-message-id*="#usr"]`, text via `.prose` | Semantic attrs; identical both render paths |
| Response-stop | Stop-button presence removal (observer + poll) | `button[aria-label="Stop generating"]` | No completion label (deliberate, §5) |
| Capture tiers (`adapters/browser/lovable.ts`) | `['fetch', 'dom-events', 'mutation-observer']` | — | Same tier set as Bolt |

All prompt channels funnel through the kit's single `emitIfNewText` collapse (no-double-emit
invariant), and the dashboard flow additionally requires the sessionStorage-backed stash.

## 8. Inject-back — CONFIRMED strategy (not yet live-verified)

TipTap/ProseMirror contenteditable → **simulated paste via `inject-kit.ts`** — the exact
mechanism live-verified on Bolt (same editor family). Selector: `.tiptap.ProseMirror[aria-label="Chat input"]`.
Live verification happens at the B5 E2E gate.

## 9. Open items

- [ ] Dashboard-flow creation-prompt delivery — verify live which channels fire (§6) once the
      capture code + sessionStorage stash are installed.
- [ ] Inject-back live verification (§8) at the E2E gate.
- [ ] Free-tier budget: recon spent 2 credits; E2E needs ~2 more (daily limit ~5) — plan runs
      accordingly.
- [ ] Same-origin iframes: none observed in the workspace (preview iframe is
      `<uuid>.lovableproject.com` — foreign origin, outside manifest matches; one src-less
      iframe present; `all_frames` is false anyway). Re-check only if double-bootstrap logs appear.
