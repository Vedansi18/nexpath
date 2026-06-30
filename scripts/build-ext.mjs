/**
 * Build script for the browser extension (Chrome MV3 + Firefox MV3).
 *
 * Outputs:
 *   dist/ext-chrome/  — Chrome unpacked extension
 *   dist/ext-firefox/ — Firefox unpacked extension
 *
 * Run:  node scripts/build-ext.mjs
 * Watch: node scripts/build-ext.mjs --watch
 */

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'src', 'ext-browser');

const watch = process.argv.includes('--watch');
const targets = ['chrome', 'firefox'];

/** Common esbuild options for every bundle entry point. */
const commonOpts = {
  bundle:    true,
  format:    /** @type {'esm'} */ ('esm'),
  target:    'es2022',
  sourcemap: 'inline',
  minify:    false,
};

/** Entry points that appear in every target. */
const commonEntries = [
  { in: path.join(SRC, 'background', 'service-worker.ts'), out: 'service-worker' },
  { in: path.join(SRC, 'content',    'main-world-injector.ts'), out: 'content/main-world-injector' },
  { in: path.join(SRC, 'content',    'inject.ts'),              out: 'content/inject' },
  { in: path.join(SRC, 'inject',     'main-world.ts'),          out: 'inject/main-world' },
  { in: path.join(SRC, 'offscreen',  'offscreen.ts'),           out: 'offscreen/offscreen' },
  { in: path.join(SRC, 'options',    'options.ts'),             out: 'options/options' },
];

/**
 * Static files to copy verbatim into the dist folder.
 * [src relative to SRC, dst relative to dist/<target>/]
 */
const staticFiles = [
  ['offscreen/offscreen.html', 'offscreen/offscreen.html'],
  ['options/options.html',     'options/options.html'],
  ['options/options.css',      'options/options.css'],
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function writeJson(dst, obj) {
  ensureDir(path.dirname(dst));
  fs.writeFileSync(dst, JSON.stringify(obj, null, 2) + '\n');
}

async function buildTarget(target) {
  const outDir = path.join(ROOT, 'dist', `ext-${target}`);
  ensureDir(outDir);

  // ── Copy manifest ──────────────────────────────────────────────────────────
  const manifestSrc = path.join(SRC, `manifest.${target}.json`);
  writeJson(path.join(outDir, 'manifest.json'), JSON.parse(fs.readFileSync(manifestSrc, 'utf8')));

  // ── Copy static files ──────────────────────────────────────────────────────
  for (const [src, dst] of staticFiles) {
    copyFile(path.join(SRC, src), path.join(outDir, dst));
  }

  // ── Bundle TypeScript entry points ─────────────────────────────────────────
  /** @type {esbuild.BuildOptions} */
  const buildOpts = {
    ...commonOpts,
    entryPoints: commonEntries.map(({ in: inFile, out }) => ({ in: inFile, out })),
    outdir: outDir,
    // Chrome offscreen API is Chrome-only — no polyfill needed; Firefox handles gracefully.
    define: {
      'globalThis.__NEXPATH_TARGET__': JSON.stringify(target),
    },
  };

  if (watch) {
    const ctx = await esbuild.context(buildOpts);
    await ctx.watch();
    console.log(`[nexpath-ext] Watching ${target}…`);
  } else {
    const result = await esbuild.build(buildOpts);
    if (result.errors.length) {
      console.error(`[nexpath-ext] ${target} build errors:`, result.errors);
      process.exitCode = 1;
    } else {
      console.log(`[nexpath-ext] ${target} → dist/ext-${target}/`);
    }
  }
}

// Build all targets in parallel
await Promise.all(targets.map(buildTarget));

if (!watch) {
  console.log('[nexpath-ext] Done.');
}
