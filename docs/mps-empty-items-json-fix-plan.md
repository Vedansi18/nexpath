# MPS-2 empty `items_json` — Fix Plan (2026-08-17)

> The 2nd (continuation) popup does not appear because `pending_prompt_sequences.items_json` is `[]`.
> This plan fixes the **cause** of the empty list, not the symptom.

## 1. Confirmed root cause (evidence, not guess)
- `items_json` is empty because the wording batch had **0 items to word**, because the **planner produced 0 structural items** (LLM variance). Store proof: `planner_items_json = 0` on every failing run.
- The empty **accepted** row (`item_count=7`, `items=[]`, `status=awaiting_response`) is **designed fail-closed behavior**, NOT a broken layer — `sequence-payload.ts:228–233` "PRE-PLANNER WINDOW" exemption explicitly allows an accepted row with an empty list when nothing produced items.
- The deterministic layers (intake / store / continuation) are **correct** — proven by the live `GATE: PASS` (given real items they fill `items_json` and would render). They simply, correctly, have nothing to show.
- **Two LLM stages** can each yield empty and must both succeed:
  1. **Planner** (auto hook) → `planner_items_json`
  2. **Body producer** (Stop wording batch) → `items_json`

## 2. What "fixing the empty json" actually means
The json is empty **by design** when there is no content. Making it reliably non-empty means **guaranteeing content is produced** — that is the real fix. Three complementary fixes:

### Fix A — Deterministic sequence fallback (durable; GUARANTEES the popup)
When the LLM planner yields 0 items on a prompt the deterministic decomposer already found to be multi-task, build a **valid sequence without the LLM**, from the point inventory + `taskSlices` that already exist at the auto/planner layer. Removes the LLM-luck dependency → `items_json` non-empty **every time** → 2nd popup always shows.
- **Location: planner / auto layer (Hiren's).** The full text, point inventory, and `taskSlices` exist there. The intake (Stop) has **counts only** (`taskSlices` are metadata-only: IDs/refs, no raw text) — so the fallback cannot live at intake.
- Must also cover the **body producer**: either the deterministic planner emits already-worded items, or a deterministic wording step words from the slice text — otherwise the 2nd LLM stage can re-empty the list.
- **Authority: Hiren's layer → needs his sign-off.** May fall under his delegated D2/D3 authority IF PE/PEF are untouched (must prove additive, no single-prompt-PE impact — coverage rule §21.3(e)).

### Fix B — Reliability hardening of the two LLM stages (interim; in my authority now)
Extend the §5.5a normalize + §5.5b self-checks to the remaining failure reasons (`wrap_up_presence_does_not_match_count`, `decomposition_group_id_invalid`, complexity/confirmation mismatches). **Raises** the success rate; never 100%. Hiren already permitted this class of fix.

### Fix C — State hygiene (complementary)
When items are genuinely empty (and the deterministic fallback also yields nothing), **do not write the dead accepted row** — return `no_sequence` so the store has no misleading `item_count=7 / items=[]` row. Does not itself show the popup; keeps state honest.

## 3. Recommendation
- **Primary: Fix A** — the only path that makes the 2nd popup appear on **every** multi-step turn (no LLM luck). Pair with **Fix C** for clean state.
- **Interim: Fix B** now — I can start immediately under existing Hiren permission while Fix A is designed and signed off.

## 4. Phased implementation — Fix A (each phase: develop → unit test → report gaps/questions → commit)
- **Phase 0 — design + Hiren sign-off.** Write the deterministic-decomposition contract (map `taskSlices` → sequence items via the point inventory; deterministic wording from slice text). Prove additive + no PE/PEF impact. Get Hiren's go.
- **Phase 1 — deterministic planner fallback.** When the LLM planner returns 0 items AND the decomposer found ≥2 tasks, emit deterministic structural items (offsets from point inventory, itemKinds, rule-based confirmations). Unit tests. Commit.
- **Phase 2 — deterministic body-producer fallback.** When the wording batch fails/empties, word items from the slice text deterministically (valid, non-empty). Unit tests. Commit.
- **Phase 3 — wire + fail-closed.** Fallback fires ONLY for genuine multi-task prompts (never fabricates a sequence for a single task); the runtime gate stays fail-closed. Commit.
- **Phase 4 — E2E.** Diagnostic + interactive 2nd popup with a multi-step prompt across several turns → 2nd popup **every** turn (deterministic).

## 5. Fix C phase
- Intake returns `no_sequence` (skip the upsert) when `wordedItems` empty AND the deterministic fallback also yields nothing → no dead row. Unit test the "no empty accepted row" invariant.

## 6. Testing
- **Unit:** fallback decomposition; deterministic wording; "never fabricate single-task sequence"; "no empty accepted row".
- **Functional:** force LLM planner to 0 items (stub) → deterministic fallback fills `items_json`.
- **E2E:** multi-step prompt, several turns → 2nd popup every turn.
- **Full hermetic suite:** 0 regressions.

## 7. Risks / constraints
- **Hiren's layer:** Fix A touches the planner content contract → needs sign-off; prove no PE/PEF impact.
- **Quality:** a deterministic sequence is simpler than an LLM-worded one — acceptable (a shown popup beats none); can be upgraded later.
- **Fail-closed:** must not fabricate a sequence for genuinely single-task prompts.
- **Un-gate** (`NEXPATH_MPS_TEST_UNGATE` / production) remains **owner's** — separate from this fix.

## 8. How to fix it — one paragraph
Make sequence content **deterministic** so `items_json` is never empty when a multi-step prompt is detected: **(A)** the planner emits a rule-based decomposition from the already-computed `taskSlices` when the LLM yields 0 items, **(B)** the body producer words from the slice text when the LLM wording fails, **(C)** never write a dead empty row. Net effect: the 2nd popup shows every time, with no dependence on LLM luck. A + B live in Hiren's planner layer → need his sign-off; Fix B (reliability hardening) I can start immediately under existing permission.
