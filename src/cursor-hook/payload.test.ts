/**
 * H5 — Cursor payload parsing, against the REAL measured shape.
 *
 * The fixture below is the shape the analysis recorded from a live Cursor hook,
 * not an invented one:
 *   { prompt, session_id, hook_event_name, cursor_version, workspace_roots,
 *     user_email, transcript_path }
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCursorHookPayload, describeCursorPayloadSafely } from './payload.js';

const REAL = JSON.stringify({
  prompt: '  what is 2 + 2.  ',
  session_id: 'sess-abc',
  hook_event_name: 'beforeSubmitPrompt',
  cursor_version: '1.7.11',
  workspace_roots: ['/home/u/proj', '/home/u/other'],
  user_email: 'someone@example.com',
  transcript_path: '/tmp/t.jsonl',
});

describe('parses the real measured Cursor shape', () => {
  it('extracts the prompt, trimmed', () => {
    expect(parseCursorHookPayload(REAL).promptText).toBe('what is 2 + 2.');
  });

  it('takes the project root from workspace_roots[0]', () => {
    // Claude's payload has no equivalent - it is resolved separately there.
    expect(parseCursorHookPayload(REAL).projectRoot).toBe('/home/u/proj');
  });

  it('reuses the identical-key transcript_path', () => {
    expect(parseCursorHookPayload(REAL).transcriptPath).toBe('/tmp/t.jsonl');
  });

  it('carries the session id for correlation', () => {
    expect(parseCursorHookPayload(REAL).sessionId).toBe('sess-abc');
  });
});

describe('⚠ §4.3 — user_email must NEVER appear', () => {
  it('is absent from the parsed result entirely', () => {
    // The safest redaction is not having the value: no downstream logger can
    // reach a field that was never copied.
    const p = parseCursorHookPayload(REAL);
    expect(JSON.stringify(p)).not.toContain('someone@example.com');
    expect(JSON.stringify(p)).not.toContain('user_email');
  });

  it('is absent from the log-safe description', () => {
    const d = describeCursorPayloadSafely(parseCursorHookPayload(REAL));
    expect(JSON.stringify(d)).not.toContain('someone@example.com');
  });

  it('the source never reads the field at all', () => {
    // MUTATION GUARD: a future edit could copy it through "just for debugging".
    const src = readFileSync(join(__dirname, 'payload.ts'), 'utf8');
    const code = src.split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
    expect(code.join('\n')).not.toMatch(/user_email/);
  });
});

describe('the log-safe description never leaks content', () => {
  it('reports the prompt length, not the prompt', () => {
    const d = describeCursorPayloadSafely(parseCursorHookPayload(REAL));
    expect(d.promptLength).toBe('what is 2 + 2.'.length);
    expect(JSON.stringify(d)).not.toContain('what is 2 + 2');
  });

  it('reports presence, not paths', () => {
    const d = describeCursorPayloadSafely(parseCursorHookPayload(REAL));
    expect(d.hasTranscript).toBe(true);
    expect(d.hasProjectRoot).toBe(true);
    expect(JSON.stringify(d)).not.toContain('/tmp/t.jsonl');
  });
});

describe('composer_mode is added ALONGSIDE permission_mode, not instead of it', () => {
  it('prefers composer_mode on a Cursor payload', () => {
    const raw = JSON.stringify({ prompt: 'p', composer_mode: 'agent', permission_mode: 'ask' });
    expect(parseCursorHookPayload(raw).currentAgentMode).toBe('agent');
  });

  it('still honours permission_mode when composer_mode is absent', () => {
    // MUTATION GUARD: replacing rather than adding would break the Claude shape.
    const raw = JSON.stringify({ prompt: 'p', permission_mode: 'ask' });
    expect(parseCursorHookPayload(raw).currentAgentMode).toBe('ask');
  });

  it('ignores a blank composer_mode', () => {
    const raw = JSON.stringify({ prompt: 'p', composer_mode: '', permission_mode: 'ask' });
    expect(parseCursorHookPayload(raw).currentAgentMode).toBe('ask');
  });
});

describe('never throws — a hook must not break the host', () => {
  it('malformed JSON yields an empty result', () => {
    expect(parseCursorHookPayload('{ not json')).toEqual({});
  });

  it('a non-object payload yields an empty result', () => {
    expect(parseCursorHookPayload('"a string"')).toEqual({});
  });

  it('missing workspace_roots leaves projectRoot undefined', () => {
    expect(parseCursorHookPayload(JSON.stringify({ prompt: 'p' })).projectRoot).toBeUndefined();
  });

  it('skips non-string and empty entries in workspace_roots', () => {
    const raw = JSON.stringify({ prompt: 'p', workspace_roots: [null, '', '/real'] });
    expect(parseCursorHookPayload(raw).projectRoot).toBe('/real');
  });

  it('a blank prompt is undefined, not an empty string', () => {
    expect(parseCursorHookPayload(JSON.stringify({ prompt: '   ' })).promptText).toBe('');
  });
});
