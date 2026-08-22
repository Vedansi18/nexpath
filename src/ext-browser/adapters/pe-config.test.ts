import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: mockGet } } },
}));

import {
  PE_POPUP_COOLDOWN_DEFAULT,
  PE_POPUP_COOLDOWN_KEY,
  resolvePePopupCooldown,
} from './pe-config.js';

const ROOT = 'https://lovable.dev/projects/abc';
const projectKey = `${PE_POPUP_COOLDOWN_KEY}:${ROOT}`;

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue({});
});

describe('resolvePePopupCooldown', () => {
  it('defaults to 7 (the CLI default) when nothing is set', async () => {
    expect(PE_POPUP_COOLDOWN_DEFAULT).toBe(7);
    expect(await resolvePePopupCooldown(ROOT)).toBe(7);
  });

  it('the project-scoped key wins over the global key (CLI fallback order)', async () => {
    mockGet.mockResolvedValue({ [projectKey]: '3', [PE_POPUP_COOLDOWN_KEY]: '10' });
    expect(await resolvePePopupCooldown(ROOT)).toBe(3);
  });

  it('falls back to the global key when no project key exists', async () => {
    mockGet.mockResolvedValue({ [PE_POPUP_COOLDOWN_KEY]: '10' });
    expect(await resolvePePopupCooldown(ROOT)).toBe(10);
  });

  it('0 is a valid value (cooldown disabled), numbers are accepted directly', async () => {
    mockGet.mockResolvedValue({ [PE_POPUP_COOLDOWN_KEY]: '0' });
    expect(await resolvePePopupCooldown(ROOT)).toBe(0);
    mockGet.mockResolvedValue({ [PE_POPUP_COOLDOWN_KEY]: 12 });
    expect(await resolvePePopupCooldown(ROOT)).toBe(12);
  });

  it('non-numeric and negative values fall back to the default', async () => {
    mockGet.mockResolvedValue({ [PE_POPUP_COOLDOWN_KEY]: 'often' });
    expect(await resolvePePopupCooldown(ROOT)).toBe(7);
    mockGet.mockResolvedValue({ [PE_POPUP_COOLDOWN_KEY]: '-2' });
    expect(await resolvePePopupCooldown(ROOT)).toBe(7);
  });

  it('a storage failure falls back to the default', async () => {
    mockGet.mockRejectedValue(new Error('gone'));
    expect(await resolvePePopupCooldown(ROOT)).toBe(7);
  });
});

describe('hidden-key guard — PE keys never surface on the options page', () => {
  // Amendment-A9 posture: internal switches must never leak into any rendered
  // user surface. Pin it against the actual options page sources.
  const optionsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'options');
  const surfaces = ['options.html', 'options.ts'].map((f) => readFileSync(join(optionsDir, f), 'utf8'));

  for (const hidden of ['prompt_enhancement.popup_cooldown', 'nexpath_pending_pe']) {
    it(`"${hidden}" appears nowhere in the options page`, () => {
      for (const source of surfaces) expect(source).not.toContain(hidden);
    });
  }
});
