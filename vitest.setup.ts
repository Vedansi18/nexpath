import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Bug 5 / Phase P4: redirect the nexpath home to an isolated temp dir so the test suite NEVER writes
// into the real ~/.nexpath (nexpath.log, telemetry.jsonl, hook-stats.json, prompt-store.db, sync.lock
// — all resolved as `join(homedir(), '.nexpath', ...)` module-level constants).
//
// setupFiles run before the test file's imports, and this file imports only node builtins, so no
// nexpath path constant is evaluated before HOME is redirected. os.homedir() honours $HOME on POSIX
// and %USERPROFILE% on Windows. The temp dirs are removed after the whole run by the globalSetup
// teardown in vitest.global-setup.ts (vitest kills workers, so a per-worker exit handler is not
// reliable). The `nexpath-test-home-` prefix is what that teardown matches.
const testHome = process.env.__NEXPATH_TEST_HOME__ ?? mkdtempSync(join(tmpdir(), 'nexpath-test-home-'));
process.env.__NEXPATH_TEST_HOME__ = testHome;
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
