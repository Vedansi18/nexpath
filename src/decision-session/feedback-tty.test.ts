import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import {
  buildFeedbackMjsScript,
  resultToItem,
  createFeedbackRenderFn,
  type SpawnPlan,
} from './feedback-tty.js';
import { buildFeedbackRenderOptions, FEEDBACK_OPTIONS } from './feedback-popup.js';

describe('buildFeedbackMjsScript', () => {
  const script = buildFeedbackMjsScript('file:///x/render-loop.js', '/tmp/opt.json', '/tmp/res.txt');

  it('imports the render loop and reads the layout / writes the result', () => {
    expect(script).toContain("from 'file:///x/render-loop.js'");
    expect(script).toContain("readFileSync('/tmp/opt.json'");
    expect(script).toContain("writeFileSync('/tmp/res.txt'");
  });

  it('runs the render loop and enables raw mode for arrow keys', () => {
    expect(script).toContain('renderLoop(');
    expect(script).toContain('setRawMode(true)');
  });

  it('does NOT include advisory extras (send/clipboard, Ctrl+X/T, freq/role)', () => {
    expect(script).not.toMatch(/clipboard/i);
    expect(script).not.toContain('\\x18'); // Ctrl+X
    expect(script).not.toContain('\\x14'); // Ctrl+T
    expect(script).not.toMatch(/frequency|role/i);
  });
});

describe('resultToItem', () => {
  const layout = buildFeedbackRenderOptions(24, 80);

  it('maps a known value back to its option', () => {
    const opt = FEEDBACK_OPTIONS[2]; // Good (rating 3)
    const item = resultToItem(layout, opt.value);
    expect(item).toEqual({ value: opt.value, label: opt.label });
  });

  it('trims surrounding whitespace/newlines from the result', () => {
    const opt = FEEDBACK_OPTIONS[0];
    expect(resultToItem(layout, `  ${opt.value}\n`)).toEqual({ value: opt.value, label: opt.label });
  });

  it('returns null for an empty result (cancelled)', () => {
    expect(resultToItem(layout, '')).toBeNull();
    expect(resultToItem(layout, '   \n')).toBeNull();
  });

  it('returns null for an unrecognised value', () => {
    expect(resultToItem(layout, 'not-a-rating')).toBeNull();
  });
});

describe('createFeedbackRenderFn (orchestration, injected spawn)', () => {
  const layout = buildFeedbackRenderOptions(24, 80);

  it('returns null when no terminal method is available', () => {
    expect(createFeedbackRenderFn({ available: () => false })).toBeNull();
  });

  it('spawns the window, maps the picked rating, and cleans up temp files', async () => {
    const opt = FEEDBACK_OPTIONS[2]; // Good (rating 3)
    let seenPlan: SpawnPlan | undefined;
    let scriptReferencedResult = false;
    let resultPath = '';

    const render = createFeedbackRenderFn({
      available:  () => true,
      planSpawn:  async (scriptFile) => ({ cmd: 'node', args: [scriptFile] }),
      spawnPopup: (plan, resultFile) => {
        seenPlan   = plan;
        resultPath = resultFile;
        const scriptFile = plan.args[0];
        scriptReferencedResult =
          existsSync(scriptFile) && readFileSync(scriptFile, 'utf8').includes(resultFile.replace(/\\/g, '/'));
        writeFileSync(resultFile, opt.value, 'utf8'); // simulate the child's pick
      },
    })!;

    const item = await render(layout);

    expect(item).toEqual({ value: opt.value, label: opt.label });
    expect(seenPlan?.cmd).toBe('node');
    expect(scriptReferencedResult).toBe(true);       // script written before spawn
    expect(existsSync(resultPath)).toBe(false);       // temp files cleaned up
  });

  it('returns null when the window writes no result (cancelled)', async () => {
    const render = createFeedbackRenderFn({
      available:  () => true,
      planSpawn:  async (s) => ({ cmd: 'node', args: [s] }),
      spawnPopup: () => { /* child writes nothing */ },
    })!;
    expect(await render(layout)).toBeNull();
  });
});
