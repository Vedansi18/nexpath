/**
 * Mood / meta `_BEGINNER` register overrides — warm, plain, encouraging rewrites. FRUSTRATION_
 * SPIRAL especially must stay gentle (never clinical, never blaming): it is okay to pause. Each is
 * structurally divergent (a full 5-column ladder in beginner voice). Attached via
 * `registerOverrides.beginner`.
 *
 * Voice note: the option is the user's own next message TO the agent — a first-person "Let me
 * pause…" plus an instruction to the agent (recap / look back). No third-person "the AI"/"it".
 */

import type { LevelForm, RegisterOverride, MaturityLevel } from '../content-template-schema.js';

function form(option: string, whyDesc: string): LevelForm {
  return { kind: 'slot-variant', cell: { option, whyDesc } };
}
function structural(levelForms: Partial<Record<MaturityLevel, LevelForm>>): RegisterOverride {
  return { divergence: 'structurally-divergent', levelForms };
}

/** FRUSTRATION_SPIRAL (beginner) — keyword "pause". Warm and encouraging: it's okay to pause. */
export const FRUSTRATION_SPIRAL_BEGINNER_OVERRIDE: RegisterOverride = structural({
  1: form("Let me pause for a moment — this bit has been a slog, and it's okay to stop and take a breath before trying the next thing.", "The lightest step: a pause and a breath."),
  2: form("Let me pause and look back — go over what we've already tried on this, so we're not going round the same loop again.", "A light pause: a look back at what's been tried."),
  3: form("Let me pause and get my bearings — go over what we've tried, point to the one thing that's really stuck, and pick one small thing to try next.", "A fuller pause: the stuck point found and one small next thing."),
  4: form("Let me pause and try a fresh angle — go over what we've tried, find the real sticking point, and either come at it a new way or take a short break and come back to it later.", "Beyond a look back: a pause to try a fresh angle, or a short break."),
  5: form("Let me pause and note down where things are: what we've tried, the one thing still stuck, the next small thing to try, and a good moment to take a break — so I can come back with a clear head instead of stuck in the loop.", "A pause to note where things are and the next small step, to come back fresh."),
});
