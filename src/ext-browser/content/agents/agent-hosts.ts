/**
 * Hostname → agent id mapping, shared by every context that needs to know which
 * agent a page belongs to (content scripts, MAIN-world fetch rules, inject-back
 * dispatch). Single source of truth — must stay in sync with the manifests'
 * content-script `matches` blocks. Zero side effects, safe to import anywhere.
 */
export function resolveAgentFromHostname(hostname: string): string {
  if (hostname.endsWith('replit.com')) return 'replit';
  if (hostname === 'bolt.new' || hostname.endsWith('stackblitz.com')) return 'bolt';
  if (hostname === 'lovable.dev') return 'lovable';
  return 'unknown';
}
