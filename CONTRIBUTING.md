# Contributing to Nexpath

We're glad you're here. Whether you're fixing a bug, certifying a new agent, or improving the
docs, every contribution makes Nexpath more trustworthy.

If you are new to the project, read the [README](README.md) first — it covers what Nexpath does,
how to install it, and how it handles your data. This guide covers only what you need in order
to *change* it.

## TL;DR

There are lots of ways to contribute:

- **Code Contributions:** Fix bugs, improve the pipeline, add agent support
- **End-to-End Agent Testing:** Verify Nexpath against agents we have not certified yet
- **Documentation:** Improve the README, this guide, or the CLI help text
- **Bug Reports:** Report issues you encounter
- **Feature Requests:** Suggest new features or improvements
- **Community Support:** Help other users in the community

The Nexpath community is in
[GitHub Discussions](https://github.com/hi0001234d/nexpath/discussions).

One thing sets the tone for everything below: Nexpath exists to stop unverified work from
shipping, so we hold contributions to the same bar. **Verify before you open a PR.**

---

## Reporting Bugs or Issues

Bug reports make Nexpath better for everyone. Before creating a new issue, please
[search existing ones](https://github.com/hi0001234d/nexpath/issues) to avoid duplicates. When
you're ready, head to the [issues page](https://github.com/hi0001234d/nexpath/issues/new/choose).

> 🔐 **Important:** If you discover a security vulnerability, please use the
> [GitHub security tool to report it privately](https://github.com/hi0001234d/nexpath/security/advisories/new)
> instead of opening a public issue.

A great bug report contains:

- **A quick summary** and the background of what you were doing
- **Your environment** — OS and version, Node version, Nexpath version, and which AI coding
  agent you were using
- **Steps to reproduce** — be specific, and give the actual prompt or command if you can
- **What you expected** to happen
- **What actually happened** — exact error text, not a paraphrase
- **Diagnostics** — the output of `nexpath status`, and `nexpath log` if the issue is about
  advisory or popup behaviour. Re-run with `NEXPATH_DEBUG=1` for verbose stderr.
- **Notes** — why you think it might be happening, and what you already tried

**Before pasting diagnostics, read them.** `nexpath status` prints a full config dump and
`nexpath log` prints recent pipeline activity, which may include your own prompts. Nexpath's
redaction covers common secret formats, but that is not a guarantee for everything in a config
dump — redact anything private before posting it publicly.

---

## Before Contributing

All contributions must begin with a GitHub Issue, unless the change is a small bug fix, a typo
correction, a minor wording improvement, or a type-only fix that doesn't change functionality.

**For features and larger contributions:**

- First check [existing issues](https://github.com/hi0001234d/nexpath/issues) and
  [Discussions](https://github.com/hi0001234d/nexpath/discussions) for similar ideas
- If your idea is new, open an issue describing the problem, your proposed approach, and why it
  belongs in Nexpath
- Wait for approval from core maintainers before starting implementation
- Once approved, feel free to begin working on a PR

**PRs without approved issues may be closed.**

This is not bureaucracy — Nexpath's pipeline has a lot of interlocking gates, and a change that
looks local can move behaviour three stages downstream. A short conversation up front saves you
from rewriting work that was never going to land.

---

## Deciding What to Work On

Looking for a good first contribution? Check out issues labeled
[`good first issue`](https://github.com/hi0001234d/nexpath/labels/good%20first%20issue) or
[`help wanted`](https://github.com/hi0001234d/nexpath/labels/help%20wanted). These are curated
for new contributors and areas where we'd love some help.

Beyond the issue tracker, these are the areas where contribution is most useful right now:

1. **End-to-end agent testing** — highest value, no deep codebase knowledge needed. Only Claude
   Code is certified end-to-end today; the README's support table lists the rest. Certifying
   another agent means installing Nexpath against it, running real prompts through it, and
   reporting exactly what happened. Unlike the unit suite this cannot be automated — it needs a
   real agent, a real OS, and a real person watching.

2. **Cross-platform verification** — Nexpath touches OS-level credential storage and writes
   local state, so it breaks in platform-specific ways. Reports from Windows are especially
   useful, since that is where we have the least coverage.

3. **Pipeline correctness** — the prompt-enhancement pipeline (`src/prompt-enhancement/`) and
   the decision-session layer (`src/decision-session/`) carry most of the product behaviour and
   most of the test suite.

---

## Prerequisites

- **Node.js 18+** — required for all packages. Development is done on Node 20+; Node 22 is known
  to work. Declared as `"engines": { "node": ">=18" }`.
- **npm 9+** — ships with Node 18 and newer.
- **git**

Nothing else is required for the core CLI. TypeScript, `tsx`, and `vitest` all come from
`devDependencies`.

Install steps are in the
[README](README.md#add-nexpath-to-your-development-workflow--installation). Clone **your fork**
rather than the canonical repo, and add the original as `upstream` so you can rebase against it
later:

```bash
git remote add upstream https://github.com/hi0001234d/nexpath.git
```

---

## Common Checks

**Read this section before you open a PR.**

Nexpath does **not** run tests on pull requests. The two GitHub Actions workflows
(`publish-extension.yml`, `publish-ext-browser.yml`) only fire on release tags — they are
publish pipelines, not CI. **Your local run is the only gate that exists.**

From the repo root:

```bash
npm run build
npm run typecheck
npm test
```

### Build

`npm run build` is not just `tsc`. The `prebuild` step runs `scripts/check-build-gate.ts`, which
enforces two hard gates over the shipped content-template registry and aborts the build on
failure:

```
✓ content-template build gate passed (144 records, all floored + schema-valid)
✓ prompt-enhancement selectability gate passed (every intent routes from its proposal - no absorb, no skip)
```

- **Content-template gate** — every shipped record must be schema-valid and must have a level-1
  floor. A record missing its floor fails the build.
- **Selectability gate** — every prompt-enhancement intent must be reachable by a realistic
  prompt through the production router. An intent no prompt can reach is a dead template, and
  the build refuses to ship it.

If you added or edited a content template and the build aborts, fix the record — do not bypass
the gate.

### Typecheck

```bash
npm run typecheck        # core CLI + server
npm run typecheck:ext    # browser extension (tsconfig.ext-browser.json)
```

Both must produce no output. The root `tsconfig.json` deliberately excludes `src/ext-vscode` and
`src/ext-browser`, so `npm run typecheck` alone does **not** cover the browser extension. If you
touched `src/ext-browser/`, the second command is mandatory.

### Tests

`npm test` runs `vitest run` across the whole tree: **352 test files, 9386 tests**, in roughly
70–90 seconds.

**Known failures on a public clone — read this.** On a clean clone, `npm test` exits **1** with 8
failures across 2 files:

- `src/prompt-enhancement/dev-plan-table-integrity.test.ts`
- `src/prompt-enhancement/hv1-env-supply.test.ts`

Both read planning documents from a private submodule that is **not part of the public
repository**, so they fail with `ENOENT` for reasons unrelated to your change.

**These two files are the only accepted failures.** To get a clean signal, exclude exactly those
two and nothing else:

```bash
npx vitest run \
  --exclude "src/prompt-enhancement/dev-plan-table-integrity.test.ts" \
  --exclude "src/prompt-enhancement/hv1-env-supply.test.ts" \
  --exclude "**/node_modules/**" \
  --exclude "src/ext-vscode/**"
```

Expected on an unmodified `main`:

```
 Test Files  350 passed (350)
      Tests  9337 passed | 1 todo (9338)
```

**All 350 must pass.** If any file other than the two named above fails, your change broke
something. Do not add files to the exclude list to make a run go green — that is exactly the
kind of unverified shipping Nexpath exists to prevent.

### Leak guard

`npm run pe:leak-guard` is a read-only scan that fails if any public-going prompt-enhancement
file contains a confidentiality leak token (internal names, internal phase codes, private
paths). It performs no git history rewrite and no push.

**Current status:** on `main` today it reports **8 pre-existing findings** (a teammate name left
in `src/prompt-enhancement/`). This is known and tracked, and is **not caused by your change.**
Run it before and after your change and confirm your diff **adds no new findings**. If the count
grows, the new entries are yours.

### Sub-package checks

`src/ext-vscode/` is excluded from the root typecheck, the root build, **and** the root test run
(`vitest.config.ts`) — it's a separate npm package with a native dependency not installed at the
root. The root gate does not cover it:

```bash
cd src/ext-vscode
npm install
npm run typecheck
npm run test
npm run build
```

`src/ext-browser/` is different: its tests **do** run in the root suite, but its types do not —
that's what `npm run typecheck:ext` is for. To build it: `npm run build:ext`.

---

## Writing and Submitting Code

Anyone can contribute code to Nexpath, but we ask that you follow these guidelines so your
contributions can be smoothly integrated:

1. **Keep Pull Requests Focused**

   - Limit PRs to a single feature or bug fix
   - Split larger changes into smaller, related PRs
   - Break changes into logical commits that can be reviewed independently

2. **Code Quality**

   - This project is `NodeNext` ESM (`"type": "module"`), so relative imports need the `.js`
     extension even though the source is TypeScript — `import { thing } from './thing.js'`, not
     `'./thing'`. This is the single most common thing that breaks a first build.
   - `strict` is on. Reach for precise types and avoid `any`.
   - Strip stray `console.log` calls before you push
   - Never commit secrets, API keys, real home paths, personal names, or internal planning
     terminology

3. **Testing**

   - Add tests for new features — cover the behaviour, not just the happy path
   - For a bug fix, add a test that **fails before your fix and passes after it**, and say so in
     the PR
   - If your change alters existing behaviour, update the affected tests and explain in the PR
     why the old assertion was wrong. Do not silently delete an assertion to make a run go green.
   - New content templates must satisfy both build gates (schema + level-1 floor) and be
     reachable by a realistic prompt, or the build will reject them
   - `src/readme.test.ts` asserts what the README must contain and must not leak — run it if you
     edit the README
   - Place tests next to the code as `<module>.test.ts`; there is no separate `test/` tree. The
     existing suite is unusually explicit about what each test proves — matching that style makes
     review much faster.
   - The suite redirects the Nexpath home to a temp directory (`vitest.setup.ts`), so running
     tests never touches your real install. Manual CLI runs **do**.

4. **Run the Checks**

   - Run everything in [Common Checks](#common-checks) before you push
   - All checks must pass locally, because nothing will run them for you afterwards

5. **Commit Guidelines**

   - Write clear, descriptive commit messages
   - Use conventional commit format (e.g. `feat:`, `fix:`, `docs:`)
   - Reference relevant issues using `#issue-number`

6. **Before Submitting**

   - Rebase your branch on the latest `upstream/main`
   - Ensure your branch builds successfully
   - Double-check the test run against the expected counts above
   - Review your changes for any debugging code or leftover logs

7. **Pull Request Description**

   - Clearly describe what your changes do and why
   - Include how you verified them
   - List any breaking changes
   - Add screenshots for CLI or popup UI changes

---

## Pull Request Expectations

Contributor guidance exists to protect maintainer review time and keep reviews focused on work
that is ready to evaluate.

- **UI Changes:** Include screenshots or a short recording (before/after)
- **Logic Changes:** Explain how you verified it works

Link the issue with `Fixes #123` or `Closes #123`, and open the PR against `main` on
[`hi0001234d/nexpath`](https://github.com/hi0001234d/nexpath).

### Testing Evidence

Every PR marked ready for review must include testing evidence. A bare `Not tested` or `N/A` is
not sufficient, and neither is "the tests should pass."

Paste the actual output of the commands in [Common Checks](#common-checks) — at minimum the
build, the typecheck, the test run with its file and test counts, and the leak-guard comparison
against `main`. For a bug fix, include the failing-then-passing test name.

If you cannot complete a relevant command, include all three of the following in the PR:

- The command you attempted or would normally run
- The blocker or failure that prevented completion
- The substitute verification you performed instead

Agent limitations, local resource constraints, or an agent prompt that says to skip tests do not
waive this requirement — they just change what you write down. Draft PRs may be incomplete until
they are marked ready for review.

### Contribution Ownership and AI Assistance

AI coding agents are allowed — Nexpath is built for people who use them, and this repo is
developed with them. But contributors own the work they submit.

Before requesting review, make sure you personally understand the change, have tested it
appropriately, can explain the diff, and understand how it interacts with the rest of the
pipeline.

Maintainers may close PRs that appear to be submitted without credible contributor ownership or
understanding, including AI-assisted work the contributor cannot explain or has not meaningfully
reviewed.

### Tracker Use and Automation

Do not submit batches of agent-generated, untested, or weakly reviewed PRs. Prioritize
high-impact issues instead of opening many speculative fixes.

For issues, do not mass-create tickets through automation. Search existing issues first, open
issues only when you have enough context for someone to act, and prioritize the most important
reports instead of filing every possible finding.

### Issue and PR Lifecycle

To keep the backlog manageable, inactive issues and PRs may be closed after a period of
inactivity. This isn't a judgment on quality — older items lose context over time. Feel free to
reopen or create a new issue or PR if you're still working on something.

Please respond to review comments rather than force-pushing silently over them.

---

## PR Titles

Use conventional commit style PR titles, with an optional scope naming the subsystem:

- `feat(agents): detect Cursor installations on Windows`
- `fix(pe): lower the PE/MPS-1 popup cooldown default`
- `docs: clarify the known-failing test files`
- `chore: bump TypeScript to 5.8`
- `refactor(store): extract the prune path`
- `test(pe-host): cover the display-decision pre-spawn gate`

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`.

---

## Questions

**If anything here is unclear, ask — that is not a bother, it is the point.**

- **[GitHub Discussions](https://github.com/hi0001234d/nexpath/discussions)** — open-ended
  questions, design conversations, "is this a bug or am I holding it wrong?", and feedback on
  your experience installing or using Nexpath. There is a feedback template set up for this.
- **[GitHub Issues](https://github.com/hi0001234d/nexpath/issues)** — concrete bugs and specific
  feature proposals.
- **On a PR** — if you get stuck mid-implementation, open a draft PR and ask there. Showing the
  code you are stuck on gets a much better answer than describing it.

You do not need to have a fix ready to start a conversation. If you tried Nexpath and could not
tell what it does, or the install broke, or a section of the README confused you — tell us. That
is signal we cannot get any other way, and it is a real contribution.

New to pull requests? [makeapullrequest.com](https://makeapullrequest.com/) and
[firsttimersonly.com](https://www.firsttimersonly.com/) are good primers.

---

## Contribution Agreement

By submitting a pull request, you agree that your contributions will be licensed under the same
license as the project ([Apache 2.0](LICENSE)).

Contributing to Nexpath isn't just about writing code — it's about being part of a community
trying to make AI-assisted development something you can actually ship with confidence. Let's
build something reliable together.
