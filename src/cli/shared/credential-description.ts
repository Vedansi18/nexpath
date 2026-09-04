import pc from 'picocolors';

/**
 * Copy for the install-time credential choice — the one place its wording lives,
 * mirroring `role-description.ts`'s shape so the two prompts read the same way.
 *
 * Nexpath needs exactly one credential and accepts two kinds. The OpenAI key is
 * listed first and is the default because it is what every existing install
 * already uses; the token is the alternative for someone who does not want an
 * OpenAI account. There is deliberately no third "skip" option — a credential
 * was required before and still is.
 */

/** The two options, in display order. The first is the default selection. */
export const CREDENTIAL_OPTIONS = [
  { value: 'openai_key',    label: 'OpenAI API key' },
  { value: 'nexpath_token', label: 'Nexpath token' },
] as const;

export type CredentialChoice = (typeof CREDENTIAL_OPTIONS)[number]['value'];

/** Heading shown above the two options. */
export const CREDENTIAL_PROMPT_TITLE = 'Choose how Nexpath runs';

/**
 * Explanatory lines shown beneath the options: each choice named, one line of
 * what it means, and where to get it. The closing line states the rule that
 * decides which one is used when both are stored, because that is the question
 * a reader has as soon as they see two options.
 */
export const CREDENTIAL_DESCRIPTION_LINES = [
  'OpenAI API key',
  'Use your own OpenAI account.',
  'https://platform.openai.com/api-keys',
  '',
  'Nexpath token',
  'No OpenAI account needed. Free $1.00 credit, no expiry.',
  'https://parseos.tech/nexpath/signup',
  '',
  'If both are set, your OpenAI key is always used.',
] as const;

/** The lines that name an option — bolded so the two choices stand out. */
const OPTION_HEADINGS = new Set<string>([
  CREDENTIAL_OPTIONS[0].label,
  CREDENTIAL_OPTIONS[1].label,
]);

/**
 * Framed, gray explanatory block shown beneath the credential options. `colors`
 * is injectable so a spawned window can force ANSI output regardless of the
 * parent process's color detection — same seam as the role block.
 */
export function buildCredentialDescriptionLines(
  colors: ReturnType<typeof pc.createColors> = pc,
): string[] {
  const bar = colors.cyan('│');
  return CREDENTIAL_DESCRIPTION_LINES.map((line) => {
    if (line === '') return bar;
    if (OPTION_HEADINGS.has(line)) return `${bar}  ${colors.bold(line)}`;
    return `${bar}  ${colors.gray(line)}`;
  });
}

/** Prompt message for the credential's own input, matching the key prompt's shape. */
export function credentialInputMessage(
  choice: CredentialChoice,
  keychainName: string,
  hasStored: boolean,
): string {
  const noun = choice === 'openai_key' ? 'API Key' : 'Nexpath Token';
  const kept = choice === 'openai_key' ? 'key' : 'token';
  return hasStored
    ? `${noun} (Enter to keep existing ${kept} stored in ${keychainName}):`
    : `${noun} (will be stored in ${keychainName}):`;
}

/**
 * Shown when the token is chosen while an OpenAI key is already stored. The
 * resolver's order is not a preference the install can override, so saying so
 * once here is the difference between a surprising outcome and an expected one.
 */
export const CREDENTIAL_KEY_WINS_NOTICE =
  'Your OpenAI key is already stored and will be used instead of this token.';
