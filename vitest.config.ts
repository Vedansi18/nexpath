import { defineConfig, configDefaults } from 'vitest/config';

// Config for Phases P4 + P5:
//  - setupFiles redirects the nexpath home to a temp dir so tests never mutate the real ~/.nexpath (P4).
//  - globalSetup's returned teardown removes those temp dirs once, after the whole run (P4).
//  - exclude src/ext-vscode/** (P5): that sub-package has its own package.json + native better-sqlite3
//    dependency and is not installed at the root, so the root `tsconfig.json` already excludes it; the
//    root test run must exclude it too, or it fails with "Cannot find package 'better-sqlite3'".
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    exclude: [...configDefaults.exclude, 'src/ext-vscode/**'],
  },
});
