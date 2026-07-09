/**
 * Register-keyed popup question + pinch-fallback fields, per signalType (B11 sub-step ii).
 *
 * The migrated content-template engine serves the OPTIONS/why-desc, but the popup's question
 * header and its pinch-label fallback are short register-keyed strings. This map is the single
 * source for them across all 142 signals — migrated verbatim from the retired static
 * DecisionContent (formal/casual/beginner), so the static layer can be deleted (B11 sub-step iv).
 *
 * Per-register: `base` is the anchor register's phrasing; `casual`/`beginner` are stored ONLY where
 * the question differs from base (pure register vocabulary — same meaning). Role questions are
 * uniform (= base), so no role dimension is stored. Resolution mirrors the engine's form resolver:
 * beginner-exclusive, else register, else base.
 *
 * GENERATED from the static content (do not hand-edit); the record set + this map are the whole
 * question/pinch layer after cutover.
 */

export interface PinchFields {
  question: string;
  pinchFallback: string;
}

export const SIGNAL_PINCH_FIELDS: Readonly<Record<string, { base: PinchFields; casual?: PinchFields; beginner?: PinchFields }>> = {
  ABSENCE_ACCEPTANCE_CRITERIA_BEFORE_DEV: { base: { question: "Are acceptance criteria defined for this story before development begins?", pinchFallback: "Define acceptance criteria for this story before starting implementation." } },
  ABSENCE_ACCESSIBILITY: { base: { question: "UI being built — accessibility checked?", pinchFallback: "Accessibility?" } },
  ABSENCE_ALTERNATIVES: { base: { question: "Decision made — alternatives considered?", pinchFallback: "No alternatives." }, casual: { question: "Decision made — any alternatives looked at?", pinchFallback: "No alternatives." }, beginner: { question: "Decision made — any alternatives looked at?", pinchFallback: "No alternatives." } },
  ABSENCE_API_CONTRACT_DEFINITION: { base: { question: "API being built — defined the contract first?", pinchFallback: "Define the interface before implementing." } },
  ABSENCE_API_DESIGN_REVIEW: { base: { question: "API being built — design reviewed?", pinchFallback: "API design?" } },
  ABSENCE_ARCHITECTURE_NOTE_ABSENCE: { base: { question: "Architecture decision made — noted the rationale?", pinchFallback: "Add an architecture note." } },
  ABSENCE_ARCH_CONFLICT: { base: { question: "Feature added — architecture consistency checked?", pinchFallback: "Arch conflict." }, casual: { question: "Feature added — does it fit the codebase?", pinchFallback: "Arch conflict." }, beginner: { question: "Feature added — does it fit the codebase?", pinchFallback: "Arch conflict." } },
  ABSENCE_BACKWARDS_COMPATIBILITY_CHECK: { base: { question: "Interface changed — checked existing consumers?", pinchFallback: "Check what calls this before changing." } },
  ABSENCE_BUILD_IN_PUBLIC_OPPORTUNITY: { base: { question: "Is this a milestone worth sharing publicly?", pinchFallback: "Consider sharing this milestone publicly before moving to the next." } },
  ABSENCE_BUILD_VS_UNDERSTAND_RATIO: { base: { question: "We've been building — do you understand what we've built?", pinchFallback: "Pause and understand." } },
  ABSENCE_CAPACITY_PLANNING_GAP: { base: { question: "Load-adding feature — capacity estimate done?", pinchFallback: "Complete a capacity estimate before shipping." } },
  ABSENCE_CI_PIPELINE: { base: { question: "Moving toward release — CI pipeline configured?", pinchFallback: "CI pipeline?" } },
  ABSENCE_CODE_DOCUMENTATION_GAP: { base: { question: "Complex logic added — documented the why?", pinchFallback: "Add the why comment." } },
  ABSENCE_COMPETITIVE_AWARENESS: { base: { question: "Have you checked how competitors handle this?", pinchFallback: "Run a quick competitive check before committing to this build." } },
  ABSENCE_COMPREHENSION: { base: { question: "AI generated it — do you understand it?", pinchFallback: "Comprehension check." }, casual: { question: "AI wrote it — do you actually get it?", pinchFallback: "Comprehension check." }, beginner: { question: "AI wrote it — do you actually get it?", pinchFallback: "Comprehension check." } },
  ABSENCE_CONTEXT_LOSS: { base: { question: "Long session — context recapped?", pinchFallback: "Context recap?" } },
  ABSENCE_CONTRACT_TESTING_GAP: { base: { question: "Service boundary established — contract tests defined?", pinchFallback: "Define consumer-driven contract tests for this boundary." } },
  ABSENCE_COPY_PASTE_AWARENESS: { base: { question: "Code generated — do you understand it before using it?", pinchFallback: "Understand first." } },
  ABSENCE_CORRECTION_SEEKING: { base: { question: "AI output — self-verification requested?", pinchFallback: "No verification." }, casual: { question: "Has the AI checked its own work?", pinchFallback: "No verification." }, beginner: { question: "Has the AI checked its own work?", pinchFallback: "No verification." } },
  ABSENCE_CREATIVE_VS_CORE_RATIO: { base: { question: "Session balance — how much went to core vs. creative features?", pinchFallback: "Core value first." } },
  ABSENCE_CROSS_CONFIRMING: { base: { question: "AI generated it — have you verified it?", pinchFallback: "Verify the output." }, casual: { question: "AI wrote it — have you actually checked it?", pinchFallback: "Verify the output." }, beginner: { question: "AI wrote it — have you actually checked it?", pinchFallback: "Verify the output." } },
  ABSENCE_CROSS_TEAM_IMPACT_CHECK: { base: { question: "Have teams affected by this change been notified before development begins?", pinchFallback: "Identify and notify affected teams before building this change to shared systems." } },
  ABSENCE_DATABASE_MIGRATION_SAFETY: { base: { question: "Schema change — expand-migrate-contract pattern applied?", pinchFallback: "Apply backwards-compatible phased migration." } },
  ABSENCE_DATA_VALIDATION: { base: { question: "Accepting input — data validation in place?", pinchFallback: "Input validation?" } },
  ABSENCE_DEBUGGING_OBSERVATION: { base: { question: "Something's broken — what did you actually see?", pinchFallback: "Describe it first." } },
  ABSENCE_DECISION_FATIGUE_PATTERN: { base: { question: "Long acceptance streak — applied critical review recently?", pinchFallback: "Streak alert." }, beginner: { question: "Accepting without reviewing — applied critical check recently?", pinchFallback: "Streak alert." } },
  ABSENCE_DECISION_RECORD_ABSENCE: { base: { question: "Architectural decision made — ADR recorded?", pinchFallback: "Record the decision with context and consequences." } },
  ABSENCE_DEFINITION_OF_DONE: { base: { question: "Is there an explicit Definition of Done for this sprint item?", pinchFallback: "Define the completion criteria for this item before starting work." } },
  ABSENCE_DEMO_VS_PRODUCT: { base: { question: "Is this demo quality or production quality — explicit distinction?", pinchFallback: "Demo vs. production: name which." } },
  ABSENCE_DEPENDENCY_ADVENTURE: { base: { question: "Adding a dependency — evaluated the need and maintenance cost?", pinchFallback: "Evaluate before adding." } },
  ABSENCE_DEPENDENCY_AUDIT_GAP: { base: { question: "New dependency added — evaluated it before adopting?", pinchFallback: "Check the dependency before adding." } },
  ABSENCE_DEPENDENCY_MAPPING: { base: { question: "Have upstream and downstream dependencies for this work been identified before starting?", pinchFallback: "Map dependencies before beginning this work to prevent blocked integration." } },
  ABSENCE_DEPENDENCY_MGMT: { base: { question: "Dependencies added — conflicts and risks reviewed?", pinchFallback: "Dependency risk." }, casual: { question: "Added packages — any issues checked?", pinchFallback: "Dependency risk." }, beginner: { question: "Added packages — any issues checked?", pinchFallback: "Dependency risk." } },
  ABSENCE_DEPLOYMENT_PLANNING: { base: { question: "Release pending — deployment plan confirmed?", pinchFallback: "No deploy plan." }, casual: { question: "Shipping soon — is the deployment actually planned?", pinchFallback: "No deploy plan." }, beginner: { question: "Shipping soon — is the deployment actually planned?", pinchFallback: "No deploy plan." } },
  ABSENCE_DEPLOYMENT_STRATEGY_ABSENCE: { base: { question: "Significant feature shipping — deployment strategy defined?", pinchFallback: "Define deployment strategy and rollback plan before shipping." } },
  ABSENCE_DISTRIBUTION_THINKING: { base: { question: "How will users discover and access this feature?", pinchFallback: "Consider the distribution angle before building this feature." } },
  ABSENCE_DOCUMENTATION: { base: { question: "Code written — any documentation added?", pinchFallback: "Docs missing." }, casual: { question: "Code written — is anything documented?", pinchFallback: "Docs missing." }, beginner: { question: "Code written — is anything documented?", pinchFallback: "Docs missing." } },
  ABSENCE_DOCUMENTATION_BEFORE_ASK: { base: { question: "About to ask — have you checked the docs?", pinchFallback: "Docs first." } },
  ABSENCE_EARLY_USER_FEEDBACK: { base: { question: "When did you last get a real user's reaction to what you're building?", pinchFallback: "Show what you've built to at least one real user before continuing." } },
  ABSENCE_ENV_AND_SECRETS: { base: { question: "Credentials in use — secrets management reviewed?", pinchFallback: "Secrets setup?" } },
  ABSENCE_ERROR_HANDLING: { base: { question: "Feature built — error paths handled?", pinchFallback: "Error handling." }, casual: { question: "Feature built — what happens when it breaks?", pinchFallback: "Error handling." }, beginner: { question: "Feature built — what happens when it breaks?", pinchFallback: "Error handling." } },
  ABSENCE_ERROR_HANDLING_COVERAGE: { base: { question: "Implementation done — covered the error paths?", pinchFallback: "Add error handling for failure cases." } },
  ABSENCE_ERROR_UNDERSTANDING: { base: { question: "Got an error — do you know what it means?", pinchFallback: "Understand the error." } },
  ABSENCE_FAILURE_MODE_ANALYSIS: { base: { question: "External dependencies integrated — failure modes enumerated?", pinchFallback: "Enumerate failure modes for each dependency." } },
  ABSENCE_FEATURE_COMPLETION_CHECK: { base: { question: "Adding more — is the previous feature actually done?", pinchFallback: "Finish before starting next." } },
  ABSENCE_FEATURE_PRIORITIZATION: { base: { question: "Why is this the highest-priority thing to build right now?", pinchFallback: "Confirm this is the highest-impact item before building." } },
  ABSENCE_FEATURE_SCOPE: { base: { question: "Feature started — Definition of Ready confirmed?", pinchFallback: "Scope this first." }, casual: { question: "Started building — is scope defined?", pinchFallback: "What's in scope?" }, beginner: { question: "Building this — what should it actually do?", pinchFallback: "Scope first." } },
  ABSENCE_FEEDBACK_LOOP_ESTABLISHMENT: { base: { question: "How will you know if this feature is working after you ship it?", pinchFallback: "Add a feedback mechanism before shipping." } },
  ABSENCE_FINISHING_LINE_AWARENESS: { base: { question: "Multiple things in progress — how many are complete?", pinchFallback: "Finish one before starting next." } },
  ABSENCE_FOCUS_DRIFT_DETECTION: { base: { question: "Multiple areas open — completed any end-to-end?", pinchFallback: "Focus drift." }, beginner: { question: "Working on many things — finished any of them yet?", pinchFallback: "Focus drift." } },
  ABSENCE_FRUSTRATION_SPIRAL: { base: { question: "This has been a stuck stretch — want to pause and reset before continuing?", pinchFallback: "Worth a pause." } },
  ABSENCE_HYPOTHESIS_BEFORE_BUILD: { base: { question: "What hypothesis does this feature test?", pinchFallback: "Define the hypothesis before starting the build." } },
  ABSENCE_IDEA_CONSTRAINT_CHECK: { base: { question: "Idea scoped — are the non-goals defined?", pinchFallback: "Non-goals missing." }, casual: { question: "Idea forming — what's out of scope?", pinchFallback: "No non-goals set." }, beginner: { question: "Idea forming — what's out of scope?", pinchFallback: "No non-goals set." } },
  ABSENCE_IDEA_SCOPING: { base: { question: "Idea in mind — is the scope defined?", pinchFallback: "Scope undefined." }, casual: { question: "Idea forming — what exactly are we building?", pinchFallback: "Scope unclear." }, beginner: { question: "Idea forming — what exactly are we building?", pinchFallback: "Scope unclear." } },
  ABSENCE_IDEA_TO_SPEC_BRIDGE: { base: { question: "New idea — defined what it does before building?", pinchFallback: "Spec the idea first." } },
  ABSENCE_IDEA_USER_DEFINITION: { base: { question: "Idea scoped — is the target user defined?", pinchFallback: "Target user undefined." }, casual: { question: "Idea forming — who is this actually for?", pinchFallback: "User not defined." }, beginner: { question: "Idea forming — who is this actually for?", pinchFallback: "User not defined." } },
  ABSENCE_IMPLEMENTATION_CHECKPOINT: { base: { question: "Implementation continued — current state verified?", pinchFallback: "Verify first." }, casual: { question: "Kept building — is the last change verified?", pinchFallback: "Checkpoint." }, beginner: { question: "Built something new — does it actually work?", pinchFallback: "Quick check." } },
  ABSENCE_INCREMENTAL_BUILD: { base: { question: "Incremental build — is each step verified before the next?", pinchFallback: "Verify before proceeding." }, casual: { question: "Building incrementally — verifying between steps?", pinchFallback: "Verify between steps." }, beginner: { question: "Building something — verifying each piece as you go?", pinchFallback: "One piece at a time." } },
  ABSENCE_ITERATION_PLANNING: { base: { question: "Feedback reviewed — has the next iteration been planned?", pinchFallback: "Next iteration unplanned." }, casual: { question: "Feedback reviewed — what are we building next?", pinchFallback: "Next iteration unplanned." }, beginner: { question: "Feedback reviewed — what are we building next?", pinchFallback: "Next iteration unplanned." } },
  ABSENCE_LAUNCH_STRATEGY_ABSENCE: { base: { question: "How are people going to find out this product exists when you launch?", pinchFallback: "Define a launch strategy before getting closer to ship date." } },
  ABSENCE_LEARNING_CONSOLIDATION: { base: { question: "We've built a lot — do you feel like you understood it?", pinchFallback: "Recap learning." } },
  ABSENCE_MANUAL_BEFORE_AUTOMATE: { base: { question: "Have you done this manually to confirm it works before automating?", pinchFallback: "Do it manually first, then automate the proven version." } },
  ABSENCE_MONETIZATION_PATH_CLARITY: { base: { question: "How does this feature connect to how the product makes money?", pinchFallback: "Consider the monetization connection before building this feature." } },
  ABSENCE_MVP_BOUNDARY_DISCIPLINE: { base: { question: "Is this addition within MVP scope?", pinchFallback: "Check whether this is needed to test the core hypothesis." } },
  ABSENCE_MVP_SCOPE_DISCIPLINE: { base: { question: "Adding features — is each one actually MVP scope?", pinchFallback: "MVP discipline check." } },
  ABSENCE_NORTH_STAR_ALIGNMENT: { base: { question: "How does this feature connect to your product's core metric?", pinchFallback: "Check north star alignment before adding this feature." } },
  ABSENCE_NO_AUTOMATED_SECURITY_SCANNING: { base: { question: "No automated security scanning is set up — add a dependency/code scan?", pinchFallback: "No security scan." } },
  ABSENCE_NO_BACKUP_SAFETY: { base: { question: "There's no backup or safety net for this project's data — add one?", pinchFallback: "No safety net." } },
  ABSENCE_NO_PUSHBACK: { base: { question: "AI suggesting — are you evaluating critically?", pinchFallback: "No pushback." }, casual: { question: "AI keeps suggesting — are you actually evaluating?", pinchFallback: "No pushback." }, beginner: { question: "AI keeps suggesting — are you actually evaluating?", pinchFallback: "No pushback." } },
  ABSENCE_NO_SEPARATE_ENVS: { base: { question: "Dev, staging, and production aren't separated — stand up separate environments?", pinchFallback: "No separate envs." } },
  ABSENCE_NO_VERSION_CONTROL: { base: { question: "This project isn't under version control yet — set that up?", pinchFallback: "No version control." } },
  ABSENCE_OBSERVABILITY: { base: { question: "Feature built — how will you know it's working?", pinchFallback: "No observability." }, casual: { question: "Feature built — will you know when it breaks?", pinchFallback: "No observability." }, beginner: { question: "Feature built — will you know when it breaks?", pinchFallback: "No observability." } },
  ABSENCE_OBSERVABILITY_FIRST: { base: { question: "Feature shipping — observability instrumented?", pinchFallback: "Add logging, metrics, and tracing before shipping." } },
  ABSENCE_OPERATIONAL_RUNBOOK_GAP: { base: { question: "New service/feature shipping — operational runbook written?", pinchFallback: "Write the runbook before shipping." } },
  ABSENCE_OUTCOME_DEFINITION: { base: { question: "What does success look like for this feature?", pinchFallback: "Define the success metric before building starts." } },
  ABSENCE_OUTPUT_VERIFICATION: { base: { question: "Code generated — have you actually tried it?", pinchFallback: "Test it first." } },
  ABSENCE_OVER_ENGINEERING_CHECK: { base: { question: "Is this abstraction required by current requirements?", pinchFallback: "Apply YAGNI — build only what current requirements require." } },
  ABSENCE_PAIR_REVIEW_ABSENCE: { base: { question: "Critical implementation complete — review plan established?", pinchFallback: "Establish a review plan before merging." } },
  ABSENCE_PERFORMANCE_AWARENESS: { base: { question: "Data-heavy operation — considered performance?", pinchFallback: "Check for performance implications." } },
  ABSENCE_PHASE_TRANSITION: { base: { question: "Extended phase — transition readiness assessed?", pinchFallback: "Phase check." }, casual: { question: "Been in this phase a while — what comes next?", pinchFallback: "Phase check." }, beginner: { question: "Been in this phase a while — what comes next?", pinchFallback: "Phase check." } },
  ABSENCE_POLISH_VS_FUNCTION: { base: { question: "Working on the look — does the core work end-to-end?", pinchFallback: "Function before polish." } },
  ABSENCE_PRIORITY_JUSTIFICATION: { base: { question: "Is there an explicit justification for why this item is the current highest priority?", pinchFallback: "Articulate the priority justification for this item before beginning work." } },
  ABSENCE_PROBLEM_CORRECTION: { base: { question: "Bug noticed — explicitly corrected?", pinchFallback: "Bug unresolved." }, casual: { question: "Spotted a bug — did it actually get fixed?", pinchFallback: "Bug unresolved." }, beginner: { question: "Spotted a bug — did it actually get fixed?", pinchFallback: "Bug unresolved." } },
  ABSENCE_PROGRESS_CONSOLIDATION_GAP: { base: { question: "Extended implementation — progress documented?", pinchFallback: "Document now." }, beginner: { question: "Built a lot — have you written down what you made?", pinchFallback: "Document now." } },
  ABSENCE_PROMPT_CONTEXT: { base: { question: "Prompts sent — spec and arch referenced?", pinchFallback: "Missing context." }, casual: { question: "Sending prompts — have you shared the spec?", pinchFallback: "Missing context." }, beginner: { question: "Sending prompts — have you shared the spec?", pinchFallback: "Missing context." } },
  ABSENCE_RATE_LIMITING: { base: { question: "API endpoint built — rate limiting designed?", pinchFallback: "Rate limiting?" } },
  ABSENCE_REFACTORING: { base: { question: "Extended implementation — code health reviewed?", pinchFallback: "Refactor check." }, casual: { question: "Long build run — anything to clean up?", pinchFallback: "Refactor check." }, beginner: { question: "Long build run — anything to clean up?", pinchFallback: "Refactor check." } },
  ABSENCE_REFACTORING_CHECKPOINT: { base: { question: "Adding to messy code — refactored first?", pinchFallback: "Do a cleanup pass before extending." } },
  ABSENCE_REGRESSION_CHECK: { base: { question: "Changes made — regression verified?", pinchFallback: "Regression check." }, casual: { question: "Changed something — did anything break?", pinchFallback: "Regression check." }, beginner: { question: "Changed something — did anything break?", pinchFallback: "Regression check." } },
  ABSENCE_REQUIREMENTS_AMBIGUITY_FLAG: { base: { question: "Are there ambiguous quality attributes in these requirements that need a measurable definition?", pinchFallback: "Resolve ambiguous quality attributes to measurable criteria before implementation." } },
  ABSENCE_REQUIREMENT_CLARITY: { base: { question: "About to build — is the requirement clear?", pinchFallback: "Clarify first." } },
  ABSENCE_RESTART_IMPULSE_CHECK: { base: { question: "Hitting friction — debugged before considering a restart?", pinchFallback: "Debug before restarting." } },
  ABSENCE_RETENTION_MECHANISM_CHECK: { base: { question: "How does this feature bring users back?", pinchFallback: "Consider the retention angle before building." } },
  ABSENCE_RETROSPECTIVE_HABIT: { base: { question: "Has this sprint or iteration been closed with a retrospective before starting the next?", pinchFallback: "Run a retrospective on this sprint before moving to the next cycle." } },
  ABSENCE_RISK_FLAG: { base: { question: "Have risks been identified for this decision or scope change before proceeding?", pinchFallback: "Identify and document risks before proceeding with this significant decision." } },
  ABSENCE_ROLLBACK_AWARENESS: { base: { question: "About to change things — do you know how to undo it?", pinchFallback: "Save before changing." } },
  ABSENCE_ROLLBACK_PLANNING: { base: { question: "Release pending — rollback plan defined?", pinchFallback: "No rollback plan." }, casual: { question: "Shipping soon — what's the rollback plan?", pinchFallback: "No rollback plan." }, beginner: { question: "Shipping soon — what's the rollback plan?", pinchFallback: "No rollback plan." } },
  ABSENCE_SCOPE_CHANGE_IMPACT_ASSESSMENT: { base: { question: "Has the impact of this scope change on the current sprint been assessed?", pinchFallback: "Assess sprint impact before accepting this scope change." } },
  ABSENCE_SCOPE_CREEP: { base: { question: "Scope expanding — still on original plan?", pinchFallback: "Scope check?" } },
  ABSENCE_SCOPE_VS_TIME_CHECK: { base: { question: "Is the current scope still within your available time and energy?", pinchFallback: "Run a scope-vs-time check before adding more to the build." } },
  ABSENCE_SECRET_IN_PROMPT: { base: { question: "A secret was just pasted into a prompt — treat it as leaked and rotate it?", pinchFallback: "Secret exposed." } },
  ABSENCE_SECURITY_CHECK: { base: { question: "Feature built — security reviewed?", pinchFallback: "Security gap." }, casual: { question: "Built something — any security checks done?", pinchFallback: "Security gap." }, beginner: { question: "Built something — any security checks done?", pinchFallback: "Security gap." } },
  ABSENCE_SECURITY_REVIEW_GAP: { base: { question: "Security surface touched — applied security checks?", pinchFallback: "Apply security checks now." } },
  ABSENCE_SECURITY_THREAT_MODELING: { base: { question: "Security-sensitive feature — STRIDE threat model completed?", pinchFallback: "Complete a STRIDE threat model before shipping." } },
  ABSENCE_SELF_REVIEW_HABIT: { base: { question: "Long implementation run — done a review pass?", pinchFallback: "Read back through what was built." } },
  ABSENCE_SESSION_LENGTH_CHECKPOINT: { base: { question: "Extended session — context checkpoint done?", pinchFallback: "Checkpoint due." }, beginner: { question: "Working for a while — what have you built so far?", pinchFallback: "Checkpoint due." } },
  ABSENCE_SHIP_READINESS_DEFINITION: { base: { question: "What needs to be true for this to be ready to ship?", pinchFallback: "Write ship criteria before continuing to build." } },
  ABSENCE_SIMPLE_SOLUTION_FIRST: { base: { question: "Building this — is there a simpler way to do it?", pinchFallback: "Simplest first." } },
  ABSENCE_SINGLE_RESPONSIBILITY_PROMPTING: { base: { question: "Asking a lot at once — let's do one thing at a time", pinchFallback: "One thing at a time." } },
  ABSENCE_SLO_DEFINITION_GAP: { base: { question: "User-facing feature/service — SLOs defined?", pinchFallback: "Define SLOs before shipping." } },
  ABSENCE_SOLO_MAINTAINABILITY: { base: { question: "Is this addition maintainable by you alone, long-term?", pinchFallback: "Run the solo maintainability check before adding this complexity." } },
  ABSENCE_SPEC_ACCEPTANCE: { base: { question: "Implementation done — spec checked?", pinchFallback: "Check the spec." }, casual: { question: "Built something — does it match what was planned?", pinchFallback: "Check the spec." }, beginner: { question: "Built something — does it match what was planned?", pinchFallback: "Check the spec." } },
  ABSENCE_SPEC_BEFORE_CODE: { base: { question: "Implementation started — behaviour specified first?", pinchFallback: "Spec before code." }, casual: { question: "Building this — behaviour defined first?", pinchFallback: "Spec it first." }, beginner: { question: "Coding this — what's it supposed to do?", pinchFallback: "Spec first." } },
  ABSENCE_SPEC_CROSS_CONFIRM: { base: { question: "Spec written — cross-confirmed against requirements?", pinchFallback: "Spec not confirmed." }, casual: { question: "Spec exists — has it been checked against the plan?", pinchFallback: "Spec not confirmed." }, beginner: { question: "Spec exists — has it been checked against the plan?", pinchFallback: "Spec not confirmed." } },
  ABSENCE_SPEC_REVISION: { base: { question: "Spec drafted — revised since initial version?", pinchFallback: "Spec unrevised." }, casual: { question: "Spec written — has it been updated since the first draft?", pinchFallback: "Spec unrevised." }, beginner: { question: "Spec written — has it been updated since the first draft?", pinchFallback: "Spec unrevised." } },
  ABSENCE_STAKEHOLDER_ALIGNMENT_CHECK: { base: { question: "Have relevant stakeholders been aligned on this feature before development begins?", pinchFallback: "Verify stakeholder alignment before proceeding with significant development work." } },
  ABSENCE_SUCCESS_METRIC_DEFINITION: { base: { question: "Is there a success metric defined for this feature before development begins?", pinchFallback: "Define how success will be measured for this feature before starting implementation." } },
  ABSENCE_TASK_DEFINITION_OF_DONE: { base: { question: "Tasks ordered — does each task have a definition of done?", pinchFallback: "No done criteria." }, casual: { question: "Tasks set — how do we know when each one's done?", pinchFallback: "Done criteria missing." }, beginner: { question: "Tasks set — how do we know when each one's done?", pinchFallback: "Done criteria missing." } },
  ABSENCE_TASK_ORDERING: { base: { question: "Tasks listed — have they been ordered?", pinchFallback: "Tasks unordered." }, casual: { question: "Tasks listed — what order do we do them in?", pinchFallback: "No order set." }, beginner: { question: "Tasks listed — what order do we do them in?", pinchFallback: "No order set." } },
  ABSENCE_TASK_SIZING: { base: { question: "Tasks defined — are they scoped to single sessions?", pinchFallback: "Tasks oversized." }, casual: { question: "Tasks listed — are they small enough to do in one go?", pinchFallback: "Tasks too big." }, beginner: { question: "Tasks listed — are they small enough to do in one go?", pinchFallback: "Tasks too big." } },
  ABSENCE_TECHNICAL_DEBT_ACKNOWLEDGMENT: { base: { question: "Shortcut taken — tagged it as debt?", pinchFallback: "Tag the shortcut." } },
  ABSENCE_TECHNICAL_SPIKE_TREATMENT: { base: { question: "Exploring / experimenting — spike or production code?", pinchFallback: "Spike or production: name which." } },
  ABSENCE_TECHNICAL_VS_PRODUCT_TIME_BALANCE: { base: { question: "When did you last check product direction — not just implementation?", pinchFallback: "Take a product perspective before continuing to build." } },
  ABSENCE_TECH_STACK_COMPLEXITY_CHECK: { base: { question: "Can you maintain this architecture alone, at 2am, when it breaks?", pinchFallback: "Apply the solo maintainability test before adding this complexity." } },
  ABSENCE_TEST_CREATION: { base: { question: "Code added — where are the tests?", pinchFallback: "Tests missing." }, casual: { question: "Built something — any tests written yet?", pinchFallback: "Tests missing." }, beginner: { question: "Built something — any tests written yet?", pinchFallback: "Tests missing." } },
  ABSENCE_TEST_DEPTH_CHECK: { base: { question: "Tests written — covering beyond the happy path?", pinchFallback: "Add edge and error path tests." } },
  ABSENCE_TIME_TO_VALUE_CHECK: { base: { question: "Is this solution the right size for your current scale?", pinchFallback: "Check whether this complexity is justified at current user count." } },
  ABSENCE_USER_ACQUISITION_CONSIDERATION: { base: { question: "How will target users find and access this feature?", pinchFallback: "Define the acquisition path before building." } },
  ABSENCE_USER_FEEDBACK_REVIEW: { base: { question: "Feedback received — has it been reviewed systematically?", pinchFallback: "Feedback not reviewed." }, casual: { question: "Feedback in — have we actually gone through it?", pinchFallback: "Feedback not reviewed." }, beginner: { question: "Feedback in — have we actually gone through it?", pinchFallback: "Feedback not reviewed." } },
  ABSENCE_USER_JOURNEY_CHECK: { base: { question: "Feature being built — is the full user journey mapped?", pinchFallback: "Map the user journey first." } },
  ABSENCE_USER_PERSONA_CLARITY: { base: { question: "Who specifically is this feature for?", pinchFallback: "Name the specific user this feature is designed for." } },
  ABSENCE_USER_STORY_COMPLETENESS: { base: { question: "Is this work item expressed as a complete user story with who, what, and why?", pinchFallback: "Reframe this work item as a user story — who benefits, what they need, why it matters." } },
  ABSENCE_USER_VALUE_CHECK: { base: { question: "Has this feature been validated with real users?", pinchFallback: "Check user signal before committing to this build." } },
  ABSENCE_WORK_RHYTHM_CHECK: { base: { question: "Rapid prompting — verified each response before continuing?", pinchFallback: "Slow down." }, beginner: { question: "Sending fast — read the last response fully before continuing?", pinchFallback: "Slow down." } },
  ARCHITECTURE_TO_TASKS: { base: { question: "Architecture done — is the task list ordered?", pinchFallback: "Break it down." } },
  BEHAVIOUR_TESTING: { base: { question: "Implementation done — user scenarios tested?", pinchFallback: "User scenario?" } },
  IDEA_TO_PRD: { base: { question: "Before building — is the plan written?", pinchFallback: "Before coding." } },
  IMPLEMENTATION_TO_REVIEW: { base: { question: "Phase done — full review before moving on?", pinchFallback: "Phase done?" } },
  PRD_TO_ARCHITECTURE: { base: { question: "Spec ready — is the architecture decided?", pinchFallback: "Design first." } },
  RELEASE_TO_FEEDBACK: { base: { question: "Just shipped — is the feedback loop active?", pinchFallback: "Watch it live." } },
  REVIEW_TO_RELEASE: { base: { question: "Ready to ship — final checks done?", pinchFallback: "Almost there." } },
  TASK_REVIEW: { base: { question: "Task done — reviewed and tested?", pinchFallback: "Quick check." }, casual: { question: "Task done — quick check before moving on?", pinchFallback: "Quick check." } },
};

/**
 * Resolve the register-appropriate question + pinch fallback for a signal.
 * Precedence: beginner override (exclusive) → casual override → base. Role is not a factor
 * (role questions are uniform with base). Returns undefined for an unknown signalType.
 */
export function resolvePinchFields(signalType: string, register?: string): PinchFields | undefined {
  const entry = SIGNAL_PINCH_FIELDS[signalType];
  if (!entry) return undefined;
  if (register === 'beginner' && entry.beginner) return entry.beginner;
  if (register === 'casual' && entry.casual) return entry.casual;
  return entry.base;
}
