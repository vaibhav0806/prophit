import { describe, it, expect } from 'vitest'
import {
  formatValue,
  formatOnchain,
  formatNumber,
  formatUSD,
  formatValueAsUSD,
  truncateAddress,
  formatRelativeTime,
  formatTimestamp,
  formatUptime,
} from '@/lib/format'

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe('formatNumber', () => {
  it('formats with default 4 decimals', () => {
    expect(formatNumber(1234.5678)).toBe('1,234.5678')
  })

  it('formats with custom decimals', () => {
    expect(formatNumber(1234.5, 2)).toBe('1,234.50')
  })

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0.0000')
  })

  it('formats large numbers with commas', () => {
    expect(formatNumber(1_000_000, 0)).toBe('1,000,000')
  })

  it('pads with trailing zeros', () => {
    expect(formatNumber(5, 4)).toBe('5.0000')
  })
})

// ---------------------------------------------------------------------------
// formatUSD
// ---------------------------------------------------------------------------

describe('formatUSD', () => {
  it('formats with $ prefix and 2 decimals by default', () => {
    expect(formatUSD(1234.5)).toBe('$1,234.50')
  })

  it('formats zero', () => {
    expect(formatUSD(0)).toBe('$0.00')
  })

  it('formats with custom decimals', () => {
    expect(formatUSD(99.999, 4)).toBe('$99.9990')
  })
})

// ---------------------------------------------------------------------------
// formatValue (BigInt string → formatted number)
// ---------------------------------------------------------------------------

describe('formatValue', () => {
  it('formats 6-decimal BigInt string (USDT)', () => {
    // 1_000_000 with 6 decimals = 1.0000
    expect(formatValue('1000000', 6)).toBe('1.0000')
  })

  it('formats 18-decimal BigInt string (ETH-like)', () => {
    // 1e18 with 18 decimals = 1.0000
    expect(formatValue('1000000000000000000', 18)).toBe('1.0000')
  })

  it('returns em-dash for invalid input', () => {
    expect(formatValue('not-a-number', 6)).toBe('\u2014')
  })

  it('respects display parameter', () => {
    expect(formatValue('1500000', 6, 2)).toBe('1.50')
  })
})

// ---------------------------------------------------------------------------
// formatOnchain
// ---------------------------------------------------------------------------

describe('formatOnchain', () => {
  it('formats bigint with 6 decimals', () => {
    expect(formatOnchain(1_000_000n)).toBe('1.0000')
  })

  it('returns em-dash for undefined', () => {
    expect(formatOnchain(undefined)).toBe('\u2014')
  })

  it('formats with custom decimals and display', () => {
    // 5e17 with 18 decimals = 0.50
    expect(formatOnchain(500_000_000_000_000_000n, 18, 2)).toBe('0.50')
  })

  it('formats zero', () => {
    expect(formatOnchain(0n)).toBe('0.0000')
  })
})

// ---------------------------------------------------------------------------
// formatValueAsUSD
// ---------------------------------------------------------------------------

describe('formatValueAsUSD', () => {
  it('formats BigInt string as USD', () => {
    expect(formatValueAsUSD('1000000', 6)).toBe('$1.00')
  })

  it('returns em-dash for invalid input', () => {
    expect(formatValueAsUSD('invalid', 6)).toBe('\u2014')
  })

  it('formats with custom display decimals', () => {
    expect(formatValueAsUSD('1500000', 6, 4)).toBe('$1.5000')
  })
})

// ---------------------------------------------------------------------------
// truncateAddress
// ---------------------------------------------------------------------------

describe('truncateAddress', () => {
  it('truncates long address', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678'
    expect(truncateAddress(addr)).toBe('0x123456...345678')
  })

  it('returns em-dash for empty string', () => {
    expect(truncateAddress('')).toBe('\u2014')
  })

  it('returns short address as-is', () => {
    expect(truncateAddress('0x1234')).toBe('0x1234')
  })

  it('uses custom chars parameter', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678'
    expect(truncateAddress(addr, 4)).toBe('0x1234...5678')
  })
})

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  it('formats seconds ago', () => {
    const ts = Math.floor(Date.now() / 1000) - 30
    const result = formatRelativeTime(ts)
    expect(result.relative).toBe('30s ago')
  })

  it('formats minutes ago', () => {
    const ts = Math.floor(Date.now() / 1000) - 120
    const result = formatRelativeTime(ts)
    expect(result.relative).toBe('2m ago')
  })

  it('formats hours ago', () => {
    const ts = Math.floor(Date.now() / 1000) - 7200
    const result = formatRelativeTime(ts)
    expect(result.relative).toBe('2h ago')
  })

  it('formats days ago', () => {
    const ts = Math.floor(Date.now() / 1000) - 86400 * 3
    const result = formatRelativeTime(ts)
    expect(result.relative).toBe('3d ago')
  })

  it('formats old dates as month/day', () => {
    // 60 days ago
    const ts = Math.floor(Date.now() / 1000) - 86400 * 60
    const result = formatRelativeTime(ts)
    // Should be like "Dec 26" — not "Xd ago"
    expect(result.relative).not.toContain('ago')
  })

  it('returns a full date string', () => {
    const ts = Math.floor(Date.now() / 1000) - 60
    const result = formatRelativeTime(ts)
    expect(result.full.length).toBeGreaterThan(10)
  })
})

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe('formatTimestamp', () => {
  it('formats unix timestamp to date string', () => {
    // Jan 15, 2024 at 12:00 UTC
    const ts = 1705320000
    const result = formatTimestamp(ts)
    // Should contain month and time
    expect(result).toContain('Jan')
    expect(result).toContain('15')
  })
})

// ---------------------------------------------------------------------------
// formatUptime
// ---------------------------------------------------------------------------

describe('formatUptime', () => {
  it('formats seconds only', () => {
    expect(formatUptime(5000)).toBe('5s')
  })

  it('formats minutes and seconds', () => {
    expect(formatUptime(125_000)).toBe('2m 5s')
  })

  it('formats hours, minutes, and seconds', () => {
    expect(formatUptime(3_725_000)).toBe('1h 2m 5s')
  })

  it('formats zero', () => {
    expect(formatUptime(0)).toBe('0s')
  })

  it('formats exact hour', () => {
    expect(formatUptime(3_600_000)).toBe('1h 0m 0s')
  })
})
