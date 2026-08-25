# Contributing to Nexpath

Read the [README](README.md) first — it covers what Nexpath does and how to install it. This guide
covers how to change it.

## Ways to Contribute

- **End-to-end agent testing** — run Nexpath against agents we have not certified yet
- **Code** — bug fixes, pipeline work, new agent support
- **Docs** — the README, this guide, or the CLI help text
- **Reports** — [Issues](https://github.com/hi0001234d/nexpath/issues) for bugs and features,
  [Discussions](https://github.com/hi0001234d/nexpath/discussions) for everything else

> Only Claude Code is certified end-to-end today. Testing another agent from the README's support
> table is the highest-value contribution, and needs no codebase knowledge.

## Reporting Bugs

[Search existing issues](https://github.com/hi0001234d/nexpath/issues) first, then
[open a new one](https://github.com/hi0001234d/nexpath/issues/new) with:

- OS, Node version, Nexpath version, and which AI coding agent
- The exact prompt or command that reproduces it
- What you expected, and the actual error text
- Output of `nexpath status` — plus `nexpath log` for advisory or popup issues
  (`NEXPATH_DEBUG=1` for verbose stderr)

> 🔐 Found a security vulnerability?
> [Report it privately](https://github.com/hi0001234d/nexpath/security/advisories/new), not in a
> public issue.
>
> ⚠️ `nexpath status` dumps your config and `nexpath log` may contain your prompts — redact before
> pasting.

## Before You Start

- Open an issue first — except typos, small bug fixes, and type-only changes
- State the problem, your approach, and why it belongs in Nexpath
- Wait for maintainer approval. **PRs without an approved issue may be closed.**
- New here? Start with
  [`good first issue`](https://github.com/hi0001234d/nexpath/labels/good%20first%20issue) or
  [`help wanted`](https://github.com/hi0001234d/nexpath/labels/help%20wanted)

## Development Setup

Node.js 18+ (20+ recommended), npm 9+, and git. Everything else comes from `devDependencies`.

Fork the repo, then:

```bash
git clone https://github.com/<your-username>/nexpath.git
cd nexpath
npm install
git remote add upstream https://github.com/hi0001234d/nexpath.git
```

Build and link steps are in the
[README](README.md#add-nexpath-to-your-development-workflow--installation).

## Common Checks

Nexpath runs **no CI on pull requests** — your local run is the only gate.

```bash
npm run build          # prebuild gates: content-template + selectability
npm run typecheck      # core CLI + server
npm run typecheck:ext  # required if you touched src/ext-browser/
npm test               # vitest, whole tree
npm run pe:leak-guard  # confidentiality scan
```

Expected behaviour before you debug your own change:

- **Build gates** — a content template that is schema-invalid, missing its level-1 floor, or
  unreachable by a realistic prompt aborts the build. Fix the record; don't bypass the gate.
- **Tests** — two files fail with `ENOENT` on a public clone because they read a private submodule.
  These are the only accepted failures.
- **Leak guard** — not clean on `main` today. Run it before and after your change; your diff must
  add no new findings.
- **`src/ext-vscode/`** — a separate package, excluded from every root check. Run its own
  `npm install && npm run typecheck && npm run test && npm run build`.

For a clean test signal:

```bash
npx vitest run \
  --exclude "src/prompt-enhancement/dev-plan-table-integrity.test.ts" \
  --exclude "src/prompt-enhancement/hv1-env-supply.test.ts" \
  --exclude "**/node_modules/**" \
  --exclude "src/ext-vscode/**"
```

Never add files to that exclude list to make a run go green.

## Pull Requests

- One feature or fix per PR, split into logical commits
- Conventional commit titles — `fix(pe): lower the popup cooldown default`
- Relative imports need the `.js` extension (`NodeNext` ESM) — the most common first-build failure
- `strict` is on: no `any`, no stray `console.log`
- Never commit secrets, API keys, real home paths, or internal planning terminology
- Tests live next to the code as `<module>.test.ts` — a bug fix needs one that fails before the fix
  and passes after
- Rebase on `upstream/main`, target `main`, and link the issue with `Fixes #123`
- **Paste real command output as testing evidence.** "Should pass" is not evidence. If a check is
  blocked, say which one, why, and what you ran instead.

> AI agents are welcome — Nexpath is built with them. But you own what you submit: you must
> understand the diff and be able to explain it.

## Contribution Agreement

By submitting a pull request, you agree that your contributions are licensed under the project's
[Apache 2.0](LICENSE) license.
