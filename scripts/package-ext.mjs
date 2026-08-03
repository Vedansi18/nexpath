// Package the browser extension into store-ready zips.
//
// Produces:
//   dist/store-packages/nexpath-chrome-<version>.zip   (Chrome Web Store / Edge Add-ons)
//   dist/store-packages/nexpath-firefox-<version>.zip  (Firefox AMO)
//
// Guarantees the two mistakes we care about can't happen:
//   1. STALE ARTIFACTS — dist/ext-* is wiped before building, so leftover files
//      from an old build (e.g. the removed offscreen/ folder) never ship.
//   2. VERSION DRIFT — the version is read from the manifest (the single source
//      of truth for the EXTENSION; the root package.json is the CLI's version and
//      is deliberately independent). chrome vs firefox manifest versions must match
//      or packaging aborts.
//
// Requires the `zip` CLI (present on Linux/macOS and the CI ubuntu runner).

import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'store-packages');
const SRC = path.join(ROOT, 'src', 'ext-browser');

function manifestVersion(file) {
  return JSON.parse(readFileSync(path.join(SRC, file), 'utf8')).version;
}

const chromeVersion = manifestVersion('manifest.chrome.json');
const firefoxVersion = manifestVersion('manifest.firefox.json');

if (chromeVersion !== firefoxVersion) {
  console.error(
    `[package-ext] ABORT — manifest version drift: chrome ${chromeVersion} vs firefox ${firefoxVersion}.\n` +
    `  Set the SAME version in src/ext-browser/manifest.chrome.json and manifest.firefox.json before packaging.`,
  );
  process.exit(1);
}
const version = chromeVersion;

// 1. Clean build — wipe dist/ext-* first so no stale artifact can ship.
console.log('[package-ext] clean build (wiping dist/ext-*)…');
rmSync(path.join(DIST, 'ext-chrome'), { recursive: true, force: true });
rmSync(path.join(DIST, 'ext-firefox'), { recursive: true, force: true });
execSync('node scripts/build-ext.mjs', { cwd: ROOT, stdio: 'inherit' });

// 2. Zip each target — manifest.json MUST be at the zip root (store requirement).
mkdirSync(OUT, { recursive: true });
for (const [dir, label] of [['ext-chrome', 'chrome'], ['ext-firefox', 'firefox']]) {
  const buildDir = path.join(DIST, dir);
  if (!existsSync(path.join(buildDir, 'manifest.json'))) {
    console.error(`[package-ext] ABORT — ${buildDir}/manifest.json missing (build failed?).`);
    process.exit(1);
  }
  const zip = path.join(OUT, `nexpath-${label}-${version}.zip`);
  rmSync(zip, { force: true });
  // `cd` into the build dir so manifest.json sits at the zip root, not under a folder.
  execSync(`cd "${buildDir}" && zip -r -q -X "${zip}" .`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log(`[package-ext] ${label.padEnd(7)} → ${path.relative(ROOT, zip)}`);
}

console.log(`[package-ext] done — version ${version}`);
