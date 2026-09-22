/**
 * Sandbox-friendly verification of src/client/capacity.ts using Node's built-in
 * type stripping (no vitest dependency). Mirrors tests/capacity.test.ts.
 * Run with: node --experimental-strip-types tests/capacity.verify.mjs
 */

import assert from 'node:assert/strict'
import { formatCompact, formatTokens, parseTokens } from '../src/client/capacity.ts'

// parseTokens — one unit: exact tokens
assert.deepEqual(parseTokens('131072'), { status: 'ok', tokens: 131_072 }, 'plain integer')
assert.deepEqual(parseTokens('131,072'), { status: 'ok', tokens: 131_072 }, 'grouping separators accepted')
// grouping commas are display-only separators: the popover re-fills the grouped
// spelling on reopen, so editing it (append/delete a digit, odd clusters) stays valid
assert.deepEqual(parseTokens('20,000'), { status: 'ok', tokens: 20_000 }, 'grouped prefill parses')
assert.deepEqual(parseTokens('20,0000'), { status: 'ok', tokens: 200_000 }, 'digit appended to the grouped prefill parses')
assert.deepEqual(parseTokens('20,00'), { status: 'ok', tokens: 2_000 }, 'digit deleted from the grouped prefill parses')
assert.deepEqual(parseTokens('13,1072'), { status: 'ok', tokens: 131_072 }, 'non-3-digit clusters are still exact digits')
assert.deepEqual(parseTokens('1,2,3'), { status: 'ok', tokens: 123 }, 'arbitrary cluster sizes parse')
assert.deepEqual(parseTokens(',131072').status, 'invalid', 'leading comma rejected')
assert.deepEqual(parseTokens('131072,').status, 'invalid', 'trailing comma rejected')
assert.deepEqual(parseTokens('13,,1072').status, 'invalid', 'doubled comma rejected')
assert.deepEqual(parseTokens('  131072 '), { status: 'ok', tokens: 131_072 }, 'surrounding whitespace trimmed')
assert.deepEqual(parseTokens(''), { status: 'empty' }, 'blank is its own status')
assert.deepEqual(parseTokens('   '), { status: 'empty' }, 'whitespace is empty')

// units are gone on purpose: the field speaks tokens only
assert.deepEqual(parseTokens('128K').status, 'invalid', 'K suffix rejected')
assert.deepEqual(parseTokens('1M').status, 'invalid', 'M suffix rejected')
assert.deepEqual(parseTokens('1.5m').status, 'invalid', 'lowercase suffix rejected')
assert.deepEqual(parseTokens('1.5').status, 'invalid', 'decimals rejected')
assert.deepEqual(parseTokens('0').status, 'invalid', 'zero rejected')
assert.deepEqual(parseTokens('-1').status, 'invalid', 'negatives rejected')
assert.deepEqual(parseTokens('12x').status, 'invalid', 'trailing garbage rejected')
assert.deepEqual(parseTokens('abc').status, 'invalid', 'letters rejected')
assert.deepEqual(parseTokens('12 34').status, 'invalid', 'inner space rejected')
assert.deepEqual(parseTokens('1e6').status, 'invalid', 'exponent notation rejected')
assert.deepEqual(parseTokens('99999999999999999999').status, 'invalid', 'beyond safe integer rejected')

// formatTokens — exact, grouped, round-trippable
assert.equal(formatTokens(131_072), '131,072')
assert.equal(formatTokens(1_000_000), '1,000,000')
assert.equal(formatTokens(262_144), '262,144')
assert.equal(formatTokens(512), '512')
assert.equal(formatTokens(0), '0', 'non-positive falls through to String')
assert.equal(formatTokens(-5), '-5')

// formatCompact — binary scale, the convention model windows are quoted in
assert.equal(formatCompact(512), '512', 'below 1K stays exact')
assert.equal(formatCompact(1024), '1K')
assert.equal(formatCompact(131_072), '128K', '131072 is 128K, not 131K')
assert.equal(formatCompact(262_144), '256K', 'pi-ai default 262144 reads 256K')
assert.equal(formatCompact(1_048_576), '1M')
assert.equal(formatCompact(2_097_152), '2M')
assert.equal(formatCompact(1_572_864), '1.5M')
assert.equal(formatCompact(200_000), '195K')

// round trip: the field accepts exactly what it shows
for (const value of [512, 4096, 131_072, 262_144, 1_048_576]) {
  const text = formatTokens(value)
  const parsed = parseTokens(text)
  assert.deepEqual(parsed, { status: 'ok', tokens: value }, `round trip ${value} via ${text}`)
}

// the pill's compact label and the field agree on the same value
assert.equal(parseTokens(formatTokens(131_072)).tokens, 131_072)
assert.equal(formatCompact(parseTokens('131072').tokens), '128K')

console.log('capacity.verify OK (50+ assertions passed)')
