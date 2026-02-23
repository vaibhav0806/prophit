'use client'

import { useMemo } from 'react'
import { formatUnits } from 'viem'
import { usePositions } from '@/hooks/use-agent-api'
import { useVaultBalance } from '@/hooks/use-vault'
import { ErrorBoundary } from '@/components/error-boundary'
import { YieldSummary } from '@/components/yield/yield-summary'
import { AllocationBar } from '@/components/yield/allocation-bar'
import { formatOnchain, formatNumber } from '@/lib/format'

function toNumber(value: string, decimals: number): number {
  try {
    return Number(formatUnits(BigInt(value), decimals))
  } catch {
    return 0
  }
}

interface ProtocolStats {
  protocol: string
  totalCost: number
  positionCount: number
  openCount: number
  closedCount: number
}

function SkeletonYield() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-5">
            <div className="skeleton h-3 w-20 mb-3" />
            <div className="skeleton h-6 w-28" />
          </div>
        ))}
      </div>
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
        <div className="skeleton h-4 w-32 mb-4" />
        <div className="skeleton h-3 w-full rounded-full" />
      </div>
    </div>
  )
}

export default function YieldPage() {
  const { data: positions, isLoading, error } = usePositions()
  const { data: vaultBalance } = useVaultBalance()

  const stats = useMemo(() => {
    if (!positions) return null

    const byProtocol = new Map<string, ProtocolStats>()
    let totalDeployed = 0
    let activeCount = 0

    for (const pos of positions) {
      const cost = toNumber(pos.costA, 6) + toNumber(pos.costB, 6)
      totalDeployed += cost
      if (!pos.closed) activeCount++

      const label = pos.boughtYesOnA ? 'YES-A / NO-B' : 'NO-A / YES-B'
      const existing = byProtocol.get(label) || {
        protocol: label,
        totalCost: 0,
        positionCount: 0,
        openCount: 0,
        closedCount: 0,
      }
      existing.totalCost += cost
      existing.positionCount++
      if (pos.closed) existing.closedCount++
      else existing.openCount++
      byProtocol.set(label, existing)
    }

    let closedCost = 0
    let closedPayout = 0
    for (const pos of positions) {
      if (pos.closed) {
        const cost = toNumber(pos.costA, 6) + toNumber(pos.costB, 6)
        closedCost += cost
        const sharesA = toNumber(pos.sharesA, 6)
        const sharesB = toNumber(pos.sharesB, 6)
        closedPayout += Math.min(sharesA, sharesB)
      }
    }

    const totalPnl = closedPayout - closedCost
    const weightedAvgYield = totalDeployed > 0 ? (totalPnl / totalDeployed) * 100 : 0

    const segments = Array.from(byProtocol.values()).map((s) => ({
      protocol: s.protocol,
      amount: s.totalCost,
      color: '',
    }))

    return {
      totalDeployed,
      totalPnl,
      weightedAvgYield,
      activePositions: activeCount,
      segments,
      byProtocol: Array.from(byProtocol.values()),
    }
  }, [positions])

  return (
    <ErrorBoundary>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Yield Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">Capital deployment and returns overview</p>
          </div>
        </div>

        {/* Vault Balance */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-5 mb-6">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Vault Balance</div>
          <div className="text-2xl font-mono font-bold text-emerald-400 tabular-nums">
            {formatOnchain(vaultBalance as bigint | undefined)}
            <span className="text-sm text-gray-500 font-normal ml-1">USDT</span>
          </div>
        </div>

        {isLoading && <SkeletonYield />}

        {error && (
          <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl p-5">
            <div className="font-medium mb-1">Failed to load positions</div>
            <div className="text-sm text-red-400/70">{(error as Error).message}</div>
          </div>
        )}

        {positions && positions.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
              <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
              </svg>
            </div>
            <div className="text-gray-400 font-medium">No yield data available</div>
            <div className="text-sm text-gray-600 mt-1">Yield will be calculated once positions are opened</div>
          </div>
        )}

        {stats && positions && positions.length > 0 && (
          <div className="space-y-6">
            <YieldSummary
              totalDeployed={stats.totalDeployed}
              totalPnl={stats.totalPnl}
              weightedAvgYield={stats.weightedAvgYield}
              activePositions={stats.activePositions}
            />

            {/* Allocation */}
            <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
              <h2 className="text-base font-semibold mb-4">Capital Allocation</h2>
              <AllocationBar
                segments={stats.segments}
                total={stats.totalDeployed}
              />
            </div>

            {/* Strategy Breakdown Table */}
            <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800/60">
                <h2 className="text-base font-semibold">Positions by Strategy</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800/80 text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="px-5 py-3 text-left font-medium">Strategy</th>
                      <th className="px-5 py-3 text-right font-medium">Total Cost</th>
                      <th className="px-5 py-3 text-right font-medium">Positions</th>
                      <th className="px-5 py-3 text-right font-medium">Open</th>
                      <th className="px-5 py-3 text-right font-medium">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/40">
                    {stats.byProtocol.map((row, i) => (
                      <tr
                        key={row.protocol}
                        className={`transition-colors hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/30'}`}
                      >
                        <td className="px-5 py-3.5 font-medium text-gray-300">{row.protocol}</td>
                        <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                          {formatNumber(row.totalCost, 4)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono tabular-nums">{row.positionCount}</td>
                        <td className="px-5 py-3.5 text-right font-mono tabular-nums text-blue-400">{row.openCount}</td>
                        <td className="px-5 py-3.5 text-right font-mono tabular-nums text-emerald-400">{row.closedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Returns Summary */}
            <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
              <h2 className="text-base font-semibold mb-4">Returns Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <div>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Total Invested</div>
                  <div className="font-mono font-medium tabular-nums">
                    {formatNumber(stats.totalDeployed, 4)} <span className="text-gray-500">USDT</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Realized P&L</div>
                  <div className={`font-mono font-medium tabular-nums ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.totalPnl >= 0 ? '+' : ''}{formatNumber(stats.totalPnl, 4)} <span className="opacity-60">USDT</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Return on Capital</div>
                  <div className={`font-mono font-medium tabular-nums ${stats.weightedAvgYield >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.weightedAvgYield >= 0 ? '+' : ''}{stats.weightedAvgYield.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
