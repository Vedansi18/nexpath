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

/**
 * The two options, in display order. The first is the default selection.
 *
 * ⚠️ Each option carries its OWN detail lines, and the picker renders them
 * directly under it. They used to live in one block below both options, which
 * meant the reader picked from two bare labels and then had to match each one
 * against a heading repeated further down — the detail was on screen but not
 * where the decision was being made. Keeping the copy on the option is also
 * what stops the two lists drifting: there is no second place to update.
 */
export const CREDENTIAL_OPTIONS = [
  {
    value: 'openai_key',
    label: 'OpenAI API key',
    detail: [
      'Use your own OpenAI account.',
      'https://platform.openai.com/api-keys',
    ],
  },
  {
    value: 'nexpath_token',
    label: 'Nexpath token',
    detail: [
      'No OpenAI account needed. Free $1.00 credit, no expiry.',
      'https://parseos.tech/nexpath/signup',
    ],
  },
] as const;

export type CredentialChoice = (typeof CREDENTIAL_OPTIONS)[number]['value'];

/** Heading shown above the two options. */
export const CREDENTIAL_PROMPT_TITLE = 'Choose how Nexpath runs';

/**
 * Closing line, shown once beneath both options. It belongs to neither of them:
 * it answers the question a reader has the moment they see two choices — what
 * happens if I end up with both — and it is the resolver's fixed order, not a
 * preference the install can offer.
 */
export const CREDENTIAL_FOOTER_LINE = 'If both are set, your OpenAI key is always used.';

/**
 * The whole choice block: every option, its detail lines indented beneath it,
 * and the footer. One function so the picker cannot render the options and the
 * copy out of step.
 *
 * `selectedIndex` marks the row the cursor is on — filled bullet and a bright
 * label, against dimmed bullets and labels for the rest. Detail lines stay gray
 * for every option, selected or not: they are what the reader compares to make
 * the choice, so dimming the unselected one's copy would hide exactly the half
 * they have not decided about yet.
 *
 * `colors` is injectable so a spawned window can force ANSI output regardless of
 * the parent process's colour detection — same seam as the role block.
 */
export function buildCredentialOptionLines(
  selectedIndex: number,
  colors: ReturnType<typeof pc.createColors> = pc,
): string[] {
  const bar = colors.cyan('│');
  const lines: string[] = [];

  CREDENTIAL_OPTIONS.forEach((option, index) => {
    const selected = index === selectedIndex;
    lines.push(
      selected
        ? `${bar}  ${colors.green('●')} ${option.label}`
        : `${bar}  ${colors.dim('○')} ${colors.dim(option.label)}`,
    );
    // Indented past the bullet so a detail line reads as belonging to the
    // option above it rather than as another choice.
    for (const line of option.detail) lines.push(`${bar}     ${colors.gray(line)}`);
  });

  lines.push(bar);
  lines.push(`${bar}  ${colors.gray(CREDENTIAL_FOOTER_LINE)}`);
  return lines;
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
