import { defineConfig } from 'vitest/config';

// `src/ext-vscode` is its own npm package (own `package.json`, own `tsconfig.json`,
// no `workspaces` field at the root) and its test run is always invoked from
// inside this directory (`cd src/ext-vscode && npm test`).
//
// Vitest resolves config by walking UP from the current working directory when
// no local config file exists — so without this file, `vitest run` here found
// the ROOT's `vitest.config.ts` (added for the root suite's own P4/P5 needs) and
// tried to load its `setupFiles`/`globalSetup`, whose relative paths resolve
// against the root, not this directory — a hard crash with zero tests collected
// (`Failed to load url .../src/ext-vscode/vitest.global-setup.ts`).
//
// This file's only job is to exist, so vitest stops the walk-up here. It
// intentionally carries none of the root config's `setupFiles`/`globalSetup`/
// `exclude` — this package needs none of them (it already redirects nexpath
// paths per-test via dependency injection, never touches the real `~/.nexpath`).
export default defineConfig({});
