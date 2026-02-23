import { formatUnits } from 'viem'

/**
 * Format a raw BigInt string value with decimals into a human-readable number.
 */
export function formatValue(value: string, decimals: number, display = 4): string {
  try {
    const num = Number(formatUnits(BigInt(value), decimals))
    return formatNumber(num, display)
  } catch {
    return '\u2014'
  }
}

/**
 * Format an on-chain bigint value.
 */
export function formatOnchain(value: bigint | undefined, decimals = 6, display = 4): string {
  if (value === undefined) return '\u2014'
  try {
    const num = Number(formatUnits(value, decimals))
    return formatNumber(num, display)
  } catch {
    return '\u2014'
  }
}

/**
 * Format a number with commas for thousands and fixed decimals.
 */
export function formatNumber(num: number, decimals = 4): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format a number as USD (with $ prefix).
 */
export function formatUSD(num: number, decimals = 2): string {
  return '$' + num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format a raw BigInt string as USD.
 */
export function formatValueAsUSD(value: string, decimals: number, display = 2): string {
  try {
    const num = Number(formatUnits(BigInt(value), decimals))
    return formatUSD(num, display)
  } catch {
    return '\u2014'
  }
}

/**
 * Truncate a hex address to "0x1234...abcd" format.
 */
export function truncateAddress(hex: string, chars = 6): string {
  if (!hex) return '\u2014'
  if (hex.length <= chars * 2 + 2) return hex
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`
}

/**
 * Format a unix timestamp (seconds) as relative time.
 * Shows "2 min ago", "3h ago", etc. with full date on hover.
 */
export function formatRelativeTime(ts: number): { relative: string; full: string } {
  const date = new Date(ts * 1000)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  let relative: string
  if (diffSec < 60) {
    relative = `${diffSec}s ago`
  } else if (diffMin < 60) {
    relative = `${diffMin}m ago`
  } else if (diffHour < 24) {
    relative = `${diffHour}h ago`
  } else if (diffDay < 30) {
    relative = `${diffDay}d ago`
  } else {
    relative = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const full = date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return { relative, full }
}

/**
 * Format a unix timestamp to a date string.
 */
export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Format uptime in ms to human-readable format.
 */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
