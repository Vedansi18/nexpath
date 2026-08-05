import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Bug 5 / Phase P4: reliably clean up the per-worker temp homes that vitest.setup.ts created. This
// runs once in the MAIN process after the whole run (a per-worker `process.on('exit')` is unreliable
// because vitest terminates workers). Only our own `nexpath-test-home-` prefix is removed.
export default function globalSetup(): () => void {
  return () => {
    const base = tmpdir();
    try {
      for (const name of readdirSync(base)) {
        if (name.startsWith('nexpath-test-home-')) {
          try {
            rmSync(join(base, name), { recursive: true, force: true });
          } catch {
            // best-effort — a leftover temp dir must never fail the run
          }
        }
      }
    } catch {
      // best-effort
    }
  };
}
