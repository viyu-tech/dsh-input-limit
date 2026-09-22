import { describe, expect, it } from 'vitest'
import { formatCompact, formatTokens, parseTokens } from '../src/client/capacity.ts'

describe('parseTokens', () => {
  it('accepts exact token counts', () => {
    expect(parseTokens('131072')).toEqual({ status: 'ok', tokens: 131_072 })
    expect(parseTokens('  131072 ')).toEqual({ status: 'ok', tokens: 131_072 })
  })

  it('accepts digit grouping it also renders', () => {
    expect(parseTokens('131,072')).toEqual({ status: 'ok', tokens: 131_072 })
    // Grouping commas are display-only separators that never change scale,
    // and the popover pre-fills the grouped spelling when it reopens — so
    // editing that text must stay valid instead of bouncing the user off:
    expect(parseTokens('20,000')).toEqual({ status: 'ok', tokens: 20_000 })
    expect(parseTokens('20,0000')).toEqual({ status: 'ok', tokens: 200_000 }) // digit appended to the prefill
    expect(parseTokens('20,00')).toEqual({ status: 'ok', tokens: 2_000 }) // digit deleted from the prefill
    expect(parseTokens('13,1072')).toEqual({ status: 'ok', tokens: 131_072 })
    expect(parseTokens('1,2,3')).toEqual({ status: 'ok', tokens: 123 })
  })

  it('rejects commas that are not between digit groups', () => {
    expect(parseTokens(',131072').status).toBe('invalid')
    expect(parseTokens('131072,').status).toBe('invalid')
    expect(parseTokens('13,,1072').status).toBe('invalid')
  })

  it('treats a blank field as its own status', () => {
    expect(parseTokens('')).toEqual({ status: 'empty' })
    expect(parseTokens('   ')).toEqual({ status: 'empty' })
  })

  it('rejects suffix units — the field speaks tokens only', () => {
    expect(parseTokens('128K').status).toBe('invalid')
    expect(parseTokens('1M').status).toBe('invalid')
    expect(parseTokens('1.5m').status).toBe('invalid')
  })

  it('rejects non-positive integers and unreadable text', () => {
    expect(parseTokens('0').status).toBe('invalid')
    expect(parseTokens('-1').status).toBe('invalid')
    expect(parseTokens('1.5').status).toBe('invalid')
    expect(parseTokens('12x').status).toBe('invalid')
    expect(parseTokens('1e6').status).toBe('invalid')
    expect(parseTokens('99999999999999999999').status).toBe('invalid')
  })
})

describe('formatTokens', () => {
  it('groups digits for display and round-trips through the parser', () => {
    expect(formatTokens(131_072)).toBe('131,072')
    expect(formatTokens(1_000_000)).toBe('1,000,000')
    expect(formatTokens(512)).toBe('512')
    expect(parseTokens(formatTokens(262_144))).toEqual({ status: 'ok', tokens: 262_144 })
  })
})

describe('formatCompact', () => {
  it('stays exact below 1K', () => {
    expect(formatCompact(512)).toBe('512')
  })

  it('abbreviates in binary scale — the convention model windows are quoted in', () => {
    expect(formatCompact(131_072)).toBe('128K')
    expect(formatCompact(262_144)).toBe('256K')
    expect(formatCompact(1_048_576)).toBe('1M')
    expect(formatCompact(1_572_864)).toBe('1.5M')
  })
})
