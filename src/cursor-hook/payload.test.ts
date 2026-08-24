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
import { parseAutoHookPayload } from '../cli/commands/auto.js';

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

/**
 * ⭐ RC48 — the live Windows payload, BOM-prefixed (Bhavnesh's byte-exact
 * reproduction: BOM + compact + CRLF matched the live raw_len/prompt_len/
 * has_project_root signature on all three fields). The fixture below is the
 * REAL captured Cursor 3.17.8 beforeSubmitPrompt INPUT from the tester's own
 * Cursor hooks log (email swapped) — no more hand-written-only test payloads.
 */
describe('⭐ RC48 — BOM-prefixed Windows payloads parse', () => {
  const REAL_CAPTURED_PAYLOAD = JSON.stringify({
    conversation_id: '88c70b42-1616-4881-90d9-9443ff0e66f5',
    generation_id: 'b24b1943-b9e4-4417-9fe0-c091ae51da1d',
    model: 'cursor-grok-4.6-medium',
    model_id: 'grok-4.6',
    model_params: [{ id: 'effort', value: 'medium' }, { id: 'fast', value: 'false' }],
    composer_mode: 'agent',
    prompt: 'make me a website where i can create invoices and send them to clients and track if they paid',
    attachments: [],
    session_id: '88c70b42-1616-4881-90d9-9443ff0e66f5',
    hook_event_name: 'beforeSubmitPrompt',
    cursor_version: '3.17.8',
    workspace_roots: ['/c:/Users/Admin/OneDrive/Desktop/vedansi_testing'],
    user_email: 'tester@example.com',
    transcript_path: null,
  });

  it('⭐ the real captured payload parses clean', () => {
    const p = parseCursorHookPayload(REAL_CAPTURED_PAYLOAD);
    expect(p.promptText).toContain('create invoices');
    expect(p.projectRoot).toBe('/c:/Users/Admin/OneDrive/Desktop/vedansi_testing');
  });

  it('⭐ BOM + compact + CRLF — the exact live failure shape — now parses identically', () => {
    const p = parseCursorHookPayload('\uFEFF' + REAL_CAPTURED_PAYLOAD + '\r\n');
    expect(p.promptText).toContain('create invoices');
    expect(p.projectRoot).toBe('/c:/Users/Admin/OneDrive/Desktop/vedansi_testing');
  });

  it('BOM on a windsurf-shaped payload parses too (shared helper, no drift)', () => {
    const p = parseAutoHookPayload('\uFEFF{"prompt":"hello there","permission_mode":"agent"}');
    expect(p.promptText).toBe('hello there');
  });
});
