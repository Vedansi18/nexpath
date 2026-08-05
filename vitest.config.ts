import { defineConfig } from 'vitest/config';

// Minimal config for Bug 5 / Phase P4:
//  - setupFiles redirects the nexpath home to a temp dir so tests never mutate the real ~/.nexpath.
//  - globalSetup's returned teardown removes those temp dirs once, after the whole run.
// Test discovery keeps vitest's defaults — the ext-vscode exclusion and POSIX-portability work is P5.
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
