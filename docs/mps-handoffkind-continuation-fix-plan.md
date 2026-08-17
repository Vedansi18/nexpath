# MPS-2 `handoff_not_continuable` — Fix Plan (2026-08-17)

> After the empty-`items_json` fix, the second popup still did not render. This is the NEXT layer's
> bug, found from the live debug log, with a proper root-cause fix + regression guard.

## 1. Symptom
- MPS-1 (first popup) renders and the user sends. The sequence row is recorded WITH items.
- At the continuation Stop, nothing renders. Debug log:
  ```
  stop_mps_spawn_sequence_intake  {state:"sequence_recorded", itemCount:7}   ← row + items OK
  stop_mps_continuation_gate      {allowed:true, missingGateCodeCount:0}     ← gate OPEN
  stop_mps_continuation_package_skip {reason:"handoff_not_continuable"}      ← BLOCKED
  ```

## 2. Root cause (evidence, not guess)
- The continuation **packager** (`continuation-stop-package.ts:77`) fails closed when the row's
  `handoffKind` is not a continuable kind:
  `CONTINUATION_HANDOFF_KINDS_V1 = ['first_prompt_handoff_candidate', 'compact_sequence_summary_candidate']`.
- Store proof: the recorded row had **`handoff_kind = null`** (items + redacted original were both present).
- The **intake** (`sequence-intake.ts`) read the handoff kind from the WRONG object:
  - Line 74 correctly binds `const handoff = input.result.uiView.handoffAndSequenceSummary` (the populated
    handoff, whose `.handoffKind` the facade sets to `'compact_sequence_summary_candidate'`, facade.ts:590).
  - Line 128 then read `input.result.handoffMetadata?.handoffKind` — a **top-level field that is never
    populated** → `undefined ?? null` → `null` stored on every row.

## 3. Why the compiler did not catch it (the trap)
`PromptEnhancementPrepareResultV1` carries TWO handoff-related fields:
- `uiView.handoffAndSequenceSummary?` — POPULATED by the facade.
- `handoffMetadata?` (top-level) — an OPTIONAL, legacy field that nothing populates.

Both are valid optional accesses, so reading the never-populated one is type-correct and silently yields
`undefined`. A phantom-optional-field trap: the type permits the wrong path.

## 4. The fix (applied)
`sequence-intake.ts` — read the kind from the SAME handoff object already validated above, not the phantom
top-level field:
```ts
// before: input.result.handoffMetadata?.handoffKind ?? null   (always null)
// after:  handoff.handoffKind ?? null                          (the populated, validated handoff)
```
`handoff` is guaranteed non-null (line 75 returns `handoff_missing` otherwise), so the access is safe. This
is the minimal correct fix — one field path — and it fixes BOTH intake call sites (spawn + direct_tty),
because both go through this one function.

## 5. Completeness / scope check
- **Only instance:** the only wrong read of the phantom `result.handoffMetadata` was this line. Every other
  `.handoffMetadata` in the codebase reads a DIFFERENT, populated object (`packaged.handoffMetadata`,
  `input.continuation.handoffMetadata`) — not this bug.
- Stale rows with `handoff_kind = null` (written before the fix) were cleared from the store.

## 6. Testing (standard)
- **Regression test** (`sequence-intake.test.ts`): asserts `intake.handoffKind` equals the handoff object's
  own kind AND is not null — the exact assertion that was missing (the prior test passed while storing null,
  because it never checked the value). Fails on the old code, passes on the fixed code.
- **Packager success is already proven** (`continuation-stop-package.test.ts:44-63`): a continuable kind →
  `ok:true` and it advances; a null/non-continuable kind → `handoff_not_continuable`. So restoring a
  continuable kind is sufficient to unblock the packager.
- **Full hermetic suite: 8153 pass / 0 regressions.**

## 7. Standard hardening (recommended follow-up, NOT applied here)
The top-level `handoffMetadata?` on `PromptEnhancementPrepareResultV1` is a trap: optional, never populated,
and it invites exactly this bug. Options:
- **(Recommended, deferred)** Remove the unused top-level field in a separate, reviewed contract change, so no
  future reader can bind to it. Deferred because it is a versioned-contract edit with its own validation/
  schema surface — out of scope for a behavior fix, and the regression test already guards the behavior.
- **(Applied)** Correct read + regression test + this doc. Behavior is guaranteed; the trap is documented.

## 8. Risk
- Minimal: one field path, non-null-guaranteed access, additive test. No control-flow change; the fix only
  changes which (already-present) value is stored.

## 9. Status + remaining layer
- **Layers 1-6 now verified** (planner items, body wording, row+items, **handoffKind**, gate, packager).
- **Remaining: layer 7 — the continuation window SPAWN** (Option-D dual-path, identical to the first popup).
  Exercised on the next live E2E; the log will show `stop_mps_continuation_shown {outcome}` on success.
