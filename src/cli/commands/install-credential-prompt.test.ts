import { describe, it, expect, vi } from 'vitest';

// The token store is reached only through `installAction`, never by the prompt
// itself — but the prompt module imports it, and an unmocked import would drag
// `cross-keychain` into this file for no reason.
vi.mock('../../config/NexpathTokenStore.js', async () => {
  const shape = await import('../../config/credential-shape.js');
  return {
    storeNexpathToken:   vi.fn(),
    removeNexpathToken:  vi.fn(),
    isValidNexpathToken: shape.isValidNexpathToken,
  };
});

import {
  buildDefaultInstallPrompts,
  type ApiKeyPromptContext,
  type DefaultInstallPromptDeps,
} from './install.js';
import {
  CREDENTIAL_OPTIONS,
  CREDENTIAL_PROMPT_TITLE,
  CREDENTIAL_KEY_WINS_NOTICE,
  CREDENTIAL_DESCRIPTION_LINES,
  buildCredentialDescriptionLines,
  credentialInputMessage,
} from '../shared/credential-description.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const KEY   = 'sk-abcdefghij1234567890ABCDEFGHIJ';
const TOKEN = `npk_${'a'.repeat(43)}`;
const KEYCHAIN = 'macOS Keychain';

function ctx(over: Partial<ApiKeyPromptContext> = {}): ApiKeyPromptContext {
  return {
    hasEnvKey: false,
    hasStoredKey: false,
    hasStoredToken: false,
    keychainName: KEYCHAIN,
    ...over,
  };
}

/**
 * Drive the default prompt with stubs. Records what it asked for, so a test can
 * assert the ORDER of the questions as well as the answer it produced.
 */
function harness(deps: Partial<DefaultInstallPromptDeps> & {
  answer?: string | null;
} = {}) {
  const calls: string[] = [];
  const logged: string[] = [];
  let seenMessage = '';
  let seenValidate: ((v: string) => string | undefined) | null = null;

  // ⚠️ The recording wraps the stub rather than replacing it, so a test that
  // supplies its own answer still shows up in `calls`. Written the other way
  // round once, and the order assertions silently saw an empty list.
  const envStub    = deps.envConfirmFn ?? (async () => false);
  const choiceStub = deps.choiceFn     ?? (async () => 'openai_key' as const);
  const pwStub     = deps.credentialPasswordFn
    ?? (async () => (deps.answer === undefined ? KEY : deps.answer));

  const prompts = buildDefaultInstallPrompts({
    envConfirmFn: async () => { calls.push('env'); return envStub(); },
    choiceFn:     async () => { calls.push('choice'); return choiceStub(); },
    credentialPasswordFn: async (message, validate) => {
      calls.push('password');
      seenMessage = message;
      seenValidate = validate;
      return pwStub(message, validate);
    },
    log: (line) => { logged.push(line); },
  });

  return {
    prompts,
    calls,
    logged,
    message: () => seenMessage,
    validate: () => seenValidate!,
  };
}

// ── The credential branch ────────────────────────────────────────────────────

describe('default install prompt — which credential, and what comes back', () => {
  it('the OpenAI branch returns new_key', async () => {
    const h = harness({ answer: KEY });
    await expect(h.prompts.apiKeyPrompt(ctx())).resolves.toEqual({ kind: 'new_key', value: KEY });
  });

  it('the token branch returns nexpath_token', async () => {
    const h = harness({ choiceFn: async () => 'nexpath_token', answer: TOKEN });
    await expect(h.prompts.apiKeyPrompt(ctx())).resolves.toEqual({ kind: 'nexpath_token', value: TOKEN });
  });

  it('an empty answer with nothing stored is a skip, for either credential', async () => {
    for (const choice of ['openai_key', 'nexpath_token'] as const) {
      const h = harness({ choiceFn: async () => choice, answer: '' });
      await expect(h.prompts.apiKeyPrompt(ctx())).resolves.toEqual({ kind: 'skip' });
    }
  });

  it('an empty answer with that credential stored keeps it', async () => {
    const key = harness({ answer: '' });
    await expect(key.prompts.apiKeyPrompt(ctx({ hasStoredKey: true })))
      .resolves.toEqual({ kind: 'keep_existing' });

    const token = harness({ choiceFn: async () => 'nexpath_token', answer: '' });
    await expect(token.prompts.apiKeyPrompt(ctx({ hasStoredToken: true })))
      .resolves.toEqual({ kind: 'keep_existing' });
  });

  // ⚠️ The two "stored" flags are per-credential. An empty answer must not keep
  // a credential of the OTHER kind.
  it('a stored KEY does not make an empty TOKEN answer a keep', async () => {
    const h = harness({ choiceFn: async () => 'nexpath_token', answer: '' });
    await expect(h.prompts.apiKeyPrompt(ctx({ hasStoredKey: true })))
      .resolves.toEqual({ kind: 'skip' });
  });

  it('cancelling the input cancels the install', async () => {
    const h = harness({ answer: null });
    await expect(h.prompts.apiKeyPrompt(ctx())).resolves.toEqual({ kind: 'cancel' });
  });

  it('cancelling the choice cancels the install, and never asks for a value', async () => {
    const h = harness({ choiceFn: async () => null });
    await expect(h.prompts.apiKeyPrompt(ctx())).resolves.toEqual({ kind: 'cancel' });
    expect(h.calls).not.toContain('password');
  });
});

// ── R3: the environment key comes first ──────────────────────────────────────

describe('default install prompt — R3, the environment key is offered first', () => {
  it('accepting the env key short-circuits: no choice, no input', async () => {
    const h = harness({ envConfirmFn: async () => true });
    await expect(h.prompts.apiKeyPrompt(ctx({ hasEnvKey: true })))
      .resolves.toEqual({ kind: 'use_env' });
    expect(h.calls).toEqual(['env']);
  });

  it('declining the env key falls through to the choice, in that order', async () => {
    const h = harness({ envConfirmFn: async () => false, answer: KEY });
    await h.prompts.apiKeyPrompt(ctx({ hasEnvKey: true }));
    expect(h.calls).toEqual(['env', 'choice', 'password']);
  });

  it('cancelling the env confirm cancels the install', async () => {
    const h = harness({ envConfirmFn: async () => null });
    await expect(h.prompts.apiKeyPrompt(ctx({ hasEnvKey: true })))
      .resolves.toEqual({ kind: 'cancel' });
  });

  it('with no env key the confirm is never shown', async () => {
    const h = harness({ answer: KEY });
    await h.prompts.apiKeyPrompt(ctx());
    expect(h.calls).toEqual(['choice', 'password']);
  });
});

// ── R4: the token input is the key input, with different words ───────────────

describe('default install prompt — R4, the two inputs have the same shape', () => {
  it('names the credential and the keychain, and offers "keep existing" only when one is stored', async () => {
    const cases = [
      { choice: 'openai_key' as const,    stored: false, expect: `API Key (will be stored in ${KEYCHAIN}):` },
      { choice: 'openai_key' as const,    stored: true,  expect: `API Key (Enter to keep existing key stored in ${KEYCHAIN}):` },
      { choice: 'nexpath_token' as const, stored: false, expect: `Nexpath Token (will be stored in ${KEYCHAIN}):` },
      { choice: 'nexpath_token' as const, stored: true,  expect: `Nexpath Token (Enter to keep existing token stored in ${KEYCHAIN}):` },
    ];
    for (const c of cases) {
      const h = harness({ choiceFn: async () => c.choice, answer: '' });
      await h.prompts.apiKeyPrompt(ctx(
        c.choice === 'openai_key' ? { hasStoredKey: c.stored } : { hasStoredToken: c.stored },
      ));
      expect(h.message()).toBe(c.expect);
    }
  });

  it('the OpenAI branch rejects anything that is not an OpenAI key', async () => {
    const h = harness({ answer: KEY });
    await h.prompts.apiKeyPrompt(ctx());
    const v = h.validate();
    expect(v(KEY)).toBeUndefined();
    expect(v(TOKEN)).toBe('Invalid OpenAI API key format (expected sk-...)');
    expect(v('')).toBe('Invalid OpenAI API key format (expected sk-...)');
  });

  it('the token branch rejects anything that is not a Nexpath token', async () => {
    const h = harness({ choiceFn: async () => 'nexpath_token', answer: TOKEN });
    await h.prompts.apiKeyPrompt(ctx());
    const v = h.validate();
    expect(v(TOKEN)).toBeUndefined();
    expect(v(KEY)).toBe('Invalid Nexpath token format (expected npk_...)');
    expect(v('npk_short')).toBe('Invalid Nexpath token format (expected npk_...)');
  });

  // The "Enter to keep existing" affordance is the validate accepting empty —
  // without this the message would offer something the input then refuses.
  it('empty passes validation only when that credential is already stored', async () => {
    const stored = harness({ answer: '' });
    await stored.prompts.apiKeyPrompt(ctx({ hasStoredKey: true }));
    expect(stored.validate()('')).toBeUndefined();

    const fresh = harness({ answer: '' });
    await fresh.prompts.apiKeyPrompt(ctx());
    expect(fresh.validate()('')).toBe('Invalid OpenAI API key format (expected sk-...)');
  });
});

// ── R8: the one line of new user-facing copy ─────────────────────────────────

describe('default install prompt — R8, the key-wins notice', () => {
  it('is printed when a token is chosen while a key is stored', async () => {
    const h = harness({ choiceFn: async () => 'nexpath_token', answer: TOKEN });
    await h.prompts.apiKeyPrompt(ctx({ hasStoredKey: true }));
    expect(h.logged).toContain(CREDENTIAL_KEY_WINS_NOTICE);
  });

  it('is NOT printed when no key is stored', async () => {
    const h = harness({ choiceFn: async () => 'nexpath_token', answer: TOKEN });
    await h.prompts.apiKeyPrompt(ctx());
    expect(h.logged).toEqual([]);
  });

  it('is NOT printed when the OpenAI key itself is the choice', async () => {
    const h = harness({ answer: KEY });
    await h.prompts.apiKeyPrompt(ctx({ hasStoredKey: true }));
    expect(h.logged).toEqual([]);
  });
});

// ── The choice seam is real, not just declared ───────────────────────────────

describe('default install prompt — credentialChoicePrompt is a live seam', () => {
  it('an override of the choice alone is what the prompt uses', async () => {
    const base = buildDefaultInstallPrompts({
      envConfirmFn: async () => false,
      credentialPasswordFn: async () => TOKEN,
      log: () => {},
    });
    // Replace ONLY the choice — this is the shape the interface promises callers.
    const overridden = { ...base, credentialChoicePrompt: async () => 'nexpath_token' as const };
    await expect(overridden.apiKeyPrompt(ctx()))
      .resolves.toEqual({ kind: 'nexpath_token', value: TOKEN });
  });
});

// ── The copy module ──────────────────────────────────────────────────────────

describe('credential-description — the copy the picker renders', () => {
  it('lists the OpenAI key first, which is also the default selection', () => {
    expect(CREDENTIAL_OPTIONS.map((o) => o.value)).toEqual(['openai_key', 'nexpath_token']);
    expect(CREDENTIAL_OPTIONS[0].label).toBe('OpenAI API key');
  });

  it('there are exactly two options — the choice is which, never whether', () => {
    expect(CREDENTIAL_OPTIONS).toHaveLength(2);
  });

  it('names both options, gives each a link, and states the precedence rule', () => {
    const text = CREDENTIAL_DESCRIPTION_LINES.join('\n');
    expect(text).toContain('https://platform.openai.com/api-keys');
    expect(text).toContain('https://parseos.tech/nexpath/signup');
    expect(text).toContain('If both are set, your OpenAI key is always used.');
  });

  // Colours are injectable so a spawned window can force ANSI regardless of the
  // parent's detection. Passing identity functions asserts the STRUCTURE — one
  // framed line per source line, every one starting on the gutter — without
  // pinning escape codes, which would make the test about picocolors.
  it('renders one gutter-framed line per source line', () => {
    const identityColours = new Proxy({}, { get: () => (s: string) => s });
    const lines = buildCredentialDescriptionLines(
      identityColours as unknown as Parameters<typeof buildCredentialDescriptionLines>[0],
    );
    expect(lines).toHaveLength(CREDENTIAL_DESCRIPTION_LINES.length);
    for (const line of lines) expect(line.startsWith('│')).toBe(true);
    // A blank source line becomes a bare bar — the spacer between the two options.
    expect(lines.filter((l) => l === '│')).toHaveLength(
      CREDENTIAL_DESCRIPTION_LINES.filter((l) => l === '').length,
    );
  });

  it('credentialInputMessage covers all four states', () => {
    expect(credentialInputMessage('openai_key', 'X', false)).toBe('API Key (will be stored in X):');
    expect(credentialInputMessage('openai_key', 'X', true)).toBe('API Key (Enter to keep existing key stored in X):');
    expect(credentialInputMessage('nexpath_token', 'X', false)).toBe('Nexpath Token (will be stored in X):');
    expect(credentialInputMessage('nexpath_token', 'X', true)).toBe('Nexpath Token (Enter to keep existing token stored in X):');
  });

  it('the title says what the question is', () => {
    expect(CREDENTIAL_PROMPT_TITLE).toBe('Choose how Nexpath runs');
  });
});
