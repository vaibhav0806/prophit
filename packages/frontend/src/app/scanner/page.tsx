'use client'

import { useOpportunities, Opportunity } from '@/hooks/use-agent-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { formatValue, formatValueAsUSD, truncateAddress } from '@/lib/format'

const PROTOCOL_COLORS: Record<string, string> = {
  PancakeSwap: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  BiSwap: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Thena: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  ApolloX: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  default: 'bg-gray-700/30 text-gray-300 border-gray-600/30',
}

function protocolBadge(name: string) {
  const colors = PROTOCOL_COLORS[name] || PROTOCOL_COLORS.default
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${colors}`}>
      {name}
    </span>
  )
}

function spreadColor(bps: number): string {
  if (bps > 300) return 'text-emerald-400'
  if (bps > 200) return 'text-emerald-400/80'
  if (bps >= 100) return 'text-yellow-400'
  if (bps >= 50) return 'text-orange-400'
  return 'text-red-400'
}

function spreadBg(bps: number): string {
  if (bps > 300) return 'bg-emerald-500/10'
  if (bps > 200) return 'bg-emerald-500/5'
  return ''
}

function SkeletonTable() {
  return (
    <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-800/60">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-4 w-20 ml-auto" />
        </div>
      </div>
      <div className="divide-y divide-gray-800/40">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-4 py-4 flex items-center gap-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-3 w-16 ml-auto" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ScannerPage() {
  const { data: opportunities, isLoading, error, dataUpdatedAt } = useOpportunities()

  const bestIndex = opportunities && opportunities.length > 0
    ? opportunities.reduce((best, opp, idx) => opp.spreadBps > opportunities[best].spreadBps ? idx : best, 0)
    : -1

  return (
    <ErrorBoundary>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Arbitrage Scanner</h1>
            <p className="text-sm text-gray-500 mt-1">
              Cross-protocol opportunity detection
            </p>
          </div>
          <div className="flex items-center gap-3">
            {dataUpdatedAt > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                Live
              </div>
            )}
            {opportunities && (
              <div className="text-xs text-gray-500 bg-gray-900/60 border border-gray-800/60 rounded-lg px-3 py-1.5 font-mono tabular-nums">
                {opportunities.length} opportunit{opportunities.length === 1 ? 'y' : 'ies'}
              </div>
            )}
          </div>
        </div>

        {isLoading && <SkeletonTable />}

        {error && (
          <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl p-5">
            <div className="font-medium mb-1">Failed to load opportunities</div>
            <div className="text-sm text-red-400/70">{(error as Error).message}</div>
          </div>
        )}

        {opportunities && opportunities.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
              <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <div className="text-gray-400 font-medium">No opportunities detected</div>
            <div className="text-sm text-gray-600 mt-1">The scanner is monitoring protocols for price discrepancies</div>
          </div>
        )}

        {opportunities && opportunities.length > 0 && (
          <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/80 text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 text-left font-medium">Market</th>
                    <th className="px-4 py-3 text-left font-medium">Protocol A</th>
                    <th className="px-4 py-3 text-left font-medium">Protocol B</th>
                    <th className="px-4 py-3 text-right font-medium">YES Price A</th>
                    <th className="px-4 py-3 text-right font-medium">NO Price B</th>
                    <th className="px-4 py-3 text-right font-medium">Total Cost</th>
                    <th className="px-4 py-3 text-right font-medium">Spread</th>
                    <th className="px-4 py-3 text-right font-medium">Est. Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/40">
                  {opportunities.map((opp: Opportunity, i: number) => {
                    const isBest = i === bestIndex
                    return (
                      <tr
                        key={`${opp.marketId}-${i}`}
                        className={`
                          transition-colors hover:bg-gray-800/30
                          ${isBest ? 'row-glow' : ''}
                          ${spreadBg(opp.spreadBps)}
                        `}
                      >
                        <td className="px-4 py-3.5 font-mono text-xs text-gray-400">
                          {truncateAddress(opp.marketId, 6)}
                        </td>
                        <td className="px-4 py-3.5">{protocolBadge(opp.protocolA)}</td>
                        <td className="px-4 py-3.5">{protocolBadge(opp.protocolB)}</td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                          {formatValue(opp.yesPriceA, 18)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                          {formatValue(opp.noPriceB, 18)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                          {formatValue(opp.totalCost, 18)}
                        </td>
                        <td className={`px-4 py-3.5 text-right font-mono tabular-nums font-semibold ${spreadColor(opp.spreadBps)}`}>
                          {opp.spreadBps} bps
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums font-semibold text-emerald-400">
                          {formatValueAsUSD(opp.estProfit, 6)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
