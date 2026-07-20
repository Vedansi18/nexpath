/**
 * Verification-quality content-template records (class 2) — BATCH A: the 11
 * signals with a formal headline. Column 3 is the existing shipped headline kept
 * verbatim; columns 1/2/4/5 escalate the same practice — verification signals
 * (spot-check → light pass → standard review → thorough audit → review file +
 * pre-merge checks) and maintainability signals (note → note + commit → standard
 * → reviewed write-up → maintained doc file). Keyword-retained, plain-language,
 * voice-clean; the heaviest column yields a file. These are corrective signals.
 *
 * Spine: the verification records thread the review + commit cadence; the
 * maintainability records thread commit-intent. Register vocabulary is adapted at
 * runtime; the structurally-divergent beginner overrides are a separate follow-up.
 *
 * BATCH B (10 casual-only signals) is authored below.
 */

import type { ContentTemplateRecord, LevelForm, ParamAxisTag } from '../content-template-schema.js';
import {
  TEST_CREATION_BEGINNER_OVERRIDE, REGRESSION_CHECK_BEGINNER_OVERRIDE, BEHAVIOUR_TESTING_BEGINNER_OVERRIDE,
  SECURITY_CHECK_BEGINNER_OVERRIDE, ERROR_HANDLING_BEGINNER_OVERRIDE, DOCUMENTATION_BEGINNER_OVERRIDE,
  REFACTORING_BEGINNER_OVERRIDE, CORRECTION_SEEKING_BEGINNER_OVERRIDE, PROBLEM_CORRECTION_BEGINNER_OVERRIDE,
  ACCESSIBILITY_BEGINNER_OVERRIDE, DATA_VALIDATION_BEGINNER_OVERRIDE,
} from './class2-records-beginner.js';

function form(option: string, whyDesc: string): LevelForm {
  return { kind: 'slot-variant', cell: { option, whyDesc } };
}

/** The param axes a verification why-desc grounds (same generic sources as class 1). */
export const VERIFICATION_PARAM_AXES: Readonly<Record<string, ParamAxisTag>> = {
  workflow_pattern: 'extensible',
  decision_making_rhythm: 'closed-ordinal',
  explanation_learning_depth: 'closed-ordinal',
  abstraction_level_orientation: 'closed-ordinal',
  project_framework: 'open',
};

export const A3_SPINE = ['review-cadence', 'commit-cadence'];
export const A6_SPINE = ['commit-intent'];

/** BEHAVIOUR_TESTING — verification family, keyword "test". */
export const BEHAVIOUR_TESTING_RECORD: ContentTemplateRecord = {
  signalType: 'BEHAVIOUR_TESTING',
  registerOverrides: { beginner: BEHAVIOUR_TESTING_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Manually test the one main user journey before moving on.', "Just one manual run of the main user journey — automated tests miss the user-facing path, so walk it once before moving on."),
    2: form('Test the happy path as a real user would, step by step, and note what confirms it works.', "Walk the happy path as a real user would, step by step, and note what confirms it works — a scenario test, not just a code check."),
    3: form('Write a manual test scenario for the main user journey: list each step a real user would take, what they would see, and what would confirm it is working correctly.', "Lay out each step of the main user journey — what a real user does, what they see, and what confirms it's working — since automated tests miss these user-facing scenarios."),
    4: form('Write the acceptance test scenarios for this feature — 3 to 5 user journeys from happy path to edge cases, each with the steps and the expected outcome.', "Cover 3 to 5 user journeys as acceptance tests — happy path through edge cases — each with its steps and expected outcome, past just the main journey."),
    5: form('Write a manual test plan file: the user-journey scenarios (happy path, boundaries, error states), expected outcome per step, and the cases automated tests miss — kept with the feature.', "Capture a manual test plan file — the user-journey scenarios (happy path, boundaries, error states), the expected outcome per step, and the cases automated tests miss — kept with the feature."),
  },
};

/** ABSENCE_TEST_CREATION — verification family, keyword "test". */
export const ABSENCE_TEST_CREATION_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_TEST_CREATION',
  registerOverrides: { beginner: TEST_CREATION_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Write one test for the most important behaviour in what was just built.', "Just one test on the most important behaviour of what was just built — the single highest-value check, not full coverage yet."),
    2: form('Write a test for the most critical path through what was just built, then commit it.', "Cover the most critical path through what was just built with a test, then commit it — the first safety net under the code."),
    3: form('Write tests for what was just built: unit tests for each function added or modified, and at least one integration test that covers the main path through this feature.', "Add unit tests for each function changed and at least one integration test on the main path — otherwise a later change to this code could silently regress it."),
    4: form('Write tests for what was just built covering each function and the main integration path, run the full suite, and commit them as a rollback checkpoint.', "Cover each function and the main integration path with tests, run the full suite, and commit them as a rollback checkpoint."),
    5: form('Write a test file for what was just built with unit + integration coverage of the riskiest paths, add a check of dependencies for known issues, and make the tests run before merging.', "Capture a test file with unit and integration coverage of the riskiest paths, add a dependency check for known issues, and make the tests run before merging."),
  },
};

/** ABSENCE_REGRESSION_CHECK — verification family, keyword "regression". */
export const ABSENCE_REGRESSION_CHECK_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_REGRESSION_CHECK',
  registerOverrides: { beginner: REGRESSION_CHECK_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Run the existing tests and report any regression — anything passing before that now fails.', "Just surface any regression from the existing tests — anything that passed before this and now fails."),
    2: form('Run the test suite, flag any regression touching the code changed this session, and commit the verified state.', "Check for regression by running the suite, flag anything on the code changed this session, and commit the verified state — a checked baseline to build on."),
    3: form('Identify which existing tests cover the code paths changed in what was just built, run them, and flag any regressions — anything that was passing before this session that is now failing.', "Find which existing tests cover the changed paths, run them, and flag any regression — anything that was passing before this session and is now failing."),
    4: form('Map the existing functionality the changes could affect, run the full suite for regression, and commit an atomic rollback checkpoint.', "Trace the existing functionality the changes could touch, run the full suite for regression, and commit an atomic rollback checkpoint."),
    5: form('Write a regression-check note: the changed paths, the existing tests covering them, the at-risk functionality, and the results — and make the suite run before merging to catch future regressions.', "Capture a regression-check note — the changed paths, the tests covering them, the at-risk functionality, and the results — and make the suite run before merging to catch future regressions."),
  },
};

/** ABSENCE_SECURITY_CHECK — verification family (security), keyword "security". */
export const ABSENCE_SECURITY_CHECK_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_SECURITY_CHECK',
  registerOverrides: { beginner: SECURITY_CHECK_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Check what was just built for the one most obvious security issue — unvalidated input or a missing access check.', "Just the one most obvious security issue in what was just built — an unvalidated input or a missing access check — spotted before moving on."),
    2: form('Do a light security pass on the main path: input validation and access checks on what was just built.', "Run a quick security pass on the main path — input validation and access checks on what was just built."),
    3: form('Review what was just built for security vulnerabilities: check authentication and authorization logic, input validation for injection risks (SQL, XSS, command), and any API endpoints for missing rate limiting, improper error responses, or exposed sensitive data.', "Go through authentication and authorization, input validation for injection risks (SQL, XSS, command), and API endpoints for rate limiting, error responses, and exposed data — the new attack surface is otherwise unaudited."),
    4: form('Audit the security of what was just built thoroughly: authentication and authorization, injection risks, rate limiting, error-response leakage, and the highest-severity exploit path — like a pre-merge security review.', "Take the security audit deep — authentication and authorization, injection risks, rate limiting, error-response leakage, and the highest-severity exploit path — like a pre-merge review."),
    5: form('Write a security review note: the audited surface, findings ranked by severity, a check of dependencies for known issues, and the fixes — and make these security checks part of the pre-merge gate.', "Capture a security review note — the audited surface, findings ranked by severity, a dependency check for known issues, and the fixes — and make these security checks part of the pre-merge gate."),
  },
};

/** ABSENCE_ERROR_HANDLING — verification family, keyword "error". */
export const ABSENCE_ERROR_HANDLING_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_ERROR_HANDLING',
  registerOverrides: { beginner: ERROR_HANDLING_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Check what happens in what was just built when the most likely error occurs — a failed call or invalid input.', "Just what happens on the most likely error in what was just built — a failed call or invalid input — checked before moving on."),
    2: form('Review the main error paths in what was just built and confirm failures are handled, not silently swallowed.', "Trace the main error paths in what was just built and confirm failures are handled, not silently swallowed."),
    3: form('Review what was just built for error handling gaps: identify all failure modes (network errors, invalid input, missing dependencies, unexpected state), confirm each is handled explicitly, and flag any that are silently swallowed or produce unhelpful error messages.', "Enumerate the failure modes (network errors, invalid input, missing dependencies, unexpected state), confirm each is handled explicitly, and flag any swallowed silently or giving unhelpful error messages."),
    4: form('Audit every failure path in what was just built — per dependency, input, and assumption: is the error propagated, logged, or recovered correctly, and are messages safe to expose?', "Walk every failure path — per dependency, input, and assumption — checking whether the error is propagated, logged, or recovered correctly, and whether messages are safe to expose."),
    5: form('Write an error-handling note: the failure modes, the handling per mode (propagate / log / recover), the error contract, and tests for the critical paths — kept with the feature.', "Capture an error-handling note — the failure modes, the handling per mode (propagate / log / recover), the error contract, and tests for the critical paths — kept with the feature."),
  },
};

/** ABSENCE_DOCUMENTATION — maintainability family, keyword "document". */
export const ABSENCE_DOCUMENTATION_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_DOCUMENTATION',
  registerOverrides: { beginner: DOCUMENTATION_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A6_SPINE,
  levelForms: {
    1: form('Add a one-line note documenting the WHY behind the least-obvious part of what was just built.', "Just one line documenting the WHY behind the least-obvious part of what was just built — the reason, not the what."),
    2: form('Document the non-obvious decisions in what was just built with short inline comments explaining the why.', "Record the non-obvious decisions with short inline comments that document the why — the reasoning behind each, not a restatement of the code."),
    3: form('Review what was just built for documentation coverage: identify functions, classes, and modules with non-obvious behaviour that lack docstrings or inline comments, and add documentation that explains the why — the constraint, the invariant, the tradeoff — not just the what.', "Find the functions, classes, and modules with non-obvious behaviour that lack docstrings or inline comments, and document the why — the constraint, the invariant, the tradeoff — not just the what."),
    4: form('Document what was just built thoroughly: docstrings for non-obvious components plus the embedded assumptions, invariants, and constraints a future maintainer could not infer from the code.', "Go past docstrings — capture the embedded assumptions, invariants, and constraints a future maintainer could not infer from the code, documented alongside the non-obvious components."),
    5: form('Update the documentation files for what was just built: README / API reference / architecture notes plus the inline docs, so a new reader understands the feature without asking the author.', "Bring the documentation files up to date — README / API reference / architecture notes plus the inline docs — so a new reader understands the feature without asking the author."),
  },
};

/** ABSENCE_REFACTORING — maintainability family, keyword "refactor". */
export const ABSENCE_REFACTORING_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_REFACTORING',
  registerOverrides: { beginner: REFACTORING_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A6_SPINE,
  levelForms: {
    1: form('Name the one thing in what was just built most worth refactoring before moving on.', "Just the single highest-value thing worth refactoring in what was just built — named before moving on."),
    2: form('Review what was just built for duplication or inconsistency to refactor before the next task.', "Scan what was just built for duplication or inconsistency worth refactoring before the next task."),
    3: form('Review what was just built for refactoring opportunities: identify code duplication, functions that do more than one thing, abstractions that have grown inconsistent with their usage, and naming that no longer reflects current behaviour — prioritize by maintenance risk.', "Find the duplication, functions doing more than one thing, abstractions grown inconsistent with their usage, and naming that no longer reflects behaviour — prioritized by maintenance risk."),
    4: form('Audit what was just built for code health and refactor the highest-risk items: emergent patterns to abstract, dead code to remove, modules grown beyond their responsibility, and convention drift.', "Refactor the highest-risk items — emergent patterns to abstract, dead code to remove, overgrown modules to split, and convention drift — past just spotting them."),
    5: form('Write a refactoring note: the prioritized opportunities, the convention and technical-debt findings, and the cleanups done — kept so the next feature is not harder to add.', "Capture a refactoring note — the prioritized opportunities, the convention and technical-debt findings, and the cleanups done — kept so the next feature isn't harder to add."),
  },
};

/** ABSENCE_CORRECTION_SEEKING — verification family (self-review), keyword "review". */
export const ABSENCE_CORRECTION_SEEKING_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_CORRECTION_SEEKING',
  registerOverrides: { beginner: CORRECTION_SEEKING_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Review the one part of what was just built you are least confident is correct.', "Just the one part of what was just built you're least confident is correct — put it under review before moving on."),
    2: form('Review what was just built as a skeptical senior engineer would — name the weakest parts.', "Look at what was just built as a skeptical senior engineer would and name the weakest parts — a critical review, not a friendly pass."),
    3: form('Self-review what was just built: identify any assumptions that may be incorrect, logic that could fail under edge cases, and any parts of the implementation you are not confident about.', "Surface any assumptions that may be wrong, logic that could fail under edge cases, and the parts of the implementation you're not confident about — a genuine self-review, not a rubber stamp."),
    4: form('Review what was just built adversarially: argue against the implementation — what a skeptical senior would flag, the alternatives not considered, and the weakest parts.', "Argue against the implementation in review — what a skeptical senior would flag, the alternatives not considered, and the weakest parts."),
    5: form('Write a failure-analysis note from your review: the most likely production failure modes, the inputs that cause incorrect behaviour, and what you would change rebuilding from scratch.', "Capture a failure-analysis note from the review — the most likely production failure modes, the inputs that cause incorrect behaviour, and what you'd change rebuilding from scratch."),
  },
};

/** ABSENCE_PROBLEM_CORRECTION — verification family (fix), keyword "fix". */
export const ABSENCE_PROBLEM_CORRECTION_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_PROBLEM_CORRECTION',
  registerOverrides: { beginner: PROBLEM_CORRECTION_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Confirm the bug noticed this session was actually fixed, not just acknowledged.', "Just make sure the bug noticed this session was actually fixed, not merely acknowledged."),
    2: form('Go through the issues raised this session and confirm each was fixed or explicitly deferred with a note.', "Take the issues raised this session and confirm each was fixed or explicitly deferred with a note — none left implicit."),
    3: form('Review the outstanding bugs and issues identified in this session: for each one, confirm whether it has been explicitly fixed, explicitly deferred with a tracking note, or left unaddressed. Address any that are unresolved and blocking correctness of what was just built.', "For each outstanding bug or issue, confirm whether it's explicitly fixed, deferred with a tracking note, or left unaddressed — and resolve any unresolved one blocking correctness of what was just built."),
    4: form('Audit every issue raised this session: fixed (with the fix verified), deferred-with-a-note, or unaddressed — and fix the unresolved blocking ones, confirming each fix.', "Sort every issue raised this session — fixed (with the fix verified), deferred-with-a-note, or unaddressed — and fix the unresolved blocking ones, confirming each fix."),
    5: form('Write an issue-resolution note: each bug, its status (fixed / deferred / open), the fix and how it was verified, and a test guarding the ones most likely to recur.', "Capture an issue-resolution note — each bug, its status (fixed / deferred / open), the fix and how it was verified, and a test guarding the ones most likely to recur."),
  },
};

/** ABSENCE_ACCESSIBILITY — verification family (accessibility), keyword "accessible". */
export const ABSENCE_ACCESSIBILITY_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_ACCESSIBILITY',
  registerOverrides: { beginner: ACCESSIBILITY_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Check the most significant way what was just built is not accessible to a user with a disability.', "Just the single biggest way what was just built isn't accessible to a user with a disability — spotted before moving on."),
    2: form('Confirm a keyboard-only user can complete the main workflow and every control is accessible (a name a screen reader announces).', "Make sure a keyboard-only user can finish the main workflow and every control is accessible — a name a screen reader announces."),
    3: form('Audit the ARIA labelling and semantic structure of what was just built: identify every interactive element and confirm it has an accessible name — via native semantics, aria-label, or aria-labelledby — and that its role is correctly communicated to assistive technologies.', "Go through every interactive element and confirm it has an accessible name — via native semantics, aria-label, or aria-labelledby — and that its role reaches assistive technologies correctly."),
    4: form('Audit thoroughly whether what was just built is accessible: accessible names and roles, keyboard navigation and focus order, and visual access (contrast, focus visibility, no colour-only signalling).', "Judge thoroughly whether what was just built is accessible — accessible names and roles, keyboard navigation and focus order, and visual access (contrast, focus visibility, no colour-only signalling)."),
    5: form('Write an accessible-experience review note: the audited elements, the keyboard and visual findings against WCAG AA, and the fixes — kept so what you build stays accessible on every change.', "Capture an accessible-experience review note — the audited elements, the keyboard and visual findings against WCAG AA, and the fixes — kept so what you build stays accessible on every change."),
  },
};

/** ABSENCE_DATA_VALIDATION — verification family (input validation), keyword "validation". */
export const ABSENCE_DATA_VALIDATION_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_DATA_VALIDATION',
  registerOverrides: { beginner: DATA_VALIDATION_BEGINNER_OVERRIDE },
  source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Add validation for the most important untrusted input in what was just built.', "Just validation on the single most important untrusted input in what was just built — the highest-risk one first."),
    2: form('Add validation on the main input path of what was just built — required fields and basic type checks.', "Put validation on the main input path of what was just built — required fields and basic type checks."),
    3: form('Define the input schema for what was just built: for every endpoint or form, document the expected shape — required fields, optional fields, data types, and any constraints (min/max, allowed values) — and implement schema validation using a library such as Zod, Yup, or Joi.', "For every endpoint or form, set the expected shape — required and optional fields, data types, and constraints (min/max, allowed values) — and implement schema validation with a library such as Zod, Yup, or Joi."),
    4: form('Implement thorough input validation: schemas for every endpoint and form with constraints, rejection of malformed input, and safe error messages on validation failure.', "Take input validation to full coverage — schemas for every endpoint and form with constraints, rejection of malformed input, and safe error messages on validation failure."),
    5: form('Write a validation note plus the schema definitions: the validation rules per input, the rejection behaviour, and tests covering the boundary and malformed cases — kept with the feature.', "Capture a validation note plus the schema definitions — the validation rules per input, the rejection behaviour, and tests covering the boundary and malformed cases — kept with the feature."),
  },
};

/** Class-2 BATCH A — the 11 formal-base verification-quality records. */
export const CLASS2_RECORDS_BATCH_A: readonly ContentTemplateRecord[] = [
  BEHAVIOUR_TESTING_RECORD,
  ABSENCE_TEST_CREATION_RECORD,
  ABSENCE_REGRESSION_CHECK_RECORD,
  ABSENCE_SECURITY_CHECK_RECORD,
  ABSENCE_ERROR_HANDLING_RECORD,
  ABSENCE_DOCUMENTATION_RECORD,
  ABSENCE_REFACTORING_RECORD,
  ABSENCE_CORRECTION_SEEKING_RECORD,
  ABSENCE_PROBLEM_CORRECTION_RECORD,
  ABSENCE_ACCESSIBILITY_RECORD,
  ABSENCE_DATA_VALIDATION_RECORD,
];

// ── BATCH B — the 10 casual-/beginner-only signalTypes ─────────────────────────
// These have no formal-base set, so col-3 is anchored on the frozen casual/beginner
// L1[0] (often a principle-cited, longer line — so the length budget exempts col-3).

/** ABSENCE_CODE_DOCUMENTATION_GAP — maintainability family, keyword "comment". */
export const ABSENCE_CODE_DOCUMENTATION_GAP_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_CODE_DOCUMENTATION_GAP', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A6_SPINE,
  levelForms: {
    1: form('Add a one-line comment on the least-obvious thing just written — the WHY, not the what.', 'One WHY-comment on the least-obvious code is the lightest documentation step.'),
    2: form('Add WHY-comments on the non-obvious logic just written — the reasoning or edge case each handles.', 'A light pass: WHY-comments capturing the reasoning on the non-obvious logic.'),
    3: form("Clean Code principle: 'Don't use comments to explain WHAT the code is doing — use them to explain WHY you did it.' For the non-obvious logic just added — add a comment explaining the reasoning, constraint, or edge case it handles. Future maintainers (including you) will need this context.", "The WHY behind non-obvious code just written hasn't been captured in comments."),
    4: form('Comment the non-obvious logic thoroughly: a WHY-comment per block (reasoning, constraint, edge case) plus docstrings on the public functions.', 'Beyond inline notes: a WHY-comment per non-obvious block plus docstrings on the public surface.'),
    5: form('Write the doc comments into the code: a WHY-comment on every non-obvious block and a docstring (params, returns, edge behaviour) on each public function — kept with the code.', 'The doc comments and docstrings written into the code so the WHY survives in the file.'),
  },
};

/** ABSENCE_TECHNICAL_DEBT_ACKNOWLEDGMENT — maintainability family, keyword "debt". */
export const ABSENCE_TECHNICAL_DEBT_ACKNOWLEDGMENT_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_TECHNICAL_DEBT_ACKNOWLEDGMENT', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A6_SPINE,
  levelForms: {
    1: form('Tag the shortcut just taken with a TODO so the debt is visible.', 'One TODO on the shortcut is the lightest way to make the debt visible.'),
    2: form('Tag the shortcut as debt: a TODO/FIXME naming what to fix and why it was deferred.', 'A light pass: the shortcut tagged as debt with what-to-fix and why-deferred.'),
    3: form("Martin Fowler's Technical Debt Quadrant: 'Prudent Deliberate' debt — acknowledged and added to the backlog — is acceptable. 'Reckless Deliberate' — shortcuts taken without acknowledgment — compounds invisibly. Tag any shortcut with a TODO or FIXME comment before moving on.", "The just-taken shortcut hasn't been tagged as debt — invisible accumulation risk."),
    4: form('Acknowledge the debt properly: a TODO/FIXME per shortcut (what to fix, why deferred, the risk) and a backlog item so it is tracked, not lost.', 'Beyond a bare tag: each debt item described and tracked on the backlog, not just marked.'),
    5: form('Write a tech-debt note: each shortcut taken, what it defers, the risk, and the fix plan — tracked as backlog items so the debt stays prudent, not reckless.', 'A durable tech-debt note tracking each shortcut, its risk, and the fix plan.'),
  },
};

/** ABSENCE_TEST_DEPTH_CHECK — verification family, keyword "test". */
export const ABSENCE_TEST_DEPTH_CHECK_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_TEST_DEPTH_CHECK', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Add one test beyond the happy path — an edge case or an error case.', 'One non-happy-path test is the lightest depth check beyond what exists.'),
    2: form('Add an edge-case test and an error-path test for what was just built.', 'A light depth pass: one edge-case and one error-path test added.'),
    3: form("Testing pyramid (Mike Cohn, 2009): tests must cover happy paths, edge cases, and negative scenarios. 'Start with happy path tests, then add error cases that verify graceful failure handling.' Happy-path-only tests provide false confidence — everything looks green but real-world conditions break the code.", "Test coverage beyond happy-path (edge cases + negative scenarios) hasn't been added."),
    4: form('Add tests across the depth categories: boundary values (empty, null, max, min), error paths, and negative cases (invalid input, unexpected state) — at least one each.', 'Beyond a couple cases: a test per depth category — boundary, error, negative.'),
    5: form('Write the depth tests into the test file: boundary, error-path, and negative cases per decision branch, so coverage is real and the cases run before merging.', 'A durable test file covering boundary, error, and negative branches — real depth, not happy-path-only.'),
  },
};

/** ABSENCE_SECURITY_REVIEW_GAP — verification family, keyword "security". */
export const ABSENCE_SECURITY_REVIEW_GAP_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_SECURITY_REVIEW_GAP', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Do a quick security check on the surface just touched — is the input validated?', 'A quick security spot-check is the lightest pass: the most obvious unvalidated input.'),
    2: form('Do a light security pass on what was just touched: input validation and access checks.', 'A light security pass: input validation plus access checks on the touched surface.'),
    3: form("OWASP Secure by Design: security must be designed in, not bolted on. For what was just implemented — what security surfaces were introduced? Input validation (are all inputs sanitized?), authorization (is access properly gated?), injection prevention (SQL, command, path traversal). These checks belong during implementation, not as a post-implementation audit. Shift-left: add the check when the surface is created.", "Security review (input validation / authorization / injection prevention) of the just-touched surfaces hasn't been done."),
    4: form('Audit the security of the touched surfaces thoroughly: input validation, authorization gating, and injection safety (SQL, command, path) per surface, ranked by severity.', 'Beyond a spot-check: a per-surface, severity-ranked security audit of what was touched.'),
    5: form('Write a security review note: the surfaces, the findings by severity, a dependency check, and the fixes — and make these security checks part of the pre-merge gate.', 'A durable security review note with severity-ranked findings and pre-merge gating.'),
  },
};

/** ABSENCE_ERROR_HANDLING_COVERAGE — verification family, keyword "error". */
export const ABSENCE_ERROR_HANDLING_COVERAGE_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_ERROR_HANDLING_COVERAGE', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Handle the most likely error in what was just built — a failed call or bad input.', 'Handling the single most-likely error is the lightest coverage step.'),
    2: form('Add explicit error handling for the main failure cases in what was just built.', 'A light pass: the main error cases handled rather than left to break.'),
    3: form("McConnell's defensive programming (Code Complete): 'Defensive programming mandates covering all failure paths, not just happy paths.' For what was just implemented — what are the error states? What happens when an external call fails? What happens when input is malformed? What happens when a database write fails? Each needs explicit handling: error state, fallback behavior, user-facing message. Code that only works on the happy path is incomplete by construction standards.", "Error-path coverage (external failures / malformed input / DB / edge states) for what was just built hasn't been verified."),
    4: form('Cover the error paths by category: external failures, input validation failures, and edge states — each with explicit handling, a fallback, and a safe message.', 'Beyond the main cases: every error category handled with a fallback and a safe message.'),
    5: form('Write an error-coverage note plus the handling: the failure modes per category, the fallback behaviour, and tests for the critical error paths — kept with the feature.', 'A durable error-coverage note of failure modes, fallbacks, and the critical-path tests.'),
  },
};

/** ABSENCE_REFACTORING_CHECKPOINT — maintainability family, keyword "refactor". */
export const ABSENCE_REFACTORING_CHECKPOINT_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_REFACTORING_CHECKPOINT', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A6_SPINE,
  levelForms: {
    1: form('Before extending the messy code, do one quick refactor — extract or rename the worst part.', 'One small refactor before extending is the lightest checkpoint against compounding mess.'),
    2: form('Do a refactor pass on the messy code before adding to it: extract repeated logic and rename the confusing parts.', 'A light refactor checkpoint: extract and rename before the feature lands on the mess.'),
    3: form("Boy Scout Rule (Clean Code): 'Leave the code cleaner than you found it.' Before adding a feature to code that was already acknowledged as messy or complex — do a refactoring pass first. The alternative is adding features on top of complexity, which makes the next change harder, not the same difficulty. The refactoring pass before extending is the investment that prevents compound complexity debt.", "A pre-extension refactor pass on the existing messy code hasn't been done."),
    4: form('Refactor thoroughly before extending: extract repeated logic into named helpers, simplify the nested conditionals, and rename anything that needed a comment — then add the feature.', 'Beyond one fix: the extract / simplify / rename refactor pass done before the feature lands.'),
    5: form('Write a refactor note for the cleanup before extending: the extractions, simplifications, and renames done — committed as a checkpoint so the feature lands on clean ground.', 'A durable refactor-checkpoint note of the cleanup committed before the feature was added.'),
  },
};

/** ABSENCE_SELF_REVIEW_HABIT — verification family, keyword "review". */
export const ABSENCE_SELF_REVIEW_HABIT_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_SELF_REVIEW_HABIT', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Review the diff of what was just built before moving on.', 'One diff-readback review is the lightest catch after a long run.'),
    2: form('Review the diff for drift and gaps: does it match intent, and is anything missing?', 'A light review: the diff read back for intent-match and obvious gaps.'),
    3: form("Google Engineering Practices: 'The author is the first reviewer.' Before submitting or continuing, read back through the diff: does the code do what was intended? Are there naming inconsistencies? Is anything more complex than it needs to be? Are tests missing? The self-review pass catches what was obvious in the context of writing but invisible in isolation — logic errors, naming drift, gaps in coverage.", "The diff-readback self-review hasn't been done."),
    4: form('Review the whole run end-to-end: intent match, naming and structure coherence, redundancy or conflicts between early and late decisions, and coverage gaps.', 'Beyond a quick read: a whole-run review for coherence, conflicts, and coverage gaps.'),
    5: form('Write a self-review note: the diff findings (drift, gaps, inconsistencies), the fixes made, and a commit checkpoint — so the review is a habit, not a one-off.', 'A durable self-review note of the findings and fixes, committed as a checkpoint.'),
  },
};

/** ABSENCE_PERFORMANCE_AWARENESS — verification family, keyword "performance". */
export const ABSENCE_PERFORMANCE_AWARENESS_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_PERFORMANCE_AWARENESS', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Check what was just built for one obvious performance problem — an N+1 or an unbounded fetch.', 'A quick check for one obvious performance problem is the lightest awareness step.'),
    2: form('Do a light performance check: N+1 queries and unbounded fetches in what was just built.', 'A light performance pass: the N+1 and unbounded-fetch patterns checked.'),
    3: form("Knuth (1974): 'We should not pass up our opportunities in that critical 3%.' The full quote is not an excuse to avoid performance — it's a prioritization rule: ignore the 97% of noncritical paths, but act on the critical 3%. For what was just built — is this in the critical 3%? A full-table fetch, N+1 in a loop, or unthrottled list render qualifies. The check here is awareness, not micro-optimization: is there an obvious performance problem worth addressing before it ships?", "Critical-3%-path awareness check (N+1 / full-table fetch / unthrottled render) hasn't been done."),
    4: form('Audit the data-heavy paths for performance: N+1 queries, unbounded fetches, and expensive unthrottled renders, plus behaviour at 10x and 100x load.', 'Beyond one issue: the data-heavy patterns audited for performance at projected load.'),
    5: form('Write a performance note: the data-heavy paths, the findings (N+1, unbounded fetch, expensive render), the load projections, and the fixes — kept with the feature.', 'A durable performance note of the heavy paths, findings, and fixes before ship.'),
  },
};

/** ABSENCE_DOCUMENTATION_BEFORE_ASK — maintainability family, keyword "docs". */
export const ABSENCE_DOCUMENTATION_BEFORE_ASK_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_DOCUMENTATION_BEFORE_ASK', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A6_SPINE,
  levelForms: {
    1: form('Check the official docs for this before asking, and tell me what you find.', 'A quick docs check before asking is the lightest step against a guessed answer.'),
    2: form('Look up the official docs for this, share what you find, then ask what is still unclear.', 'A light pass: the docs checked and what-was-found shared before the question.'),
    3: form("1. Before asking me this question — check the official documentation for this library or API.\n2. Share with me: what did you find, and is the answer there?\n3. Then ask me what you still couldn't find in the docs.", "An official-docs check before asking hasn't been shared."),
    4: form('Search the official docs thoroughly for this — the relevant guide, API reference, and examples — share what you found, and name exactly what the docs do not cover.', 'Beyond a quick look: the docs searched across guide and reference, with the gap named.'),
    5: form('Write a short note from the docs: the relevant doc links, what they answer, and the specific gap that still needs me — so the docs are the first source, not the last.', 'A durable note of the doc sources checked and the remaining gap — docs first, ask second.'),
  },
};

/** ABSENCE_OUTPUT_VERIFICATION — verification family, keyword "run". */
export const ABSENCE_OUTPUT_VERIFICATION_RECORD: ContentTemplateRecord = {
  signalType: 'ABSENCE_OUTPUT_VERIFICATION', source: 'shipped', schemaVersion: 1, slots: [],
  paramAxes: VERIFICATION_PARAM_AXES, spine: A3_SPINE,
  levelForms: {
    1: form('Actually run what was just built and tell me what happens.', 'Running it once is the lightest check that the generated code actually works.'),
    2: form('Run what was just built on the main path and share whether it behaves as expected.', 'A light pass: the main path run and the actual-vs-expected behaviour shared.'),
    3: form("1. Before moving on from what was just built — actually run it or try it.\n2. Share with me: does it behave the way you expected?\n3. If anything looks off, tell me what happened and we'll look at it together.", "Whether the generated code actually works hasn't been verified."),
    4: form('Run what was just built across the main and edge cases, compare each result to what was expected, and report anything that behaves differently.', 'Beyond one run: the main and edge cases run and compared against expectations.'),
    5: form('Write a quick verification note: the cases you run, the expected vs actual result for each, and anything off — so "it works" is something you ran, not assumed.', 'A durable note of what was run and the expected-vs-actual results — verified, not assumed.'),
  },
};

/** Class-2 BATCH B — the 10 casual-/beginner-only verification-quality records. */
export const CLASS2_RECORDS_BATCH_B: readonly ContentTemplateRecord[] = [
  ABSENCE_CODE_DOCUMENTATION_GAP_RECORD,
  ABSENCE_TECHNICAL_DEBT_ACKNOWLEDGMENT_RECORD,
  ABSENCE_TEST_DEPTH_CHECK_RECORD,
  ABSENCE_SECURITY_REVIEW_GAP_RECORD,
  ABSENCE_ERROR_HANDLING_COVERAGE_RECORD,
  ABSENCE_REFACTORING_CHECKPOINT_RECORD,
  ABSENCE_SELF_REVIEW_HABIT_RECORD,
  ABSENCE_PERFORMANCE_AWARENESS_RECORD,
  ABSENCE_DOCUMENTATION_BEFORE_ASK_RECORD,
  ABSENCE_OUTPUT_VERIFICATION_RECORD,
];

/** All class-2 verification-quality records (batch A + batch B = the 21 signalTypes). */
export const CLASS2_RECORDS: readonly ContentTemplateRecord[] = [
  ...CLASS2_RECORDS_BATCH_A,
  ...CLASS2_RECORDS_BATCH_B,
];
