/**
 * Token-capacity parsing/formatting for the input-limit editor. `1K` is 1000
 * tokens and `1M` is 1000K, matching how model capacities are quoted; an
 * integral intent snaps to exact counts (a decimal multiple is exact in
 * intent but not in binary floating point).
 */

const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/**
 * Read a typed capacity, so a user can write `128K` or `1M` instead of
 * counting zeroes.
 * @param text - raw field text.
 * @returns the token count; `undefined` when blank (inherit the provider
 * default), `NaN` when unreadable.
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  return Math.round(Number(match[1]) * scale)
}

/**
 * Spell a stored count in the shortest exact form that survives a round trip
 * through {@link parseCapacity}; a count that is not a whole number of
 * thousands stays written out.
 * @param value - stored capacity.
 * @returns the exact field text.
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/**
 * A compact, display-only spelling of a capacity (`1M`, `128K`, `262K`);
 * counts below 1000 stay exact. Lossy on purpose — labels, not data.
 * @param value - capacity.
 * @returns display text.
 */
export function formatCompact(value: number): string {
  if (value >= CAPACITY_SCALE.m) {
    const scaled = value / CAPACITY_SCALE.m
    const rounded = Math.round(scaled * 10) / 10
    return `${String(rounded)}M`
  }
  if (value >= 1000) return `${String(Math.round(value / 1000))}K`
  return String(value)
}
