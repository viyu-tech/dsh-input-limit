/**
 * Token-capacity parsing/formatting for the input-limit editor. The field
 * speaks ONE unit — exact tokens (`131072`) — and the UI derives the K/M
 * spelling for display, so the stored value and the typed value can never
 * disagree about scale.
 */

/** Token-count grouping separator (display only; parsing accepts it back). */
const GROUP = ','

/** Digit run with grouping commas between digit groups (placement is enforced; cluster size is not). */
const TOKENS_PATTERN = /^\d+(?:,\d+)*$/

/** What a raw field text parses to. */
export type ParsedTokens =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'ok'; tokens: number }

/**
 * Read the field text as an exact token count. Blank is its own status (the
 * UI decides what blank means); anything that is not a positive integer —
 * `128K`, `1.5`, `-1`, `0`, stray spaces — is `invalid`, never guessed.
 *
 * Grouping commas are display-only separators and can never change scale, so
 * every digit-run arrangement they can produce parses: the popover pre-fills
 * the grouped spelling (`20,000`) when it reopens, and editing that text —
 * appending a digit (`20,0000`), deleting one (`20,00`), or any non-3-digit
 * cluster (`13,1072`) — must stay valid instead of bouncing the user off.
 * Only comma placement is enforced: leading/trailing/doubled commas are
 * typos, not numbers.
 *
 * @param text - raw field text.
 * @returns the parse outcome.
 */
export function parseTokens(text: string): ParsedTokens {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { status: 'empty' }
  if (!TOKENS_PATTERN.test(trimmed)) return { status: 'invalid' }
  const tokens = Number(trimmed.replaceAll(GROUP, ''))
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return { status: 'invalid' }
  return { status: 'ok', tokens }
}

/**
 * Spell an exact token count with digit grouping (`131072` → `131,072`), the
 * form the field itself accepts, so round-tripping a shown value never
 * changes what the user typed.
 * @param value - stored capacity.
 * @returns exact field text.
 */
export function formatTokens(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) return String(value)
  return String(value).replaceAll(/(\d)(?=(\d{3})+$)/g, `$1${GROUP}`)
}

/**
 * A compact, display-only spelling of a capacity (`1M`, `128K`, `256K`);
 * counts below 1024 stay exact. Binary scale (K = 1024, M = 1024²) — the
 * convention model context windows are quoted in, so `131072` reads `128K`
 * and pi-ai's `262144` default reads `256K`. Lossy on purpose — labels, not
 * data.
 * @param value - capacity.
 * @returns display text.
 */
export function formatCompact(value: number): string {
  const K = 1024
  if (value >= K * K) {
    const scaled = value / (K * K)
    const rounded = Math.round(scaled * 10) / 10
    return `${String(rounded)}M`
  }
  if (value >= K) return `${String(Math.round(value / K))}K`
  return String(value)
}
