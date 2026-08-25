# Contributing to Nexpath

We're glad you're here. Whether you're fixing a bug, certifying a new agent, or improving the
docs, every contribution makes Nexpath more trustworthy.

New here? Read the [README](README.md) first — it covers what Nexpath does and how to install it.
This guide covers what you need in order to *change* it.

## Ways to Contribute

- **End-to-end agent testing** — verify Nexpath against agents we have not certified yet
- **Code** — fix bugs, improve the pipeline, add agent support
- **Documentation** — the README, this guide, or the CLI help text
- **Bug reports and feature requests** — through
  [Issues](https://github.com/hi0001234d/nexpath/issues)
- **Community support** — help other users in
  [Discussions](https://github.com/hi0001234d/nexpath/discussions)

## Reporting Bugs or Issues

[Search existing issues](https://github.com/hi0001234d/nexpath/issues) first to avoid duplicates,
then [open a new one](https://github.com/hi0001234d/nexpath/issues/new).

> 🔐 **Important:** If you discover a security vulnerability, please use the
> [GitHub security tool to report it privately](https://github.com/hi0001234d/nexpath/security/advisories/new)
> instead of opening a public issue.

A great bug report contains:

- **A quick summary** of what you were doing
- **Your environment** — OS, Node version, Nexpath version, and which AI coding agent
- **Steps to reproduce** — the actual prompt or command, not a description of it
- **Expected vs. actual** — with the exact error text
- **Diagnostics** — output of `nexpath status`, plus `nexpath log` for advisory or popup issues.
  Re-run with `NEXPATH_DEBUG=1` for verbose stderr.

⚠️ `nexpath status` dumps your full config and `nexpath log` may include your own prompts — read
both before pasting them publicly and redact anything private.

## Before You Start

- All contributions begin with a GitHub Issue — except typos, small bug fixes, minor wording
  changes, and type-only fixes.
- For features, check [Issues](https://github.com/hi0001234d/nexpath/issues) and Discussions for
  similar ideas first.
- If your idea is new, open an issue with the problem, your approach, and why it belongs in
  Nexpath.
- Wait for maintainer approval before implementing. **PRs without approved issues may be
  closed** — Nexpath's pipeline has interlocking gates, and a local-looking change can move
  behaviour three stages downstream.

New contributors: start with
[`good first issue`](https://github.com/hi0001234d/nexpath/labels/good%20first%20issue) or
[`help wanted`](https://github.com/hi0001234d/nexpath/labels/help%20wanted). Beyond the tracker,
these areas need help most:

- **End-to-end agent testing** — highest value, no deep codebase knowledge needed. Only Claude
  Code is certified today; the README's support table lists the rest. Install Nexpath against
  another agent, run real prompts through it, and report exactly what happened.
- **Cross-platform verification** — Nexpath touches OS credential storage and writes local state,
  so it breaks in platform-specific ways. Windows reports are especially useful.
- **Pipeline correctness** — `src/prompt-enhancement/` and `src/decision-session/` carry most of
  the product behaviour and most of the test suite.

## Development Setup

Requirements:

- **Node.js 18+** — development happens on Node 20+; Node 22 is known to work
- **npm 9+** — ships with Node 18 and newer
- **git**

Nothing else is needed for the core CLI — TypeScript, `tsx`, and `vitest` come from
`devDependencies`.

Install steps are in the
[README](README.md#add-nexpath-to-your-development-workflow--installation). Clone **your fork**, not
the canonical repo, and add the original as `upstream` so you can rebase later:

```bash
git remote add upstream https://github.com/hi0001234d/nexpath.git
npm install
```

## Common Checks

**Read this before you open a PR.** Nexpath does **not** run tests on pull requests — the GitHub
Actions workflows only fire on release tags, so **your local run is the only gate that exists.**

```bash
npm run build          # includes the prebuild gates
npm run typecheck      # core CLI + server
npm test               # vitest run, whole tree
npm run pe:leak-guard  # read-only confidentiality scan
```

**Build** — `prebuild` runs `scripts/check-build-gate.ts` and aborts on two hard gates:

- **Content-template gate** — every shipped record must be schema-valid and have a level-1 floor.
- **Selectability gate** — every prompt-enhancement intent must be reachable by a realistic prompt
  through the production router.
- If the build aborts on a template you touched, fix the record — do not bypass the gate.

**Typecheck** — both commands must produce no output:

- `npm run typecheck` covers the core CLI and server.
- `npm run typecheck:ext` covers `src/ext-browser/` (excluded from the root `tsconfig.json`) —
  mandatory if you touched that directory.

**Tests** — `npm test` takes a minute or two:

- On a clean public clone it exits **1**: two files read planning documents from a private submodule
  and fail with `ENOENT` for reasons unrelated to your change —
  `src/prompt-enhancement/dev-plan-table-integrity.test.ts` and
  `src/prompt-enhancement/hv1-env-supply.test.ts`.
- **These two are the only accepted failures.** Exclude exactly those for a clean signal:

  ```bash
  npx vitest run \
    --exclude "src/prompt-enhancement/dev-plan-table-integrity.test.ts" \
    --exclude "src/prompt-enhancement/hv1-env-supply.test.ts" \
    --exclude "**/node_modules/**" \
    --exclude "src/ext-vscode/**"
  ```

- On an unmodified `main` that run reports zero failures. Never add files to the exclude list to
  make a run go green.

**Leak guard** — `npm run pe:leak-guard` fails on confidentiality leak tokens (internal names,
phase codes, private paths) in public-going prompt-enhancement files:

- It is not clean on `main` today; those findings are known and tracked.
- Run it before and after your change and confirm your diff **adds no new findings**.

**Sub-packages** — `src/ext-vscode/` is excluded from the root build, typecheck, and test run; it
is a separate npm package with a native dependency:

```bash
cd src/ext-vscode
npm install && npm run typecheck && npm run test && npm run build
```

`src/ext-browser/` is different — its tests run in the root suite, its types do not. Build it with
`npm run build:ext`.

## Writing and Submitting Code

1. **Keep pull requests focused**

    - One feature or bug fix per PR; split larger work into related PRs
    - Break changes into logical commits that can be reviewed independently

2. **Code quality**

    - This project is `NodeNext` ESM (`"type": "module"`), so relative imports need the `.js`
      extension even in TypeScript — `import { thing } from './thing.js'`. This is the single most
      common thing that breaks a first build.
    - `strict` is on — use precise types, avoid `any`
    - Strip stray `console.log` calls before you push
    - Never commit secrets, API keys, real home paths, personal names, or internal planning
      terminology

3. **Testing**

    - Add tests for new features — cover the behaviour, not just the happy path
    - For a bug fix, add a test that **fails before your fix and passes after it**
    - If you change existing behaviour, update the affected tests and explain why the old assertion
      was wrong
    - New content templates must satisfy both build gates and be reachable by a realistic prompt
    - `src/readme.test.ts` asserts what the README must contain — run it if you edit the README
    - Place tests next to the code as `<module>.test.ts`; there is no separate `test/` tree
    - The suite redirects the Nexpath home to a temp directory (`vitest.setup.ts`), so tests never
      touch your real install. Manual CLI runs **do**.

4. **Commits and PR titles**

    - Use conventional commits with an optional subsystem scope:
      `feat(agents): detect Cursor installations on Windows`,
      `fix(pe): lower the PE/MPS-1 popup cooldown default`
    - Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`
    - Reference issues with `#issue-number`

5. **Testing evidence** — required on every PR marked ready for review

    - Paste the **actual output** of the [Common Checks](#common-checks) — at minimum build,
      typecheck, tests, and the leak-guard comparison against `main`
    - For a bug fix, include the failing-then-passing test name
    - `Not tested`, `N/A`, and "the tests should pass" are not sufficient
    - If a command is blocked, state the command, the blocker, and the substitute verification you
      ran instead
    - Draft PRs may be incomplete until marked ready for review

6. **AI assistance and ownership**

    - AI coding agents are allowed — Nexpath is built for people who use them and developed with
      them
    - Before requesting review, make sure you understand the change, have tested it, and can explain
      the diff
    - Maintainers may close PRs without credible contributor ownership, including AI-assisted work
      the contributor cannot explain
    - Please don't submit batches of agent-generated or untested PRs, or mass-create issues through
      automation

7. **Before submitting**

    - Rebase on the latest `upstream/main`
    - Run everything in [Common Checks](#common-checks) — nothing will run it for you afterwards
    - Review your diff for debugging code and leftover logs
    - Describe what the change does, why, how you verified it, and any breaking changes. Add
      screenshots or a short recording for CLI or popup UI changes.
    - Link the issue with `Fixes #123`, and open the PR against `main` on
      [`hi0001234d/nexpath`](https://github.com/hi0001234d/nexpath)

## Questions

**If anything here is unclear, ask — that is not a bother, it is the point.**

- **[Discussions](https://github.com/hi0001234d/nexpath/discussions)** — open-ended questions,
  design conversations, feedback on installing or using Nexpath
- **[Issues](https://github.com/hi0001234d/nexpath/issues)** — concrete bugs and specific feature
  proposals
- **On a draft PR** — if you get stuck mid-implementation

You don't need a fix ready to start a conversation. If the install broke or a section of the README
confused you, tell us — that is signal we cannot get any other way.

## Contribution Agreement

By submitting a pull request, you agree that your contributions will be licensed under the same
license as the project ([Apache 2.0](LICENSE)).
