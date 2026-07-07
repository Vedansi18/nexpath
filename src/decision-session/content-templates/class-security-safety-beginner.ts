/**
 * Security / safety `_BEGINNER` register overrides — plain-language, warm rewrites of the
 * security/safety content-template records. Structurally divergent (each is a full 5-column
 * ladder in beginner voice, not a vocabulary tweak of the base). Attached via
 * `registerOverrides.beginner`.
 *
 * Voice note: the option is the user's own next message TO the agent, so an event that the
 * user caused (e.g. a pasted secret) is phrased AGENT-NEUTRAL ("the secret that was pasted"),
 * never "the secret you pasted" (which the agent would read as itself).
 */

import type { LevelForm, RegisterOverride, MaturityLevel } from '../content-template-schema.js';

function form(option: string, whyDesc: string): LevelForm {
  return { kind: 'slot-variant', cell: { option, whyDesc } };
}
function structural(levelForms: Partial<Record<MaturityLevel, LevelForm>>): RegisterOverride {
  return { divergence: 'structurally-divergent', levelForms };
}

/** SECRET_IN_PROMPT (beginner) — keyword "secret". A pasted secret is no longer safe: replace it. */
export const SECRET_IN_PROMPT_BEGINNER_OVERRIDE: RegisterOverride = structural({
  1: form("The secret that was just pasted should be treated as no longer safe — make a new one and swap it in before continuing.", "The lightest step: the pasted secret replaced with a new one."),
  2: form("Make a new secret to replace the one that was pasted, and delete the old one from the chat — once a secret is pasted, treat it as seen.", "A light pass: the pasted secret replaced and cleared from the chat."),
  3: form("1. The secret that was pasted should be treated as leaked. 2. Make a new one, swap it in, and remove the old one from the chat and anywhere it was saved. 3. Tell me once it's replaced.", "The pasted secret hasn't been replaced yet."),
  4: form("Replace the pasted secret with a new one, then find every place the old secret might still be — the chat, saved files, past commits — and clear it, so the leaked secret is gone everywhere.", "Beyond replacing it: the leaked secret cleared from every place it might still be."),
  5: form("Write a short note about the leaked secret: what it was for, that it was replaced, where it was cleared from, and one change that stops a secret being pasted again.", "A durable note of the leaked secret, its replacement, and the fix."),
});
