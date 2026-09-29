/**
 * The two clause lists may differ in SIZE but never in content.
 *
 * `emphasis-classes.ts` reads a clause's front twice over:
 *
 *   CLASS_1_WRAPPERS           everything a clause can WEAR, peeled off the front until nothing comes off
 *   CLASS_1_MIDSENTENCE_HEADS  where a NEW clause may begin after a comma
 *
 * The second is deliberately smaller — widening it spends the per-section cap on actions and takes
 * boundary and condition marks away from the reader, which is a ruling for the owner (plan §5L). What is
 * NOT deliberate, and is what this file exists to catch, is the two disagreeing: a head that the peel
 * does not know would be found mid-sentence and then left wearing its own wrapper, and that is how
 * `Let’s break this epic into clear` came to be a mark with the wrapper inside it.
 *
 * ⛔ Read from SOURCE, because both lists are module-private and should stay that way. The same pattern
 * as `composer-own-lines.test.ts`, and for the same reason: a guard is worth nothing if it can only be
 * written by widening the thing it guards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'emphasis-classes.ts'), 'utf8');

/** The string entries of one `const NAME: readonly string[] = [ … ];` declaration. */
function entriesOf(name: string): readonly string[] {
  const at = source.indexOf(`const ${name}: readonly string[] = [`);
  if (at < 0) throw new Error(`${name} is not declared in emphasis-classes.ts`);
  const end = source.indexOf('];', at);
  if (end < 0) throw new Error(`${name}'s declaration is not closed`);
  const block = source.slice(at, end);
  // Comment lines inside the block carry prose with apostrophes in it, which would pair with the next
  // real quote and shift every entry after it — so they go first.
  const code = block.replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map((match) => (match[1] ?? match[2] ?? '').replace(/\\'/g, "'"))
    .filter((entry) => entry.length > 0);
}

describe('the clause lists agree', () => {
  const wrappers = entriesOf('CLASS_1_WRAPPERS');
  const heads = entriesOf('CLASS_1_MIDSENTENCE_HEADS');

  it('reads both lists at all — an empty read would make every assertion below vacuous', () => {
    expect(wrappers.length).toBeGreaterThan(40);
    expect(heads.length).toBeGreaterThan(10);
  });

  it('every mid-sentence head is also peeled as a wrapper', () => {
    // A head the peel does not know is found mid-sentence and then left wearing itself: the clause
    // starts after `let's`, and `let's` is still in front of the verb of the clause behind it.
    const unpeeled = heads.filter((head) => !wrappers.includes(head));
    expect(unpeeled).toEqual([]);
  });

  it('the head list is the smaller of the two, which is the point', () => {
    // If they ever become equal, the merge has happened by accident rather than by the owner's ruling.
    expect(heads.length).toBeLessThan(wrappers.length);
  });

  it('neither list carries a duplicate', () => {
    expect(new Set(wrappers).size).toBe(wrappers.length);
    expect(new Set(heads).size).toBe(heads.length);
  });

  it('no wrapper is a verb one of the approved lists holds', async () => {
    // ⛔ Peeling a verb hands the clause to the word behind it: `ensure the data is clean` would become
    // `the data is clean`, which instructs nobody. The header says this; here it is checked.
    const { EXECUTION_VERB, ALWAYS_ESCALATE_PATTERN } = await import('./safety-sendability.js');
    for (const wrapper of wrappers) {
      const bare = wrapper.replace(/[,]$/, '');
      // Only single-word wrappers can BE a verb; `make sure to` ends in a word that is not the verb.
      if (bare.includes(' ')) continue;
      expect(EXECUTION_VERB.test(bare), `${wrapper} is an execution verb`).toBe(false);
      expect(ALWAYS_ESCALATE_PATTERN.test(bare), `${wrapper} is an escalation verb`).toBe(false);
    }
  });
});
