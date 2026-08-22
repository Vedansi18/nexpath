/**
 * Prompt-enhancement configuration reads for the browser — hidden
 * `storage.local` keys mirroring the CLI's config table entries. NONE of these
 * keys are ever rendered in options.html or renderSelfCheck (guard-tested):
 * they are internal tuning knobs, set only from the extension's own DevTools
 * console when needed, exactly like the CLI's config-only keys.
 */

import browser from 'webextension-polyfill';

/** Mirrors the CLI's `prompt_enhancement.popup_cooldown` config key (stop.ts). */
export const PE_POPUP_COOLDOWN_KEY = 'prompt_enhancement.popup_cooldown';

/** The CLI's default: suppress NEW PE popups for 7 prompts after one shows. */
export const PE_POPUP_COOLDOWN_DEFAULT = 7;

/**
 * Resolve the PE / MPS-1 popup cooldown (in prompts) — project-scoped key
 * first, then global, then the default. 0 disables the cooldown; non-numeric /
 * negative / missing fall back to the default. Byte-mirrors the CLI's
 * `resolvePromptEnhancementPopupCooldownV1` fallback order and parsing.
 */
export async function resolvePePopupCooldown(projectRoot: string): Promise<number> {
  const projectKey = `${PE_POPUP_COOLDOWN_KEY}:${projectRoot}`;
  let raw: unknown;
  try {
    const got = await browser.storage.local.get([projectKey, PE_POPUP_COOLDOWN_KEY]);
    const record = got as Record<string, unknown>;
    raw = record[projectKey] ?? record[PE_POPUP_COOLDOWN_KEY];
  } catch {
    return PE_POPUP_COOLDOWN_DEFAULT;
  }
  if (raw === undefined || raw === null) return PE_POPUP_COOLDOWN_DEFAULT;
  const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 0 ? n : PE_POPUP_COOLDOWN_DEFAULT;
}
