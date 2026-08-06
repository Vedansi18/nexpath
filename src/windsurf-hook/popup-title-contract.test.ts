import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Cross-package guard for the popup window titles.
 *
 * The foreground raisers match windows by their literal title text, and the
 * title each popup actually sets is declared in a different package:
 *
 *   - the PE title lives in `src/cli/prompt-enhancement-host.ts` as a
 *     NON-EXPORTED const, passed as `--title` to every terminal emulator;
 *   - `src/windsurf-hook/foreground.ts` (Cascade-hook path) hand-copies it;
 *   - `src/ext-vscode/src/popup-foreground.ts` (extension path) hand-copies it
 *     again, because that is a separate npm package.
 *
 * Nothing links those three. A unit test in either raiser pins only its own
 * copy, so if the CLI constant changes, both raisers keep passing and silently
 * stop raising the window — which is exactly the defect the raisers exist to
 * prevent, reintroduced without a single failing test.
 *
 * These read the declarations as source text, which is the only mechanism that
 * can see across the package boundary. Source-text assertions are already an
 * accepted guard pattern in this repo where no runtime hook exists.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

function read(...segments: string[]): string {
  return readFileSync(join(SRC, ...segments), 'utf8');
}

/** Pull `const NAME = '<value>'` out of a source file. */
function declaredString(source: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*(?::\\s*string)?\\s*=\\s*'([^']*)'`).exec(source);
  return match ? match[1]! : null;
}

describe('popup window title contract', () => {
  const EXPECTED_PE_TITLE = 'Nexpath · Prompt enhancement';

  it('the CLI PE host still declares the title the raisers match on', () => {
    const declared = declaredString(
      read('cli', 'prompt-enhancement-host.ts'),
      'PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1',
    );
    expect(declared).not.toBeNull();
    expect(declared).toBe(EXPECTED_PE_TITLE);
  });

  it('the Cascade-hook raiser copies the PE title exactly', () => {
    const declared = declaredString(
      read('windsurf-hook', 'foreground.ts'),
      'PROMPT_ENHANCEMENT_POPUP_TITLE',
    );
    expect(declared).toBe(EXPECTED_PE_TITLE);
  });

  it('the extension raiser copies the PE title exactly', () => {
    const declared = declaredString(
      read('ext-vscode', 'src', 'popup-foreground.ts'),
      'PROMPT_ENHANCEMENT_WINDOW_TITLE',
    );
    expect(declared).toBe(EXPECTED_PE_TITLE);
  });

  it('all three declarations agree with each other', () => {
    const cli = declaredString(
      read('cli', 'prompt-enhancement-host.ts'),
      'PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1',
    );
    const hook = declaredString(
      read('windsurf-hook', 'foreground.ts'),
      'PROMPT_ENHANCEMENT_POPUP_TITLE',
    );
    const ext = declaredString(
      read('ext-vscode', 'src', 'popup-foreground.ts'),
      'PROMPT_ENHANCEMENT_WINDOW_TITLE',
    );
    expect(new Set([cli, hook, ext]).size).toBe(1);
  });

  // The separator is the failure mode most likely to slip through review: the
  // PE title uses U+00B7 while the other two use U+2014, and they look alike.
  it('the PE title uses a middle dot, not the em dash of the other two', () => {
    expect(EXPECTED_PE_TITLE).toContain('·');
    expect(EXPECTED_PE_TITLE).not.toContain('—');
  });

  // The guard is only as good as its extractor. If `declaredString` silently
  // stopped matching, every assertion above would compare null to null in the
  // agreement test and the whole guard would pass while proving nothing.
  it('the extractor reports null for a declaration that is not there', () => {
    const source = "const SOMETHING_ELSE = 'value';";
    expect(declaredString(source, 'PROMPT_ENHANCEMENT_POPUP_TITLE')).toBeNull();
  });

  it('the extractor reads a declaration it can see', () => {
    expect(declaredString("const A = 'x';", 'A')).toBe('x');
    expect(declaredString("const B: string = 'y';", 'B')).toBe('y');
  });

  // Guards the agreement test itself: three nulls must not read as "agree".
  it('a renamed upstream constant is caught, not silently tolerated', () => {
    const renamed = "const PE_TITLE_RENAMED = 'Nexpath · Prompt enhancement';";
    expect(declaredString(renamed, 'PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1')).toBeNull();
  });

  it('the two pre-existing titles are unchanged in both raisers', () => {
    const hook = read('windsurf-hook', 'foreground.ts');
    const ext = read('ext-vscode', 'src', 'popup-foreground.ts');

    expect(declaredString(hook, 'ADVISORY_POPUP_TITLE')).toBe('Nexpath — Action Required');
    expect(declaredString(hook, 'FEEDBACK_POPUP_TITLE')).toBe('Nexpath — Feedback');
    expect(declaredString(ext, 'POPUP_WINDOW_TITLE')).toBe('Nexpath — Action Required');
    expect(declaredString(ext, 'FEEDBACK_WINDOW_TITLE')).toBe('Nexpath — Feedback');
  });
});
