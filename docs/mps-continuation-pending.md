# MPS Continuation (2nd popup) — PENDING status (2026-08-17)

> One-page record of where MPS-2 stands, what is done + verified, and what is BLOCKED. Kept pending.

## ✅ DONE + verified (code + unit)
- **Continuation Phases 1–3** — spawn-path row intake (P1), spawned-window continuation host (P2, Option D,
  all platforms), dual-path wiring in `stop.ts` (P3). Code complete, unit-tested, fail-closed preserved.
- **Planner reliability fix**
  - Phase 1b — clamp out-of-bounds `originalSliceRef` / `sourcePointRanges` into `[0, len]` (§5.5a),
    `sequence-planner.ts`.
  - Phase 1c — confirmation-matches-complexity + complexity-reason self-checks (§5.5b),
    `sequence-planner-prompt.ts`.
- **Proven LIVE this turn:** the planner now GENERATES a real sequence (`planner OK · items=6`) — it
  produced 0 items on every run before. The offset clamp + self-checks work.
- tsc clean · `sequence-planner.test.ts` 75/75 · **full hermetic suite 8143 pass / 1 todo, 0 regressions.**

## 🔴 BLOCKED / PENDING
1. **E2E testing — BLOCKED on OpenAI credits.** The account is OUT OF CREDITS:
   `429 · credit_balance_exhausted · insufficient_quota` ("no credits remaining"). Live testing this turn
   exhausted them. ➜ **Add credits at platform.openai.com billing**, then run the data-path E2E.
2. **Command dependency `NEXPATH_MPS_TEST_UNGATE=1` — STILL REQUIRED (not removed).** Removing it = the
   production **un-gate** = the owner's acceptance-oracle sign-off. Deliberately NOT done: (a) it's the
   owner's call, (b) premature — the feature is not reliable yet, so un-gating now would ship a
   broken-on-some-turns MPS-2 to all users.
3. **Reliability gap — Hiren's domain.** Two intermittent LLM stages (planner → body producer). Retries are
   locked (Hiren ruled §6.2c/§6.3h + a 4th sequential call exceeds the hook's lifetime → process killed).
   Body-producer's 17 failure reasons are all CONTENT (wording/confirmation/safety) — not offset-clampable.
   Full reliability needs Hiren: longer time budget + more retries, a simpler contract, or a stronger model.
4. **Planner-offset fix — COMMITTED phase-wise (2026-08-17):**
   - Phase 1 (offset clamp): `b92f234` — `sequence-planner.ts` + test. Tests 75/75 + suite 1530 pass.
   - Phase 2 (prompt self-checks: confirmation/complexity + multi-step nudge): `bd21e0a`
     — `sequence-planner-prompt.ts`. Suite 1530 pass, tsc clean.
   - Phase 3 (live verification): **BLOCKED on credits** (429) — deferred until credits are added.
5. **Continuation Phases 1–3 + docs + script — still UNCOMMITTED** (separate feature):
   `stop.ts`, `prompt-enhancement-popup-host.ts`(+test), `prompt-enhancement-host.ts`(+test),
   `cli-mps-continuation-run.ts`, `docs/mps-continuation-*.md`, `scripts/mps-sequence-llm-verify.mjs`.

## ▶ NEXT STEPS (when credits are back)
1. Run `scripts/mps-sequence-llm-verify.mjs` several times → measure planner+body-producer success rate,
   capture body-producer failure reasons.
2. If those failures are self-check-addressable, add the minimal body-producer self-checks (Hiren-permitted).
3. Interactive 2nd-popup E2E — owner runs it with `NEXPATH_MPS_TEST_UNGATE=1` in the launch shell.
4. Commit everything.

## Owner / Hiren actions (outside my authority)
- **Owner un-gate** — flip the runtime gate to open (acceptance-oracle sign-off) so real users get MPS-2
  with NO command. Only after reliability is solid.
- **Hiren reliability hardening** — retries/time-budget/contract for the planner + body producer.

## Notes
- `.env` (gitignored) holds the key; delete after the E2E. No credits are spent by leaving it there.
- Diagnostic: `scripts/mps-sequence-llm-verify.mjs` — STAGE 0 direct planner probe shows the exact failure
  reason; STAGE 2 shows the body-producer reason.
