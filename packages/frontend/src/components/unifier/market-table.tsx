'use client'

import { Opportunity } from '@/hooks/use-agent-api'
import { formatValue, formatValueAsUSD, truncateAddress } from '@/lib/format'

const PROTOCOL_COLORS: Record<string, string> = {
  PancakeSwap: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  BiSwap: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Thena: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  ApolloX: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
}

const DEFAULT_PROTOCOL_COLOR = 'bg-gray-700/30 text-gray-300 border-gray-600/30'

function protocolBadge(name: string) {
  const colors = PROTOCOL_COLORS[name] || DEFAULT_PROTOCOL_COLOR
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

interface MarketTableProps {
  opportunities: Opportunity[]
  protocolFilter: string
  matchFilter: 'all' | 'matched' | 'unmatched'
  sortBySpread: boolean
}

export function MarketTable({
  opportunities,
  protocolFilter,
  matchFilter,
  sortBySpread,
}: MarketTableProps) {
  const marketGroups = new Map<string, Opportunity[]>()
  for (const opp of opportunities) {
    const key = opp.marketId
    const group = marketGroups.get(key) || []
    group.push(opp)
    marketGroups.set(key, group)
  }

  let filtered = opportunities.filter((opp) => {
    if (protocolFilter && opp.protocolA !== protocolFilter && opp.protocolB !== protocolFilter) {
      return false
    }
    const group = marketGroups.get(opp.marketId) || []
    const isMatched = group.length > 1 || (opp.protocolA !== opp.protocolB)
    if (matchFilter === 'matched' && !isMatched) return false
    if (matchFilter === 'unmatched' && isMatched) return false
    return true
  })

  if (sortBySpread) {
    filtered = [...filtered].sort((a, b) => b.spreadBps - a.spreadBps)
  }

  if (filtered.length === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
        <div className="text-gray-400 font-medium">No markets match current filters</div>
        <div className="text-sm text-gray-600 mt-1">Try adjusting your filter criteria</div>
      </div>
    )
  }

  return (
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
              <th className="px-4 py-3 text-right font-medium">Spread</th>
              <th className="px-4 py-3 text-right font-medium">Est. Profit</th>
              <th className="px-4 py-3 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/40">
            {filtered.map((opp, i) => {
              const isMatched = opp.protocolA !== opp.protocolB
              return (
                <tr
                  key={`${opp.marketId}-${i}`}
                  className="transition-colors hover:bg-gray-800/30"
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
                  <td className={`px-4 py-3.5 text-right font-mono tabular-nums font-semibold ${spreadColor(opp.spreadBps)}`}>
                    {opp.spreadBps} bps
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums font-semibold text-emerald-400">
                    {formatValueAsUSD(opp.estProfit, 6)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {isMatched ? (
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Matched
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-gray-700/30 text-gray-500 border border-gray-600/30">
                        Single
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
