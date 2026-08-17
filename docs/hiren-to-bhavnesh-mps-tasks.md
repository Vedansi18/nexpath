# Hiren → Bhavnesh — MPS planner: discussion, decisions & deferred tasks

> Full record of the MPS 2nd-popup (continuation) investigation — what we discussed, what was
> decided, what is fixed, what is deferred, and what is still needed. Add future Hiren→Bhavnesh
> tasks at the bottom.

---

## 1. The feature and the bug

**MPS = Multi-Prompt Sequence.** A genuinely multi-step prompt is turned into a *sequence*: the first
popup (MPS 1) offers the enhanced first prompt + a "Sequence plan" summary; after it is sent, each
later item is offered one at a time at the next Stop (MPS 2 — the *continuation* popup).

**The bug:** the MPS 2nd (continuation) popup **never appears.** Root cause: the sequence **planner**
(P1 — `sequence-planner.ts` / `sequence-planner-output.ts` / `sequence-planner-prompt.ts`, **Hiren's
layer**) produces **0 items on every prompt**, so no sequence row is created and there is nothing to
continue. Confirmed by store (`max item_count = 0` ever) and by a standalone repro that calls the
planner directly (no hook/wiring) — it refuses every time.

**Whose layer:** the planner is **Hiren's**. The wiring, intake, and the continuation shell (Bhavnesh's)
are verified correct and simply never receive items. The popup "blink" seen during testing was an
**environment** issue (spawned-window/no-`/dev/tty`), not code — resolved on the user's side.

## 2. Why the planner refuses (diagnosis)

The planner asks an LLM to do a 3-stage chain (inventory points → group them → slice into items) with a
strict machine-checkable output contract, then validates it. On `gpt-4o-mini` the output was
**incoherent** (e.g. for the same 5-task prompt: points 1→4→1→2 across retries, empty groups). The
validators correctly reject it; the 3-retry repair loop (which already feeds the specific failure back)
can't converge → 0 items → fall back to a single prompt (the *designed* fail-safe).

The dev-plan (`…mps-sequence-sub-milestone-hiren-dev-plan.md`, **§6.2c / §6.3h**) had already measured
this exact failure live and ruled it a **product decision (Hiren's)** — explicitly *not* a loosened
check, *not* a unilateral model swap, *not* a widened repair bound. Keyword/rule-based checks are
locked-forbidden here (§26.1, Q16, the 2026-08-10 standing constraint: *"never text matching, keyword
lists, or scoring semantic quality"*).

## 3. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-08-15 | Upgrade the planner to a **stronger model** (`gpt-4o`), **for the planner call only**, not extremely expensive | **Hiren** (product decision) |
| 2026-08-15 | Grouping not respected (too many prompts) → **OK for now**; first prompt truncated → **OK for now**; but the **sequence must generate** and each prompt must appear in the popup | **Hiren** |
| 2026-08-15 | Summary "Remaining: N" count mismatch → **lenient / record-not-block** (affects MPS-1 display only; MPS-2 "N of M" reads the stored row and is unaffected) | Hiren + Bhavnesh |
| 2026-08-15 | Do **not** fix the two quality issues now — **defer** them to this file | Bhavnesh (per Hiren) |

## 4. What is FIXED and committed / in place

| Item | Where | Status |
|---|---|---|
| 7 stale test-fixture failures (MPS-3/MPS-12 contract) | `result-presentation.test.ts`, `sequence-packager-popup.test.ts` | ✅ committed `017ceb4` |
| Confirmation-kind continuation rejected by the builder | `continuation-popup.ts` (kind-aware validation) + regression test | ✅ committed `9193635` |
| Planner **model → gpt-4o** (planner-only constant) | `cost-observability.ts`, `sequence-planner.ts` | ✅ uncommitted — output now **coherent** |
| Planner **id-coercion** (accept numeric ids) | `sequence-planner.ts` | ✅ uncommitted — robustness |
| Planner **schema-format** (`sourcePointRanges` defined) | `sequence-planner-prompt.ts` | ✅ uncommitted — output now **parses** |

(tsc clean; full prompt-enhancement suite green.)

## 5. DEFERRED tasks (do NOT fix now — Hiren ruled the imperfections acceptable)

### Deferred Task 1 — grouping quality (`grouping_stage_did_nothing`)
- **Should:** GROUP points into fewer units before slicing (locked, Q25 / PE-AR-8.2.1). Currently emits
  **one group per point** → a 5-task request becomes **5 prompts instead of 2–3**.
- **Where:** `sequence-planner-output.ts:179` (`groups.length === points.length` → fail).
- **Proper fix (deferred):** a **canonical valid-output example** in the planner prompt so the model
  collapses points. NOT a check loosening — the check is correct per the locked grouping design.
- **Status:** DEFERRED (Hiren 2026-08-15) — one-group-per-point is acceptable to ship for now.

### Deferred Task 2 — first-prompt-whole (`first_task_slice_not_whole_original`)
- **Should:** the first sequence item must be the user's **WHOLE original prompt** (locked, §22.3(C)).
  The model sometimes emits a partial slice → the first prompt is **truncated**.
- **Where:** `sequence-payload.ts:490` (first_task slice must be `[0, full length]`).
- **Proper fix (deferred):** the same canonical prompt example; OR a deterministic normalisation (force
  the first slice to `[0, len]`) **if Hiren approves** (structural, not semantic).
- **Status:** DEFERRED (Hiren 2026-08-15) — a truncated first prompt is acceptable to ship for now.

## 6. The ENABLER still needed for MPS 2 to work (pending Hiren go-ahead)

⚠️ **Deferring the quality fixes does NOT make the sequence generate.** The **checks** above still
reject the plan, so `item_count` stays 0 and no 2nd popup appears. Per Hiren's "it must generate"
ruling, the blocking checks must be made **NON-BLOCKING** (record-not-block) so an
imperfect-but-coherent plan is accepted:
- `grouping_stage_did_nothing`, `first_task_slice_not_whole_original`, `point_in_no_group` (comes with
  grouping), and `summary_remaining_count_disagrees_with_items`.
- After that, the only HARD requirement is `invalid_output` — the model must return parseable,
  correctly-shaped output (largely satisfied by `gpt-4o` + the schema-format fix; a miss just falls back
  to a single enhanced prompt — no broken state).

**Owner note:** these are Hiren's locked checks. His "must generate, imperfect OK" ruling authorises the
principle; the actual edit is pending an explicit go-ahead to touch his checks.

## 7. Current status for MPS 2

- **Continuation shell (Bhavnesh):** ✅ done, tested — renders the 2nd popup the moment items exist.
- **Planner (Hiren):** model + format fixes done; **still produces 0 items** because the checks above
  still block. → **MPS 2 not yet testable end-to-end.**
- **To make MPS 2 testable:** apply the enabler in §6 (make the four checks non-blocking). Then the
  planner produces items → the 2nd popup appears.

---

## 8. Enabler APPLIED — 4-phase fix (2026-08-15)

The §6 enabler was implemented as a 4-phase change (grounded in the dev-plan §5.5a normalize-mandated-
literal + §5.5b relax-over-strict-and-self-check precedents). **No** keyword/scoring checks were added.

| Phase | Change | Where | Result |
|---|---|---|---|
| 1 | NORMALIZE the first item's slice to `[0, len]` and the summary `remainingTaskCount` to items-after-the-first, instead of rejecting (`first_task_slice_not_whole_original`, `summary_remaining_count_disagrees_with_items`) | `sequence-planner.ts` (post-grouping, pre-bounds) | ✅ 2 mandated-literal codes now corrected, not blocked |
| 2 | Make `grouping_stage_did_nothing` + `point_in_no_group` **record-not-block** at the call site (soft-code set); every other grouping code stays a hard fail | `sequence-planner.ts` (grouping call site) | ✅ soft plan now produces items |
| 3 | Add three SHAPE self-checks to the planner prompt (collapse groups; first item = whole original; remaining count = items-after-first) — model self-fix, not a deterministic proxy | `sequence-planner-prompt.ts` SECTION 6 | ✅ prompt-level quality nudge |
| 4 | Verify: full suites green; live repro | — | ⚠️ see below |

**Tests:** `sequence-planner.test.ts` 75/75 (2 assertions updated to the normalize behavior, 1 new
Phase-2 soft-passes test); full prompt-enhancement suite 1530 pass/1 todo; whole repo 8134 pass/1 todo;
tsc clean.

### ⚠️ Newly-surfaced blockers (NOT in the 4-phase scope — needs a decision)

The live repro confirms the four targeted checks **no longer block** — they never reappear as a reason.
But gpt-4o still cannot emit a fully-valid list, now failing on OTHER structural contract fields that
the plan never touched: **`complexity_presence_invalid`**, **`wrap_up_presence_does_not_match_count`**,
**`decomposition_group_id_invalid`**, **`item_count_below_min`** (plus transient `provider_error`).
So end-to-end the planner **still produces 0 items** → MPS-2 still not testable live.

These are Hiren's LOCKED structural-correctness checks (the six kinds / complexity presence / recap
rule), **not** the quality checks Hiren deferred. Options (need Hiren/owner direction — I did NOT
expand scope):
- (a) Extend the SECTION-6 model self-check to also cover complexity-presence + wrap_up + group-id
  (same Phase-3 style — model fixes itself; in-spirit, no new deterministic proxy).
- (b) Relax some as record-not-block (riskier — these are correctness, not the deferred quality pair).
- (c) Accept the single-prompt fallback for now and keep iterating on prompt quality only.

## Add future tasks below (Hiren → Bhavnesh)

<!-- New "Deferred Task N" sections go here, same format as §5. -->
