'use client'

import { formatUnits } from 'viem'
import { usePositions, Position } from '@/hooks/use-agent-api'
import { useVaultBalance } from '@/hooks/use-vault'

function formatValue(value: string, decimals: number, display = 4): string {
  try {
    return Number(formatUnits(BigInt(value), decimals)).toFixed(display)
  } catch {
    return '\u2014'
  }
}

function formatOnchain(value: bigint | undefined, decimals = 6, display = 4): string {
  if (value === undefined) return '...'
  try {
    return Number(formatUnits(value, decimals)).toFixed(display)
  } catch {
    return '\u2014'
  }
}

function truncate(hex: string, chars = 8): string {
  if (hex.length <= chars * 2 + 2) return hex
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

export default function PositionsPage() {
  const { data: positions, isLoading, error } = usePositions()
  const { data: vaultBalance } = useVaultBalance()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Active Positions</h1>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <div className="text-sm text-gray-400">Vault Balance</div>
        <div className="text-2xl font-mono font-bold text-emerald-400">
          {formatOnchain(vaultBalance as bigint | undefined)} USDT
        </div>
      </div>

      {isLoading && (
        <div className="text-gray-400 animate-pulse">Loading positions...</div>
      )}

      {error && (
        <div className="text-red-400 bg-red-950/50 border border-red-900 rounded-lg p-4">
          Failed to load positions: {(error as Error).message}
        </div>
      )}

      {positions && positions.length === 0 && (
        <div className="text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          No positions found
        </div>
      )}

      {positions && positions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {positions.map((pos: Position) => (
            <div
              key={pos.id}
              className={`bg-gray-900 border rounded-lg p-4 ${
                pos.closed ? 'border-emerald-800' : 'border-gray-800'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-300">
                  Position #{pos.id}
                </span>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    pos.closed
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {pos.closed ? 'Closed' : 'Open'}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Market A</span>
                  <span className="font-mono text-xs">{truncate(pos.marketIdA)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Market B</span>
                  <span className="font-mono text-xs">{truncate(pos.marketIdB)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Direction</span>
                  <span>{pos.boughtYesOnA ? 'YES on A / NO on B' : 'NO on A / YES on B'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Shares A</span>
                  <span className="font-mono">{formatValue(pos.sharesA, 6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Shares B</span>
                  <span className="font-mono">{formatValue(pos.sharesB, 6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cost A</span>
                  <span className="font-mono">{formatValue(pos.costA, 6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cost B</span>
                  <span className="font-mono">{formatValue(pos.costB, 6)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-800 pt-2">
                  <span className="text-gray-400 font-medium">Total Cost</span>
                  <span className="font-mono font-medium">{formatValue(pos.totalCost, 6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Opened</span>
                  <span className="text-xs">{formatTimestamp(pos.openedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
