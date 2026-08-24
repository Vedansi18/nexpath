# Contributing to Nexpath

We're glad you're here. Whether you're fixing a bug, certifying a new agent, or improving the
docs, every contribution makes Nexpath more trustworthy.

New here? Read the [README](README.md) first — it covers what Nexpath does, how to install it,
and how it handles your data. This guide covers what you need in order to *change* it.

## Ways to Contribute

- **Code Contributions:** Fix bugs, improve the pipeline, add agent support
- **End-to-End Agent Testing:** Verify Nexpath against agents we have not certified yet
- **Documentation:** Improve the README, this guide, or the CLI help text
- **Bug Reports:** Report issues you encounter
- **Feature Requests:** Suggest new features or improvements
- **Community Support:** Help other users in the community

The Nexpath community is in
[GitHub Discussions](https://github.com/hi0001234d/nexpath/discussions).

## Reporting Bugs or Issues

Before creating a new issue, please
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

`nexpath status` prints a full config dump and `nexpath log` prints recent pipeline activity,
which may include your own prompts — read both before pasting them publicly and redact anything
private.

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

**PRs without approved issues may be closed.** Nexpath's pipeline has a lot of interlocking
gates, and a change that looks local can move behaviour three stages downstream.

## Deciding What to Work On

Looking for a good first contribution? Check out issues labeled
[`good first issue`](https://github.com/hi0001234d/nexpath/labels/good%20first%20issue) or
[`help wanted`](https://github.com/hi0001234d/nexpath/labels/help%20wanted).

Beyond the issue tracker, these areas need help most right now:

- **End-to-end agent testing** — highest value, no deep codebase knowledge needed. Only Claude
  Code is certified end-to-end today; the README's support table lists the rest. Install Nexpath
  against another agent, run real prompts through it, and report exactly what happened.
- **Cross-platform verification** — Nexpath touches OS-level credential storage and writes local
  state, so it breaks in platform-specific ways. Windows reports are especially useful.
- **Pipeline correctness** — `src/prompt-enhancement/` and `src/decision-session/` carry most of
  the product behaviour and most of the test suite.

## Prerequisites

- **Node.js 18+** — development is done on Node 20+; Node 22 is known to work
- **npm 9+** — ships with Node 18 and newer
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

- **Content-template gate** — every shipped record must be schema-valid and must have a level-1
  floor. A record missing its floor fails the build.
- **Selectability gate** — every prompt-enhancement intent must be reachable by a realistic
  prompt through the production router. An intent no prompt can reach is a dead template.

If you added or edited a content template and the build aborts, fix the record — do not bypass
the gate.

### Typecheck

```bash
npm run typecheck        # core CLI + server
npm run typecheck:ext    # browser extension (tsconfig.ext-browser.json)
```

Both must produce no output. The root `tsconfig.json` deliberately excludes `src/ext-vscode` and
`src/ext-browser`, so if you touched `src/ext-browser/`, the second command is mandatory.

### Tests

`npm test` runs `vitest run` across the whole tree. It takes a minute or two.

**Known failures on a public clone.** On a clean clone, `npm test` exits **1**. Two test files
fail:

- `src/prompt-enhancement/dev-plan-table-integrity.test.ts`
- `src/prompt-enhancement/hv1-env-supply.test.ts`

Both read planning documents from a private submodule that is **not part of the public
repository**, so they fail with `ENOENT` for reasons unrelated to your change. **These two files
are the only accepted failures.** To get a clean signal, exclude exactly those two:

```bash
npx vitest run \
  --exclude "src/prompt-enhancement/dev-plan-table-integrity.test.ts" \
  --exclude "src/prompt-enhancement/hv1-env-supply.test.ts" \
  --exclude "**/node_modules/**" \
  --exclude "src/ext-vscode/**"
```

On an unmodified `main`, that run reports zero failures. **Every remaining file must pass.** Do
not add files to the exclude list to make a run go green.

### Leak guard

`npm run pe:leak-guard` is a read-only scan that fails if any public-going prompt-enhancement
file contains a confidentiality leak token (internal names, internal phase codes, private
paths).

It does not come back clean on `main` today. The existing findings are known and tracked. Run it
before and after your change and confirm your diff **adds no new findings**.

### Sub-package checks

`src/ext-vscode/` is excluded from the root typecheck, the root build, **and** the root test run
(`vitest.config.ts`) — it's a separate npm package with a native dependency not installed at the
root:

```bash
cd src/ext-vscode
npm install
npm run typecheck
npm run test
npm run build
```

`src/ext-browser/` is different: its tests **do** run in the root suite, but its types do not —
that's what `npm run typecheck:ext` is for. To build it: `npm run build:ext`.

## Writing and Submitting Code

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
     why the old assertion was wrong
   - New content templates must satisfy both build gates and be reachable by a realistic prompt
   - `src/readme.test.ts` asserts what the README must contain — run it if you edit the README
   - Place tests next to the code as `<module>.test.ts`; there is no separate `test/` tree
   - The suite redirects the Nexpath home to a temp directory (`vitest.setup.ts`), so running
     tests never touches your real install. Manual CLI runs **do**.

4. **Run the Checks**

   - Run everything in [Common Checks](#common-checks) before you push — nothing will run them
     for you afterwards

5. **Commit Guidelines**

   - Write clear, descriptive commit messages
   - Use conventional commit format (e.g. `feat:`, `fix:`, `docs:`)
   - Reference relevant issues using `#issue-number`

6. **Before Submitting**

   - Rebase your branch on the latest `upstream/main`
   - Confirm the build, both typechecks, and the test run are clean
   - Review your changes for any debugging code or leftover logs

7. **Pull Request Description**

   - Clearly describe what your changes do and why
   - Include how you verified them
   - List any breaking changes
   - Add screenshots for CLI or popup UI changes

## Pull Request Expectations

- **UI Changes:** Include screenshots or a short recording (before/after)
- **Logic Changes:** Explain how you verified it works

Link the issue with `Fixes #123` or `Closes #123`, and open the PR against `main` on
[`hi0001234d/nexpath`](https://github.com/hi0001234d/nexpath).

### Testing Evidence

Every PR marked ready for review must include testing evidence. A bare `Not tested` or `N/A` is
not sufficient, and neither is "the tests should pass."

Paste the actual output of the commands in [Common Checks](#common-checks) — at minimum the
build, the typecheck, the test run, and the leak-guard comparison against `main`. For a bug fix,
include the failing-then-passing test name.

If you cannot complete a relevant command, include all three of the following in the PR:

- The command you attempted or would normally run
- The blocker or failure that prevented completion
- The substitute verification you performed instead

Draft PRs may be incomplete until they are marked ready for review.

### Contribution Ownership and AI Assistance

AI coding agents are allowed — Nexpath is built for people who use them, and this repo is
developed with them. But contributors own the work they submit: before requesting review, make
sure you personally understand the change, have tested it, and can explain the diff.

Maintainers may close PRs that appear to be submitted without credible contributor ownership,
including AI-assisted work the contributor cannot explain.

### Tracker Use and Automation

Do not submit batches of agent-generated, untested, or weakly reviewed PRs, and do not
mass-create issues through automation. Search existing issues first, and prioritize high-impact
work over many speculative fixes.

### Issue and PR Lifecycle

Inactive issues and PRs may be closed to keep the backlog manageable — feel free to reopen or
open a new one if you're still working on something. Please respond to review comments rather
than force-pushing silently over them.

## PR Titles

Use conventional commit style PR titles, with an optional scope naming the subsystem:

- `feat(agents): detect Cursor installations on Windows`
- `fix(pe): lower the PE/MPS-1 popup cooldown default`
- `docs: clarify the known-failing test files`
- `test(pe-host): cover the display-decision pre-spawn gate`

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`.

## Questions

**If anything here is unclear, ask — that is not a bother, it is the point.**

- **[GitHub Discussions](https://github.com/hi0001234d/nexpath/discussions)** — open-ended
  questions, design conversations, and feedback on installing or using Nexpath
- **[GitHub Issues](https://github.com/hi0001234d/nexpath/issues)** — concrete bugs and specific
  feature proposals
- **On a PR** — if you get stuck mid-implementation, open a draft PR and ask there

You do not need to have a fix ready to start a conversation. If the install broke or a section
of the README confused you, tell us — that is signal we cannot get any other way.

## Contribution Agreement

By submitting a pull request, you agree that your contributions will be licensed under the same
license as the project ([Apache 2.0](LICENSE)).
