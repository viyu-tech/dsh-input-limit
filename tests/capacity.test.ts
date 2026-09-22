import { describe, expect, it } from 'vitest'
import { formatCapacity, formatCompact, parseCapacity } from '../src/client/capacity.ts'

describe('parseCapacity', () => {
  it('accepts plain token counts', () => {
    expect(parseCapacity('128000')).toBe(128_000)
    expect(parseCapacity('0')).toBe(0)
  })

  it('accepts K/M suffixes', () => {
    expect(parseCapacity('128K')).toBe(128_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(parseCapacity('1.5M')).toBe(1_500_000)
  })

  it('treats a blank field as inherit', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('   ')).toBeUndefined()
  })

  it('rejects unreadable text', () => {
    expect(parseCapacity('12x')).toBeNaN()
    expect(parseCapacity('-128K')).toBeNaN()
  })
})

describe('formatCapacity', () => {
  it('round-trips suffix spellings', () => {
    expect(formatCapacity(128_000)).toBe('128K')
    expect(formatCapacity(1_000_000)).toBe('1M')
  })

  it('writes out counts that are not whole thousands', () => {
    expect(formatCapacity(262_144)).toBe('262144')
    expect(formatCapacity(1234)).toBe('1234')
  })
})

describe('formatCompact', () => {
  it('stays exact below 1000', () => {
    expect(formatCompact(999)).toBe('999')
  })

  it('abbreviates thousands', () => {
    expect(formatCompact(128_000)).toBe('128K')
    expect(formatCompact(262_144)).toBe('262K')
  })

  it('abbreviates millions with one decimal', () => {
    expect(formatCompact(1_000_000)).toBe('1M')
    expect(formatCompact(1_500_000)).toBe('1.5M')
  })
})
