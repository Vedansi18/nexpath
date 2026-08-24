/**
 * RC48 (Windows/Cursor blocker, Bhavnesh's report 2026-08-23): Cursor on
 * Windows writes the hook payload to stdin PREFIXED WITH A UTF-8 BOM
 * (`U+FEFF`). `JSON.parse` throws on a leading BOM, and every hook payload
 * parser caught that throw and returned `{}` silently — so the entire Cursor
 * submit-advisory surface was dead on Windows (24/24 live invocations:
 * `prompt_len: 0`, indistinguishable from an empty prompt). Byte-exact
 * reproduction on record: `BOM + compact JSON + CRLF` reproduces the live
 * signature on all three logged fields; the same payload without the BOM
 * parses perfectly.
 *
 * One shared helper so `auto.ts`, `cursor-hook/payload.ts`, and
 * `windsurf-hook/handler.ts` cannot drift.
 */
export function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/** First bytes of a payload as hex — the diagnostic that would have named the BOM on day one. */
export function headBytesHex(raw: string, n = 16): string {
  return Buffer.from(raw.slice(0, n), 'utf8').toString('hex');
}
