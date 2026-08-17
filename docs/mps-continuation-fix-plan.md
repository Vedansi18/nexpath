# MPS 2nd-Popup (Continuation) — Fix Plan

> Goal: make the MPS continuation (2nd) popup work end-to-end on the **spawned-window** environment
> (the real user setup), by giving the continuation pipeline the same parity the in-process
> `direct_tty` path already has — while keeping the runtime gate fail-closed in production.

Status: **PLAN — awaiting go-ahead.** Nothing here is implemented yet.
Owner of code: Bhavnesh (host wiring). Owner of the production un-gate: Hiren/owner.

---

## 1. Root cause (proven, 110% confirmed)

The MPS continuation was wired **only** for the in-process `direct_tty` Stop path. The
**spawned-window path** (which the user's environment requires, because the Stop hook has no TTY and
must open a separate terminal window) has **no parity** for any continuation stage. Plus the
continuation runtime gate is fail-closed by design.

Evidence:
- Store: `pending_prompt_enhancements` id=6 has a valid 2-item sequence (`planner_items_json`
  populated), but `pending_prompt_sequences` = **0 rows**.
- Log: `popup_host_mps_first_popup {outcome:"send"}` (spawned host ran) followed by
  `stop_prompt_enhancement_injected`; **never** `stop_mps_first_popup` / `stop_mps_sequence_intake`
  (the direct_tty intake logs never executed).
- Code: the row intake (`intakePromptEnhancementSequenceOnFirstSendV1` → `upsertPendingPromptSequence`)
  and the wording batch (`startSequenceWordingBatchV1`) exist **only** in `stop.ts:614–690`
  (direct_tty). The spawned popup host (`prompt-enhancement-popup-host.ts`) and the parent spawn
  branch (`stop.ts:730–774`) call **neither**. The continuation popup runner
  (`cli-mps-continuation-run.ts`) has **no spawned-window host** — it renders only on an in-process
  TTY and returns `not_shown/no_tty` on the hook.

**Not the cause:** the planner (Hiren) and the model — they now produce valid sequences (id=6).

---

## 2. Gap map (what this plan fixes)

| ID | Gap | What breaks | Type / layer | Where |
|----|-----|-------------|--------------|-------|
| **B** | Continuation runtime gate fail-closed | 2nd popup never renders even with a perfect row | **Design/policy** — owner un-gate (NOT a bug) | `stop.ts:316` `if(gate.allowed)`; env `NEXPATH_MPS_TEST_UNGATE` |
| **A1** | Sequence row not written on spawn path | `pending_prompt_sequences` empty → launcher never runs | Wiring bug — Bhavnesh | intake only in `stop.ts:663` |
| **A2** | Wording batch (items 2…N) not started on spawn path | Even with a row, items 2…N have no text | Wiring bug — Bhavnesh | batch only in `stop.ts:623` |
| **C** | 2nd popup has no spawned-window host | Continuation can't render on a no-TTY hook | Wiring gap / unbuilt — Bhavnesh | `cli-mps-continuation-run.ts:194` → `no_tty`; called only in-process at `stop.ts:339` |
| **D** | Planner not 100% reliable live | Some prompts fall back to single-prompt | Reliability — Hiren/model | separate track |

---

## 3. Design decision to confirm (row write on spawn path)

- **Option 1 (recommended) — host self-contained:** the spawned popup host runs the wording batch +
  records the row itself, fully mirroring the `direct_tty` block. Least invasive; matches the host's
  own comment ("must do the SAME as the direct-TTY branch"). Requires a store-flush checkpoint (the
  host must persist before the parent returns its block decision).
- **Option 2 — parent writes:** the host returns `wordedItems` + an "mps-send" flag; the parent
  (which owns the store lock) does the row write. Safer for cross-process store consistency; needs a
  small host→parent result-contract change.

**Recommendation: Option 1.** Decision pending.

---

## 4. Phased plan

### Phase 1 — Spawn-path first-send parity (A1 + A2)
- **Goal:** after a spawned-window MPS "send," `pending_prompt_sequences` has a valid row with worded
  items 2…N.
- **Files:** `src/cli/commands/prompt-enhancement-popup-host.ts` — add batch-before-popup + intake +
  upsert on `mps.state==='send'`, mirroring `stop.ts:614–690`.
- **Reuses (no new logic):** `startSequenceWordingBatchV1`,
  `assemblePromptEnhancementSequenceBodyProducerInputV1`,
  `intakePromptEnhancementSequenceOnFirstSendV1`, `upsertPendingPromptSequence`.
- **Tests:** host unit test — a send writes exactly one row (`itemCount≥2`, worded items present); a
  cancel/Esc writes **no** row.
- **Exit check:** re-run the flow → the store shows a sequence row (today: 0).
- **Risk:** low–medium (store-flush ordering).

### Phase 2 — Continuation spawned-window host (C)
- **Goal:** the 2nd popup can render on a no-TTY Stop hook.
- **Files:** extend the popup-host entry to a **continuation mode** running
  `runPromptEnhancementCliMpsContinuationPopupV1` inside the spawned window; add
  `runPromptEnhancementCliMpsContinuationHostLaunchV1` analogous to the first popup's
  `runPromptEnhancementCliPopupHostLaunchV1`.
- **Reuses:** the continuation runner, `packageContinuationAtStopV1`, the first-popup host's
  IPC/serialize pattern.
- **Tests:** host renders the packaged continuation and returns a valid outcome; `no_tty` no longer
  occurs on the spawn path.
- **Risk:** medium–high (largest piece; IPC serialization of the packaged continuation input).

### Phase 3 — Launcher dual-path + deliver/persist + advance
- **Goal:** `stop.ts:339` chooses in-process (direct_tty) vs spawned host, then the outcome advances
  the row (item 2 → 3 → … → done), with the fail-closed gate preserved.
- **Files:** `src/cli/commands/stop.ts` continuation launcher (316–384): branch on host capability;
  keep `if(gate.allowed)` exactly as-is; keep release-lock / re-acquire / reload /
  `updatePendingPromptSequenceState`.
- **Tests:** integration — offered item advances on inject; stale/dead row → silent no-op; last item →
  completes; **gate closed → nothing renders** (production-safety regression).
- **Risk:** medium.

### Phase 4 — End-to-end verification (behind the test un-gate)
- **Goal:** prove the full loop on a real multi-step prompt.
- **Steps:** with `NEXPATH_MPS_TEST_UNGATE=1`: first popup → send → 2nd popup (item 2) → … →
  completion; store advances each step.
- **Deliverable:** the first genuine end-to-end MPS-2 confirmation.
- **Risk:** medium (environment/live).

---

## 5. ⚠️ Per-phase blockers & testing issues (READ THIS)

Two kinds of external blockers exist: **(H) Hiren/owner-side** and **(K) API-key / keyring testing**.

| Phase | Hiren/owner block? | API-key / keyring testing issue? | Can I build + UNIT-test now? |
|-------|--------------------|----------------------------------|------------------------------|
| **1 — row + batch** | **No** (Bhavnesh's wiring) | Unit tests: **No key needed** (stub the body-producer, as the direct_tty tests already do). Verifying **real worded** items 2…N: **needs the key** (live LLM wording call). | ✅ Yes |
| **2 — continuation window host** | **No** | Unit tests: **No key needed** (mock the interaction/host). Seeing the **actual window render**: needs the gate override + a stored worded row (from Phase 1). | ✅ Yes |
| **3 — launcher + advance** | **Production activation is blocked by the owner un-gate (B)** — the launcher only renders live when `gate.allowed`. Code/tests use the env override, so the CODE is not blocked. | Unit/integration with env override + stubs: **No key needed**. | ✅ Yes (code); production stays OFF until owner un-gates |
| **4 — E2E** | **Production E2E blocked by the owner un-gate (B)**. Local E2E works with `NEXPATH_MPS_TEST_UNGATE=1`. | **YES — this is the phase the key blocks.** Live E2E needs the **OpenAI key reachable AND the keyring unlocked** (live planner + live wording). Cannot be done without it. Also affected by **Gap D** (need a prompt that reliably decomposes). | ⚠️ Only with key + gate override |

### Plain-language summary
- **Hiren/owner-side block:** exactly **one** thing — the **production un-gate (Blocker B)**. It does
  NOT block me from building or unit-testing Phases 1–3. It only blocks the **visible production
  behavior** of Phases 3–4. Shipping the gate open is owner authority (acceptance-oracle sign-off).
- **API-key / keyring testing issue:** hits **Phase 1** (only for verifying *real* worded items) and
  **especially Phase 4** (live end-to-end cannot run without the key + an unlocked keyring). Phases
  1–3 **unit** tests do **not** need the key (they stub the LLM, exactly like the existing tests).
- **Planner reliability (Gap D):** a softer Phase-4 testing issue — some prompts won't decompose, so
  the E2E test should use a prompt that reliably produces a sequence.

### So the ONLY hard external stops are:
1. **Phase 4 live E2E** needs the **key + unlocked keyring** (currently locked in background jobs).
2. **Production** (not local testing) of Phases 3–4 needs the **owner un-gate (B)**.
Everything else — all code for Phases 1–3 and all their unit tests — I can build and verify now
without Hiren and without the key.

---

## 6. Safety invariants (held at every commit)
- Fail-closed gate **never** shipped open (test-only env override).
- `direct_tty` path and the working **Linux popup** behavior untouched.
- Hiren's planner layer untouched (A/C are host wiring).
- Additive; every new render path fail-closed on any gate/host miss.

## 7. Sequencing
Phase 1 → 2 → 3 → 4. Phases 1 and 3 carry production-safety regression tests; the gate stays closed at
every commit. Phase 4 is the only phase that requires the live key + the owner's local test un-gate.
