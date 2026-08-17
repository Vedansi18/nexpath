# MPS Continuation — Test Plan (PENDING)

> Purpose: define the test scenarios to GENERATE for the MPS 2nd-popup (continuation) fix
> (Phases 1–4 of `mps-continuation-fix-plan.md`). This is a PLAN, kept pending — it lists the
> scenarios, their intent, and how they must run. Nothing here is executed automatically yet.

---

## 0. Hard principles (read first)

1. **Unit tests MUST be hermetic — NO `.env`, NO live OpenAI key dependency.**
   - Finding (2026-08-16): with a real key present via `.env`, `continuation-shell-p5-integration.test.ts`
     ("live assembled shell") flips 6 results from `inject`/`cancel` to `keep`. Removing `.env` → all
     pass. So a live key must NEVER be required for the unit suite. Live LLM calls must be STUBBED.
   - Practical rule: run `npx vitest run` with **no `.env`** in the project root. `.env` is for the
     Phase-4 live E2E ONLY, run by hand, never by the unit suite.
2. **The core correctness invariant to protect in every scenario:**
   **MPS-2 appears ONLY when the backend generated a real sequence.** Never "every time" after the
   first popup. A single-intent prompt (no handoff) must produce NO row and NO 2nd popup.
3. **Fail-closed everywhere:** any miss (no handoff, no send, intake not recorded, gate closed, host
   miss) leaves NO row and renders NOTHING — never a partial/again-and-again popup.

---

## 1. Layer A — spawned popup host (`prompt-enhancement-popup-host.ts`) — HERMETIC, done in Phase 1

Mock `runMpsPopup` / `runPopup`; assert the `mpsFirstPopupSent` output flag.

| # | Scenario | Setup | Expect |
|---|----------|-------|--------|
| A1 | MPS first popup SENT | handoff-bearing input; `runMpsPopup → {state:'send', bodyText}` | `output.result = selected_current`; **`mpsFirstPopupSent === true`** |
| A2 | MPS Esc → PE popup | `runMpsPopup → {state:'declined'}`; `runPopup → selected_original` | `output.result = selected_original`; **`mpsFirstPopupSent === false`** |
| A3 | MPS cancelled | `runMpsPopup → {state:'cancelled'}` | `closed_no_send`; **`mpsFirstPopupSent` falsy** |
| A4 | No handoff (single prompt) | input WITHOUT `handoffAndSequenceSummary` | `runMpsPopup` NOT called; `mpsFirstPopupSent` falsy |
| A5 | Invalid/missing/stale input | bad input files | `closed_no_send`; `mpsFirstPopupSent: false` |

Status: **A1–A5 covered in Phase 1** (`prompt-enhancement-popup-host.test.ts`).

## 2. Layer B — parent spawn branch (`stop.ts`) — records the row on the flag

> **G1 — DEFERRED TO PHASE 4 (owner instruction 2026-08-16).** The full testing for the parent
> spawn-branch glue lives here and is to be executed when Phase 4 starts. Do NOT build a code seam for
> it now. Coverage today: the real `peLaunch` (which holds the spawn-branch intake) is injected as a
> mock in all `runStop` tests, so this glue is **E2E-only** (identical to the pre-existing `direct_tty`
> intake — a long-standing pattern, not new to Phase 1). At Phase 4, cover B1–B6 either via the live
> E2E (§4) or by adding a minimal seam that makes the spawn-branch intake callable in isolation.
>
> Live data-path pre-check available NOW (no code change, no seam): **`scripts/mps-sequence-llm-verify.mjs`**
> exercises the real LLM layer end-to-end (prepare+planner → items-2…N wording batch → intake) and
> reports whether a fully-worded, recordable sequence is produced. Run with a key in the environment.

Scenarios to cover at Phase 4 (via the live E2E or a seam):

| # | Scenario | Expect |
|---|----------|--------|
| B1 | `mpsFirstPopupSent=true` + valid sequence (handoff, `remainingTaskCount≥1`) | exactly ONE `pending_prompt_sequences` row; `itemCount = remaining+1` (≥2); worded items 2…N present |
| B2 | `mpsFirstPopupSent=false` (Esc/PE send) | **NO** row written |
| B3 | No handoff (single prompt) | batch never starts; **NO** row |
| B4 | Intake fail-closed (`remainingTaskCount=0`, scope mismatch, invalid handoff) | intake returns non-recorded; **NO** row (fail-closed) |
| B5 | Batch skipped/failed (provider error) | row still recorded (empty worded payload), never crashes the hook |
| B6 | Idempotency | re-running the same first-send does not create duplicate active rows |

## 3. Layer C — continuation launcher + shell (Phases 2–3)

> **Phase 3 status (2026-08-16): the dual-path wiring is DONE** in `stop.ts` — the continuation
> launcher now chooses in-process (`direct_tty`) vs the Phase-2 spawned host by host capability, folds a
> non-completed launch to `not_shown` (fail-closed), and feeds the outcome into the existing
> deliver/persist/advance. **Hermetic coverage:** C1 (gate closed → nothing renders / row untouched) is
> covered by the existing `stop.test.ts` fail-closed tests, which still pass — proving the change did not
> weaken the gate. **E2E-only (Phase 4):** C2–C7 require `gate.allowed === true`, which needs a real key
> (the provider flag) AND `NEXPATH_MPS_TEST_UNGATE=1`; the branch then calls real capability detection +
> real spawn/render, so it cannot run in the hermetic suite. Verify C2–C7 live at Phase 4.

| # | Scenario | Expect |
|---|----------|--------|
| C1 | Active row + `stop_hook_active` + gate CLOSED (production default) | nothing renders; row untouched (fail-closed) — **production-safety regression** |
| C2 | Active row + gate OPEN (test un-gate) + spawn host | 2nd popup renders in a spawned window (Phase 2 host) |
| C3 | Continuation send | item advances (index 0→1→…), body injected, row persisted (MPS-9) |
| C4 | Continuation cancel-mid-sequence | terminal cancel scoped to THIS row only |
| C5 | item_pending | same item re-offered unchanged next Stop |
| C6 | mid-sequence advance | from item 1 serves item 2 of a 3-item sequence |
| C7 | max item cap (30) | packages + serves clamped, never dropped |
| C8 | stale/dead row after wait | silent no-op; no stale write |
| C9 | No TTY + no spawn host available | `not_shown`; row stays pending (no crash) |

## 4. Layer D — LIVE end-to-end (Phase 4) — PENDING, needs key + un-gate

Run by hand ONLY (never in the unit suite). Requires: OpenAI key reachable AND
`NEXPATH_MPS_TEST_UNGATE=1` AND a prompt that reliably decomposes.

**Q1 decision (owner 2026-08-16): do NOT change production code for the batch/gate efficiency point.**
Instead, verify the LLM layer with a script — `scripts/mps-sequence-llm-verify.mjs` — which calls the
real pipeline (prepare+planner → items-2…N wording batch → intake) and reports generated / worded /
recordable. It touches no production code. Run:
`npm run build && OPENAI_API_KEY=sk-... node scripts/mps-sequence-llm-verify.mjs`
(Provide the key at run time via the environment, NOT a committed `.env`.)

| # | Scenario | Expect |
|---|----------|--------|
| D1 | Full loop | first popup → send → row written → 2nd popup (item 2) → … → sequence completes |
| D2 | Single prompt (control) | no handoff → no row → **no 2nd popup** (guards the "not every time" invariant live) |
| D3 | Planner reliability | pick a reliably-decomposing prompt; a fallback-to-single is acceptable, not a failure |

Key handling for D: provide the key at run time via the shell environment for that one command
(e.g. `OPENAI_API_KEY=… NEXPATH_MPS_TEST_UNGATE=1 node <script>`), NOT via a committed `.env`, and
NEVER leave a key-bearing `.env` in the tree during a unit run.

## 5. Pre-existing hermeticity fix to schedule (separate from Phase 1)

`continuation-shell-p5-integration.test.ts` must be made **key-independent**: stub the LLM/body
producer so the result is identical whether or not a key is present. Until then, the rule in §0.1
(run the suite with no `.env`) is mandatory. Also worth confirming this is only a test-timing
artifact and not a real continuation-shell defect when a live call is in the path (investigate before
Phase 4).

## 6. How to run (today)

- Hermetic unit suite: **no `.env` in the project root**, then `npx vitest run`.
- Never rely on a key for any test in §1–§3. §4 is manual and key-bearing, out of the unit suite.
