'use client'

import { formatNumber } from '@/lib/format'

interface YieldSummaryProps {
  totalDeployed: number
  totalPnl: number
  weightedAvgYield: number
  activePositions: number
}

function SummaryCard({
  label,
  children,
  accent,
}: {
  label: string
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <div
      className={`
        rounded-xl p-5 border transition-colors
        ${accent
          ? 'bg-emerald-500/5 border-emerald-500/15'
          : 'bg-gray-900/50 border-gray-800/60'
        }
      `}
    >
      <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">{label}</div>
      <div>{children}</div>
    </div>
  )
}

export function YieldSummary({
  totalDeployed,
  totalPnl,
  weightedAvgYield,
  activePositions,
}: YieldSummaryProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <SummaryCard label="Total Deployed">
        <div className="text-xl font-mono font-bold tabular-nums">
          {formatNumber(totalDeployed, 2)}
          <span className="text-sm text-gray-500 font-normal ml-1">USDT</span>
        </div>
      </SummaryCard>
      <SummaryCard label="Total P&L" accent={totalPnl > 0}>
        <div className={`text-xl font-mono font-bold tabular-nums ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {totalPnl >= 0 ? '+' : ''}{formatNumber(totalPnl, 2)}
          <span className="text-sm opacity-60 font-normal ml-1">USDT</span>
        </div>
      </SummaryCard>
      <SummaryCard label="Return on Capital" accent={weightedAvgYield > 0}>
        <div className={`text-xl font-mono font-bold tabular-nums ${weightedAvgYield >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {weightedAvgYield >= 0 ? '+' : ''}{weightedAvgYield.toFixed(2)}%
        </div>
      </SummaryCard>
      <SummaryCard label="Active Positions">
        <div className="text-xl font-mono font-bold tabular-nums">
          {activePositions}
        </div>
      </SummaryCard>
    </div>
  )
}
