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

/** NO_VERSION_CONTROL (beginner) — keyword "version". Plain "start saving versions of the work". */
export const NO_VERSION_CONTROL_BEGINNER_OVERRIDE: RegisterOverride = structural({
  1: form("Turn on version control for this project so the work is saved step by step — start by setting up a git project.", "The lightest step: the project starts saving versions."),
  2: form("Set up version control and save the first version, so there's always a working copy to go back to.", "A light pass: version control on and the first version saved."),
  3: form("Set up version control for the project: start the git project, save the first version, and mark which files to skip (like generated files) so only the real work is versioned.", "The project isn't saving clean versions yet."),
  4: form("Set up version control with a steady habit: save small versions along the way, skip the throwaway files, and connect an online copy so the versions are safe if the machine is lost.", "Beyond saving locally: a habit of small versions and an online copy."),
  5: form("Write a short note on how this project saves versions: how to save a new version, how they're named, and which files to skip — so the habit is easy to repeat.", "A simple note on how the project saves its versions."),
});

/**
 * NO_BACKUP_SAFETY (beginner) — keyword "backup". Plain "keep a spare copy and check it works".
 * Same per-option safeguard as the base: making/scheduling a backup (cols 1–2) is safe, but an
 * actual restore overwrites the current data (cols 3–5) → those carry a plain confirm-seek.
 */
export const NO_BACKUP_SAFETY_BEGINNER_OVERRIDE: RegisterOverride = structural({
  1: form("Make a backup of this project's important stuff, so there's a spare copy if the original is ever lost.", "The lightest step: a backup copy exists."),
  2: form("Make a backup and set it to happen automatically on a regular basis, so the spare copy stays up to date.", "A light pass: a backup that runs on its own."),
  3: form("Make a backup, then check it really works by doing a restore — because a restore overwrites what's there now, check with me before you run it.", "The backup hasn't been checked by a real restore, which overwrites what's there — check with me before running one."),
  4: form("Set up an automatic backup that keeps a few past copies, and every so often practice a restore to make sure the data really comes back — since a restore overwrites what's there, check with me before you run it.", "Beyond one backup: a practiced restore. Since a restore overwrites what's there, check with me before running it."),
  5: form("Write a short note on how this project's backup works and practice a restore once: what's saved, how often, where it's kept, and the steps to bring it back — since a restore overwrites what's there, check with me first.", "A simple note on how the backup is saved and restored — since a restore overwrites what's there, check with me first."),
});

/**
 * NO_SEPARATE_ENVS (beginner) — keyword "environment". Plain "keep a separate place to try
 * changes, apart from the live one". Record-level sensitive (inherits l2SafeguardRequired +
 * l2SafeguardLine from the base — the override only swaps levelForms), so the engine appends the
 * confirm-seek to every beginner column. About SEPARATION only — not secrets storage.
 */
export const NO_SEPARATE_ENVS_BEGINNER_OVERRIDE: RegisterOverride = structural({
  1: form("Set up a second environment for this project — a separate place to try changes — so nothing is changed straight on the live one.", "The lightest step: a separate environment to try changes in."),
  2: form("Set up a testing environment separate from the live one, and try every change there first, so a broken change is caught before real users see it.", "A light pass: a test environment that changes go through before the live one."),
  3: form("Give the project three separate environments — one to build in, one to test in, and the live one — each kept apart, so work in one doesn't break another.", "The build, test, and live environments aren't separated yet."),
  4: form("Set up the project's environments so a change moves along a path — build it, test it, then let it reach the live environment — with each kept separate and a change only moving forward once it holds up.", "Beyond a test step: separate environments with a path from build to live."),
  5: form("Write a short note on this project's environments: what the build, test, and live ones are each for, how a change moves between them, and what keeps them separate.", "A simple note on the separate environments and how changes move."),
});
