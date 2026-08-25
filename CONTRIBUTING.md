# Contributing to Nexpath

Read the [README](README.md) first — it covers what Nexpath does and how to install it. This guide
covers how to change it.

## Ways to Contribute

- **End-to-end agent testing** — run Nexpath against an agent the README lists as uncertified and
  report what happened. No codebase knowledge needed.
- **Code** — bug fixes, pipeline work, new agent support
- **Docs** — the README, this guide, or the CLI help text
- **Reports** — [Issues](https://github.com/hi0001234d/nexpath/issues) for bugs and features,
  [Discussions](https://github.com/hi0001234d/nexpath/discussions) for everything else

## Reporting Bugs

[Search existing issues](https://github.com/hi0001234d/nexpath/issues) first, then
[open a new one](https://github.com/hi0001234d/nexpath/issues/new) with:

- OS, Node version, Nexpath version, and which AI coding agent
- The exact prompt or command that reproduces it
- What you expected, and the actual error text
- Output of `nexpath status` — plus `nexpath log` for advisory or popup issues
  (`NEXPATH_DEBUG=1` for verbose stderr)

> ⚠️ `nexpath status` dumps your config and `nexpath log` may contain your prompts — redact before
> pasting.

## Before You Start

- Open an issue first — except typos, small bug fixes, and type-only changes
- State the problem, your approach, and why it belongs in Nexpath
- Wait for maintainer approval. **PRs without an approved issue may be closed.**

## Common Checks

Nexpath runs **no CI on pull requests** — your local run is the only gate.

```bash
npm run build          # prebuild gates: content-template + selectability
npm run typecheck      # core CLI + server
npm run typecheck:ext  # required if you touched src/ext-browser/
npm test               # vitest, whole tree
```

Two things that trip people up:

- **Build gates** — a content template that is schema-invalid, missing its level-1 floor, or
  unreachable by a realistic prompt aborts the build. Fix the record; don't bypass the gate.
- **`src/ext-vscode/`** — a separate package, excluded from every root check. Run its own
  `npm install && npm run typecheck && npm run test && npm run build`.

`npm test` also exits 1 on a public clone: two files read a private submodule and fail with
`ENOENT`. They are the only accepted failures — exclude exactly those two to see whether your own
change passes, and never add anything else to the list:

```bash
npx vitest run \
  --exclude "src/prompt-enhancement/dev-plan-table-integrity.test.ts" \
  --exclude "src/prompt-enhancement/hv1-env-supply.test.ts" \
  --exclude "**/node_modules/**" \
  --exclude "src/ext-vscode/**"
```

## Pull Requests

- One feature or fix per PR, split into logical commits
- Conventional commit titles — `fix(pe): lower the popup cooldown default`
- Relative imports need the `.js` extension (`NodeNext` ESM) — the most common first-build failure
- `strict` is on: no `any`, no stray `console.log`
- Never commit secrets, API keys, real home paths, or internal planning terminology
- Tests live next to the code as `<module>.test.ts` — a bug fix needs one that fails before the fix
  and passes after
- Rebase on the latest `main`, target `main`, and link the issue with `Fixes #123`
- **Paste real command output as testing evidence.** "Should pass" is not evidence. If a check is
  blocked, say which one, why, and what you ran instead.
- **You own what you submit** — AI agents are welcome, but you must understand the diff and be able
  to explain it

## Contribution Agreement

By submitting a pull request, you agree that your contributions are licensed under the project's
[Apache 2.0](LICENSE) license.
