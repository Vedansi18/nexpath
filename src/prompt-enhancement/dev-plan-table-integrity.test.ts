import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * A rendering guard for the sub-11 dev plan's tables.
 *
 * Two defects hid in that file for many phases, both invisible in the raw text being edited:
 *
 *  1. A BLANK LINE between two table rows ENDS the table in markdown. Nine of them had crept into
 *     the execution record, so it rendered as 13 rows and everything after phase 13 — including
 *     phase 32's own row — came out as literal paragraphs beginning with '|'.
 *  2. A literal '|' inside a cell splits that cell, and backticks give no protection. The GFM
 *     tables spec requires `\|` even inside a code span (spec example 200). Eight rows carried
 *     unescaped pipes in fact ids and shell snippets, shifting their evidence column out of place.
 *
 * Neither is visible until the file is rendered, and both are easy to reintroduce while appending
 * verification records — which is exactly what phases 33-38 will keep doing. Hence a guard.
 */

const PLAN =
  'lib/shared/submodules/nexpath-prompt-enhancement-submodule/docs/dev/' +
  'user-experience-improvements-sub-11-prompt-enhancement-intent-family-routing-misses-debug-intents-dev-plan.md';

/** Pipes that actually split cells: every unescaped one, code spans included, per GFM. */
function cellPipes(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '|' && (i === 0 || line[i - 1] !== '\\')) n += 1;
  }
  return n;
}

function isSeparatorRow(line: string): boolean {
  const bare = line.replace(/\|/g, '').replace(/ /g, '');
  return line.startsWith('|') && bare.length > 0 && /^[-:]+$/.test(bare);
}

describe('sub-11 dev plan — every markdown table renders as a table', () => {
  const present = existsSync(PLAN);
  const lines = present ? readFileSync(PLAN, 'utf8').split(/\r?\n/) : [];

  it('the plan file is present (submodule checked out)', () => {
    // Recorded rather than silently skipped: a guard that quietly passes when its subject is
    // missing is the same class of problem it was written to catch.
    expect(present, `plan file not found at ${PLAN} — submodule not checked out?`).toBe(true);
  });

  it('no blank line sits between two table rows', () => {
    const breaks: number[] = [];
    for (let i = 1; i < lines.length - 1; i += 1) {
      if (lines[i]!.trim() === '' && lines[i - 1]!.startsWith('|') && lines[i + 1]!.startsWith('|')) {
        breaks.push(i + 1);
      }
    }
    expect(
      breaks,
      'a blank line ends the table there — every row after it renders as literal text, not a row',
    ).toEqual([]);
  });

  it('every table row has exactly its header cell count', () => {
    const bad: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const header = lines[i]!;
      if (header.startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1]!)) {
        const expected = cellPipes(header);
        let j = i + 2;
        while (j < lines.length && lines[j]!.startsWith('|')) {
          const got = cellPipes(lines[j]!);
          if (got !== expected) {
            bad.push(`line ${j + 1}: ${got} pipes vs header ${expected} — ${lines[j]!.slice(0, 50)}`);
          }
          j += 1;
        }
        i = j;
      } else {
        i += 1;
      }
    }
    expect(bad, 'escape content pipes as \\| — backticks do NOT protect them in a table').toEqual([]);
  });

  it('the execution record still carries a row per completed phase', () => {
    // Guards the failure that started this: the table silently shrank to 13 rows and nobody could
    // tell from the source. If a future edit truncates it again, this fails rather than the record
    // quietly losing phases.
    const headerIdx = lines.findIndex((l) => l.startsWith('| Phase | Result | Evidence |'));
    expect(headerIdx, 'the execution-record header moved or changed shape').toBeGreaterThan(-1);
    let rows = 0;
    for (let j = headerIdx + 2; j < lines.length && lines[j]!.startsWith('|'); j += 1) rows += 1;
    expect(rows, 'the execution record lost rows — a blank line or a stray pipe truncated it')
      .toBeGreaterThanOrEqual(32);
  });
});
