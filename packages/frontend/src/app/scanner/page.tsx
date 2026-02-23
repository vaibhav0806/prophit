'use client'

import { formatUnits } from 'viem'
import { useOpportunities, Opportunity } from '@/hooks/use-agent-api'

function formatValue(value: string, decimals: number, display = 4): string {
  try {
    return Number(formatUnits(BigInt(value), decimals)).toFixed(display)
  } catch {
    return '\u2014'
  }
}

function truncate(hex: string, chars = 8): string {
  if (hex.length <= chars * 2 + 2) return hex
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`
}

function spreadColor(bps: number): string {
  if (bps > 200) return 'text-emerald-400'
  if (bps >= 100) return 'text-yellow-400'
  return 'text-red-400'
}

export default function ScannerPage() {
  const { data: opportunities, isLoading, error } = useOpportunities()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Arbitrage Scanner</h1>

      {isLoading && (
        <div className="text-gray-400 animate-pulse">Loading opportunities...</div>
      )}

      {error && (
        <div className="text-red-400 bg-red-950/50 border border-red-900 rounded-lg p-4">
          Failed to load opportunities: {(error as Error).message}
        </div>
      )}

      {opportunities && opportunities.length === 0 && (
        <div className="text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          No opportunities found
        </div>
      )}

      {opportunities && opportunities.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="pb-3 pr-4">Market ID</th>
                <th className="pb-3 pr-4">Protocol A</th>
                <th className="pb-3 pr-4">Protocol B</th>
                <th className="pb-3 pr-4 text-right">YES Price A</th>
                <th className="pb-3 pr-4 text-right">NO Price B</th>
                <th className="pb-3 pr-4 text-right">Total Cost</th>
                <th className="pb-3 pr-4 text-right">Spread (bps)</th>
                <th className="pb-3 text-right">Est. Profit</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opp: Opportunity, i: number) => (
                <tr
                  key={`${opp.marketId}-${i}`}
                  className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors"
                >
                  <td className="py-3 pr-4 font-mono text-xs">{truncate(opp.marketId)}</td>
                  <td className="py-3 pr-4">{opp.protocolA}</td>
                  <td className="py-3 pr-4">{opp.protocolB}</td>
                  <td className="py-3 pr-4 text-right font-mono">{formatValue(opp.yesPriceA, 18)}</td>
                  <td className="py-3 pr-4 text-right font-mono">{formatValue(opp.noPriceB, 18)}</td>
                  <td className="py-3 pr-4 text-right font-mono">{formatValue(opp.totalCost, 18)}</td>
                  <td className={`py-3 pr-4 text-right font-mono font-semibold ${spreadColor(opp.spreadBps)}`}>
                    {opp.spreadBps}
                  </td>
                  <td className="py-3 text-right font-mono text-emerald-400">
                    {formatValue(opp.estProfit, 6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
