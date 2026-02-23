'use client'

import { usePositions, Position } from '@/hooks/use-agent-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { useVaultBalance } from '@/hooks/use-vault'
import { formatValue, formatOnchain, truncateAddress, formatRelativeTime, formatNumber } from '@/lib/format'

function SkeletonCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-5 w-14 rounded-full" />
          </div>
          <div className="space-y-3">
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton h-3 w-5/6" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function PositionCard({ pos }: { pos: Position }) {
  const costA = Number(pos.costA) / 1e6
  const costB = Number(pos.costB) / 1e6
  const totalCost = costA + costB
  const sharesA = Number(pos.sharesA) / 1e6
  const sharesB = Number(pos.sharesB) / 1e6
  const guaranteedPayout = Math.min(sharesA, sharesB)
  const pnl = guaranteedPayout - totalCost
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0
  const { relative, full } = formatRelativeTime(pos.openedAt)

  return (
    <div
      className={`
        bg-gray-900/50 border rounded-xl p-5 transition-all duration-200 hover:border-gray-700/80
        ${pos.closed ? 'border-emerald-500/20' : 'border-gray-800/60'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-gray-200">
            Position #{pos.positionId}
          </span>
        </div>
        <span
          className={`
            text-[11px] px-2.5 py-1 rounded-full font-medium uppercase tracking-wide
            ${pos.closed
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
            }
          `}
        >
          {pos.closed ? 'Closed' : 'Open'}
        </span>
      </div>

      {/* P&L Display */}
      <div className={`
        flex items-baseline gap-2 mb-4 pb-4 border-b border-gray-800/50
      `}>
        <span className={`text-xl font-mono font-bold tabular-nums ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {pnl >= 0 ? '+' : ''}{formatNumber(pnl, 4)}
        </span>
        <span className="text-xs text-gray-500">USDT</span>
        <span className={`text-xs font-mono tabular-nums ml-auto ${pnl >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
          {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
        </span>
      </div>

      {/* Details */}
      <div className="space-y-2.5 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-gray-500">Direction</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-800/60 text-gray-300">
            {pos.boughtYesOnA ? 'YES on A / NO on B' : 'NO on A / YES on B'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Market A</span>
          <span className="font-mono text-xs text-gray-400">{truncateAddress(pos.marketIdA)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Market B</span>
          <span className="font-mono text-xs text-gray-400">{truncateAddress(pos.marketIdB)}</span>
        </div>

        <div className="h-px bg-gray-800/50 my-1" />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[11px] text-gray-600 uppercase tracking-wide">Shares A</div>
            <div className="font-mono text-sm tabular-nums">{formatValue(pos.sharesA, 6)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-600 uppercase tracking-wide">Shares B</div>
            <div className="font-mono text-sm tabular-nums">{formatValue(pos.sharesB, 6)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-600 uppercase tracking-wide">Cost A</div>
            <div className="font-mono text-sm tabular-nums">{formatValue(pos.costA, 6)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-600 uppercase tracking-wide">Cost B</div>
            <div className="font-mono text-sm tabular-nums">{formatValue(pos.costB, 6)}</div>
          </div>
        </div>

        <div className="h-px bg-gray-800/50 my-1" />

        <div className="flex justify-between">
          <span className="text-gray-500">Total Cost</span>
          <span className="font-mono font-medium tabular-nums">{formatNumber(totalCost, 4)} USDT</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Guaranteed Payout</span>
          <span className="font-mono font-medium tabular-nums text-emerald-400/80">{formatNumber(guaranteedPayout, 4)} USDT</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Opened</span>
          <span className="text-xs text-gray-400" title={full}>{relative}</span>
        </div>
      </div>
    </div>
  )
}

export default function PositionsPage() {
  const { data: positions, isLoading, error } = usePositions()
  const { data: vaultBalance } = useVaultBalance()

  const openPositions = positions?.filter(p => !p.closed) ?? []
  const closedPositions = positions?.filter(p => p.closed) ?? []

  return (
    <ErrorBoundary>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Positions</h1>
            <p className="text-sm text-gray-500 mt-1">Active and closed arbitrage positions</p>
          </div>
          {positions && (
            <div className="flex items-center gap-3">
              <div className="text-xs text-gray-500 bg-gray-900/60 border border-gray-800/60 rounded-lg px-3 py-1.5">
                <span className="font-mono tabular-nums">{openPositions.length}</span> open
              </div>
              <div className="text-xs text-gray-500 bg-gray-900/60 border border-gray-800/60 rounded-lg px-3 py-1.5">
                <span className="font-mono tabular-nums">{closedPositions.length}</span> closed
              </div>
            </div>
          )}
        </div>

        {/* Vault Balance Card */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-5 mb-6">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Vault Balance</div>
          <div className="text-2xl font-mono font-bold text-emerald-400 tabular-nums">
            {formatOnchain(vaultBalance as bigint | undefined)} <span className="text-sm text-gray-500 font-normal">USDT</span>
          </div>
        </div>

        {isLoading && <SkeletonCards />}

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
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
              </svg>
            </div>
            <div className="text-gray-400 font-medium">No positions yet</div>
            <div className="text-sm text-gray-600 mt-1">Positions will appear here once the agent executes trades</div>
          </div>
        )}

        {positions && positions.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {positions.map((pos: Position) => (
              <PositionCard key={pos.positionId} pos={pos} />
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
