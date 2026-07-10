# Classifier pipeline & advisory-firing flow

nexpath watches the prompts a developer sends to their coding agent and, between
agent turns, decides whether to surface a short advisory (a "decision session"). This
document describes how a single prompt flows through the classifier and the
advisory-firing gates.

---

## The stage classifier

Every prompt is classified by **one `gpt-4o-mini` call**. That single call:

- identifies the current **development stage** (Idea · PRD/Spec · Architecture · Task
  Breakdown · Implementation · Review/Testing · Release · Feedback Loop) with a
  confidence,
- assesses which **practices (signals)** for that stage are present or absent, and
- returns a **fire recommendation** — whether an advisory is worth surfacing.

It replaces an older local cascade (keyword match → TF-IDF → a MiniLM embedding tier)
plus a separate second LLM "cross-confirmation" call; those are folded into this one
call.

**Prompt shape (a prefix-cache lever).** The classifier sends a *stable* system message
(the stage taxonomy, the assess-by-intent rules, the output schema) plus a *dynamic*
user message (the recent-prompt window, a developer-profile calibration block, and the
signal checklist for the current stage). Keeping the system message constant lets the
provider prefix-cache it across prompts.

**Classification hardening.** The system prompt guards a known failure — mistaking the
*naming* of a production concept for *doing* it:

- **Verb-mood awareness** — design/spec/init verbs ("write the spec", "initialize",
  "scaffold") are not release or implementation activity just because production nouns
  (deploy, Docker, CI/CD) appear.
- **Scaffolding suppression** — a window containing explicit init/scaffold verbs
  (`initialize`, `set up the project`, `scaffold`, `bootstrap`, `npm init`, `create-*`)
  is never classified as *Release*, regardless of which production tools are named.
- **Release verification-token guard** — *Release* requires at least one
  verification/release-state token (tests passing, going live, a production deploy,
  cutting a release, release notes, a rollback); naming production infrastructure alone
  is not enough.

A deterministic backstop enforces the scaffolding + verification rules even if the
model over-rotates: a `release` result in a scaffold-without-verification window is
neutralised (its confidence is dropped so the stage transition is blocked and no
advisory fires).

**Degrade path.** On any model failure — offline, no API key, timeout, or an
unparseable reply — the classifier falls back to the **local keyword → TF-IDF
classifier** for the stage and recommends no advisory. Classification keeps working
offline; only the LLM-quality signal assessment and firing pause until the model is
reachable again.

---

## Per-prompt flow

```
UserPromptSubmit hook
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ Guards & persistence                                        │
│  • skip advisory-injected prompts                           │
│  • register project (first run) · persist the prompt        │
│  • load session state                                       │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│ Stage classifier  (1 gpt-4o-mini call, every prompt)        │
│  → stage + confidence + signal assessment + fire hint       │
│  (model unavailable → local keyword/TF-IDF fallback)        │
└───────────────┬────────────────────────────────────────────┘
                ▼
   profile classifier (~1 in 3 prompts)  ── separate call
   implementation-stage presence check   ── separate, conditional
                ▼
┌────────────────────────────────────────────────────────────┐
│ processPrompt → update stage / history / counters           │
│ absence detection → raise absence flags                     │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│ Fire gates (deterministic, no LLM):                         │
│  frequency=off · min-prompts · fire trigger · dedup ·       │
│  frequency tier · post-advisory cooldown · session cap      │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│ Fire cross-confirmation                                     │
│  fire  = trigger fired  AND  classifier recommended firing  │
│  signal = classifier's pick, validated against the flags    │
└───────────────┬────────────────────────────────────────────┘
                ▼
   pinch-label generation (1 call, only when firing)
                ▼
   store pending advisory → the Stop hook renders the UI
```

### The fire trigger (deterministic)

Before the classifier's recommendation is consulted, a deterministic trigger decides
whether an advisory is even a candidate for this prompt:

1. a **stage transition** was detected, or
2. a **new absence flag** was raised, or
3. classification confidence is low **and** an active (non-dismissed, non-cooldown)
   absence flag exists.

If none holds, the prompt takes no action. When a trigger *does* hold, the advisory
fires only if the classifier also recommended firing (and the confidence cleared the
minimum). The absence signal shown is the classifier's selection when it matches one of
the qualifying flags; otherwise the first qualifying flag is used.

---

## LLM calls per prompt

| Call | When | Notes |
|---|---|---|
| **Stage classifier** | every prompt | the one call that classifies the stage + recommends firing; degrades to a local classifier on failure |
| **Profile classifier** | ~1 in 3 prompts | kept separate; nature / mood / depth |
| **Presence check** | implementation stage, once enough prompts accrue | kept separate |
| **Pinch label** | only when an advisory fires | short header for the decision session |
| **Option generation** | only when an advisory fires | runs later, in the Stop hook |

Blocking is already the architecture: the hook awaits the pipeline, which awaits each
call in sequence. The delta of the single-call classifier is *frequency* — it runs on
every prompt rather than conditionally.

---

## No-API-key behaviour

The pipeline still runs without a configured key: prompt capture and the deterministic
gates need no key, and the stage classifier degrades to local stage detection. No
advisory fires until a key is configured — a single warning line is logged, and the
hook never crashes.
