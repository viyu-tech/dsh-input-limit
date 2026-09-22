/**
 * Sandbox-friendly verification of src/client/capacity.ts using Node's built-in
 * type stripping (no vitest dependency). Mirrors tests/capacity.test.ts.
 * Run with: node --experimental-strip-types tests/capacity.verify.mjs
 */

import assert from 'node:assert/strict'
import { formatCapacity, formatCompact, parseCapacity } from '../src/client/capacity.ts'

// parseCapacity
assert.equal(parseCapacity('128000'), 128_000, 'plain integer')
assert.equal(parseCapacity('0'), 0, 'zero')
assert.equal(parseCapacity('128K'), 128_000, 'K suffix')
assert.equal(parseCapacity('1M'), 1_000_000, 'M suffix')
assert.equal(parseCapacity('1.5M'), 1_500_000, 'decimal suffix')
assert.equal(parseCapacity(''), undefined, 'blank -> inherit')
assert.equal(parseCapacity('   '), undefined, 'whitespace -> inherit')
assert.ok(Number.isNaN(parseCapacity('12x')), 'garbage -> NaN')
assert.ok(Number.isNaN(parseCapacity('-128K')), 'negative -> NaN')

// formatCapacity
assert.equal(formatCapacity(128_000), '128K')
assert.equal(formatCapacity(1_000_000), '1M')
assert.equal(formatCapacity(262_144), '262144', 'not whole thousands')
assert.equal(formatCapacity(1234), '1234')

// formatCompact
assert.equal(formatCompact(999), '999')
assert.equal(formatCompact(128_000), '128K')
assert.equal(formatCompact(262_144), '262K')
assert.equal(formatCompact(1_000_000), '1M')
assert.equal(formatCompact(1_500_000), '1.5M')

// round trips
for (const text of ['128K', '1M', '1.5M', '262144', '999']) {
  const parsed = parseCapacity(text)
  assert.equal(Number.isNaN(parsed), false, `parse ${text}`)
  assert.equal(parseCapacity(formatCapacity(parsed)), parsed, `round trip ${text} -> ${parsed} -> ${formatCapacity(parsed)}`)
}

console.log('capacity.verify OK (17+ assertions passed)')
