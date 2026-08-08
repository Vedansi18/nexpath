/**
 * Terminal renderer for the feedback popup in hook (piped-stdin) context.
 *
 * The Stop hook's stdin is piped, so the popup cannot render inline. Mirroring
 * the advisory, this spawns a small popup window that runs the shared render
 * loop, then reads back the picked rating. Unlike the advisory renderer this is
 * intentionally minimal: it only shows the ratings and returns the pick — no
 * follow-up prompts and no extra key bindings. Falls back to an in-process
 * /dev/tty render when no window emulator is available.
 */

import { ReadStream, WriteStream } from 'node:tty';
import { openSync, closeSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { RenderLoopOptions, SelectableItem } from './render-loop.js';
import { renderLoop, eventsFromReadline } from './render-loop.js';
import type { FeedbackRenderFn } from './feedback-popup.js';
import {
  planWindowsPopupSpawn,
  planLinuxPopupSpawn,
  detectLinuxTerminal,
  buildTerminalAppleScript,
} from './TtySelectFn.js';
import { detectScreenResolution, computeDockedPopupGeometry } from './screen-geometry.js';

const WINDOW_TITLE = 'Nexpath — Feedback';

/** Resolve the sibling compiled `render-loop.js` to a `file:///` URL for the child. */
function resolveRenderLoopEsmUrl(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const rlPath  = join(thisDir, 'render-loop.js');
  return `file:///${rlPath.replace(/\\/g, '/')}`;
}

/**
 * Build the minimal .mjs the popup window runs. It reads the layout, fixes the
 * dimensions to the window's own size, runs the render loop, and writes the
 * picked value (empty string when cancelled). No send/clipboard step, no extra
 * key handling.
 */
export function buildFeedbackMjsScript(
  renderLoopUrl: string,
  optFileFwd:    string,
  resultFileFwd: string,
): string {
  return `import { renderLoop, eventsFromReadline } from '${renderLoopUrl}';
import { readFileSync, writeFileSync } from 'node:fs';

const layout = JSON.parse(readFileSync('${optFileFwd}', 'utf8'));
layout.rows = process.stdout.rows ?? 24;
layout.cols = process.stdout.columns ?? 80;

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
}
const _ev  = eventsFromReadline(process.stdin);
const _res = await renderLoop({ layout, out: process.stdout, keyEvents: _ev.events });
_ev.cancel();

writeFileSync('${resultFileFwd}', _res && typeof _res.value === 'string' ? _res.value : '', 'utf8');
process.exit(0);
`;
}

/** Map a raw result-file string back to the matching option, or null when empty/unknown. */
export function resultToItem(layout: RenderLoopOptions, raw: string): SelectableItem | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  const match = layout.options.find((o) => o.value === value);
  return match ? { value: match.value, label: match.label } : null;
}

/** Open /dev/tty for in-process rendering when no window emulator is available. */
function openDevTty(): { input: ReadStream; output: WriteStream } | null {
  try {
    const fd = openSync('/dev/tty', 'r+');
    return { input: new ReadStream(fd), output: new WriteStream(fd) };
  } catch {
    return null;
  }
}

/** In-process render over /dev/tty (Linux without a window emulator, etc.). */
async function renderOnDevTty(layout: RenderLoopOptions): Promise<SelectableItem | null> {
  const streams = openDevTty();
  if (!streams) return null;
  const wasRaw = streams.input.isRaw ?? false;
  try {
    streams.input.setRawMode(true);
    streams.input.resume();
    const layoutForTty: RenderLoopOptions = {
      ...layout,
      rows: streams.output.rows ?? 24,
      cols: streams.output.columns ?? 80,
    };
    const events = eventsFromReadline(streams.input);
    const picked = await renderLoop({ layout: layoutForTty, out: streams.output, keyEvents: events.events });
    events.cancel();
    return picked && typeof picked.value === 'string' ? resultToItem(layout, picked.value) : null;
  } finally {
    try { streams.input.setRawMode(wasRaw); } catch { /* ignore */ }
    streams.input.destroy();
  }
}

export type SpawnPlan = { cmd: string; args: string[] };

/** Build the platform spawn plan for the feedback popup window, or null for /dev/tty fallback. */
async function defaultPlanSpawn(scriptFile: string): Promise<SpawnPlan | null> {
  const plat   = process.platform;
  // Right-dock (owner request 2026-08-08): ~60% width × 100% height, flush right; fail-open
  // (null → the emulator's default size, exactly as before).
  const screen = await detectScreenResolution();
  const geom   = screen
    ? computeDockedPopupGeometry({ x: 0, y: 0, widthPx: screen.widthPx, heightPx: screen.heightPx })
    : null;

  if (plat === 'win32') {
    return planWindowsPopupSpawn(geom, WINDOW_TITLE, scriptFile);
  }
  if (plat === 'darwin') {
    return { cmd: 'osascript', args: ['-e', buildTerminalAppleScript(`node ${scriptFile}`, geom)] };
  }
  if (plat === 'linux') {
    const terminal = detectLinuxTerminal();
    if (terminal) return planLinuxPopupSpawn(terminal, geom, WINDOW_TITLE, scriptFile);
  }
  return null;   // no window emulator → caller uses /dev/tty
}

/** True when some interactive terminal method is available for the popup. */
export function feedbackTtyAvailable(): boolean {
  const plat = process.platform;
  if (plat === 'win32' || plat === 'darwin') return true;
  if (plat === 'linux' && detectLinuxTerminal()) return true;
  try { const fd = openSync('/dev/tty', 'r+'); closeSync(fd); return true; } catch { return false; }
}

/**
 * Injectable seams for `createFeedbackRenderFn` (defaults are the real
 * implementations). Present only so the spawn orchestration can be tested
 * without opening a real window.
 */
export interface FeedbackRenderDeps {
  available?:  () => boolean;
  planSpawn?:  (scriptFile: string) => Promise<SpawnPlan | null>;
  spawnPopup?: (plan: SpawnPlan, resultFile: string) => void;
}

/**
 * Create the feedback renderer for hook context, or null when no interactive
 * terminal method is available (CI / headless) — so the caller can skip the
 * popup without consuming the cadence.
 */
export function createFeedbackRenderFn(deps: FeedbackRenderDeps = {}): FeedbackRenderFn | null {
  const available   = deps.available  ?? feedbackTtyAvailable;
  const planSpawnFn = deps.planSpawn  ?? defaultPlanSpawn;
  const spawnPopup  = deps.spawnPopup ?? ((plan) => { spawnSync(plan.cmd, plan.args, { stdio: 'ignore' }); });

  if (!available()) return null;

  return async (layout: RenderLoopOptions): Promise<SelectableItem | null> => {
    const id            = randomUUID();
    const optFile       = join(tmpdir(), `nexpath-fb-opt-${id}.json`);
    const resultFile    = join(tmpdir(), `nexpath-fb-res-${id}.txt`);
    const scriptFile    = join(tmpdir(), `nexpath-fb-sel-${id}.mjs`);
    const optFileFwd    = optFile.replace(/\\/g, '/');
    const resultFileFwd = resultFile.replace(/\\/g, '/');

    const plan = await planSpawnFn(scriptFile);
    if (!plan) return renderOnDevTty(layout);

    try {
      writeFileSync(optFile, JSON.stringify(layout), 'utf8');
      writeFileSync(scriptFile, buildFeedbackMjsScript(resolveRenderLoopEsmUrl(), optFileFwd, resultFileFwd), 'utf8');
      process.stderr.write('\n[nexpath] Feedback — please respond in the new window\n');
      spawnPopup(plan, resultFile);

      const raw = existsSync(resultFile) ? readFileSync(resultFile, 'utf8') : '';
      return resultToItem(layout, raw);
    } finally {
      for (const f of [optFile, resultFile, scriptFile]) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
  };
}
