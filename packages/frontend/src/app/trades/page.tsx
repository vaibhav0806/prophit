'use client'

import { Fragment, useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTrades } from '@/hooks/use-platform-api'
import type { Trade, TradeLeg } from '@/hooks/use-platform-api'
import { useAuth } from '@/hooks/use-auth'
import { formatUSD, truncateAddress, formatRelativeTime } from '@/lib/format'

const PAGE_SIZE = 20

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-[#F0B90B]/10 text-[#F0B90B] border-[#F0B90B]/20',
  PARTIAL: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  FILLED: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  CLOSED: 'bg-[#1A1A1A]/60 text-gray-400 border-[#2A2A2A]',
  EXPIRED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.CLOSED
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide border ${style}`}>
      {status}
    </span>
  )
}

function PnlCell({ pnl }: { pnl: number | null }) {
  if (pnl === null) {
    return <span className="text-gray-600 font-mono tabular-nums">&mdash;</span>
  }
  const isPositive = pnl > 0
  const isNegative = pnl < 0
  return (
    <span className={`font-mono tabular-nums font-medium ${isPositive ? 'text-[#00FF88]' : isNegative ? 'text-[#FF4757]' : 'text-gray-400'}`}>
      {isPositive ? '+' : ''}{formatUSD(pnl, 2)}
    </span>
  )
}

function PlatformBadge({ name }: { name: string }) {
  const label = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  return (
    <span className="inline-block px-1.5 py-px rounded text-[9px] font-medium uppercase tracking-wider border border-[#2A2A2A] text-gray-500 bg-[#0A0A0A]">
      {label}
    </span>
  )
}

function LegDetail({ leg, label }: { leg: TradeLeg | null; label: string }) {
  if (!leg) {
    return (
      <div className="flex-1 min-w-0 p-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
        <div className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">{label}</div>
        <div className="text-xs text-gray-600">No data</div>
      </div>
    )
  }

  const platformLabel = leg.platform.charAt(0).toUpperCase() + leg.platform.slice(1).toLowerCase()
  const sideColor = leg.side === 'BUY' ? 'text-[#00FF88]' : 'text-[#FF4757]'

  return (
    <div className="flex-1 min-w-0 p-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[10px] uppercase tracking-wider text-gray-600">{label}</div>
        <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-px rounded border border-[#2A2A2A] text-gray-400">
          {platformLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-gray-600">Side </span>
          <span className={`font-medium ${sideColor}`}>{leg.side}</span>
        </div>
        <div>
          <span className="text-gray-600">Price </span>
          <span className="font-mono tabular-nums text-gray-300">{leg.price.toFixed(4)}</span>
        </div>
        <div>
          <span className="text-gray-600">Size </span>
          <span className="font-mono tabular-nums text-gray-300">{leg.size.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-600">Filled </span>
          <span className="font-mono tabular-nums text-gray-300">{leg.filledSize.toFixed(2)}</span>
          {leg.filled && <span className="text-[#00FF88] ml-1 text-[10px]">&#10003;</span>}
        </div>
      </div>

      {(leg.orderId || leg.transactionHash) && (
        <div className="mt-2.5 pt-2 border-t border-[#1A1A1A] space-y-1">
          {leg.orderId && (
            <div className="text-[10px]">
              <span className="text-gray-600">Order </span>
              <span className="font-mono text-gray-500">{truncateAddress(leg.orderId, 6)}</span>
            </div>
          )}
          {leg.transactionHash && (
            <div className="text-[10px]">
              <span className="text-gray-600">Tx </span>
              <span className="font-mono text-gray-500">{truncateAddress(leg.transactionHash, 6)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ExpandedRow({ trade }: { trade: Trade }) {
  return (
    <tr>
      <td colSpan={8} className="p-0">
        <div className="px-4 pb-4 pt-0">
          <div className="rounded-xl bg-[#0E0E0E] border border-[#1A1A1A] p-4 space-y-3">
            {/* Legs side by side */}
            <div className="flex gap-3">
              <LegDetail leg={trade.legA} label="Leg A" />
              <LegDetail leg={trade.legB} label="Leg B" />
            </div>

            {/* Market details */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-gray-600 pt-1">
              {trade.marketCategory && (
                <div>
                  <span className="text-gray-600">Category </span>
                  <span className="text-gray-400">{trade.marketCategory}</span>
                </div>
              )}
              {trade.resolvesAt && (
                <div>
                  <span className="text-gray-600">Resolves </span>
                  <span className="text-gray-400 font-mono tabular-nums">
                    {new Date(trade.resolvesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}
              <div>
                <span className="text-gray-600">ID </span>
                <span className="font-mono text-gray-500">{truncateAddress(trade.marketId, 8)}</span>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

function SkeletonTable() {
  return (
    <div className="card rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-[#1F1F1F]">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-4 w-16 ml-auto" />
        </div>
      </div>
      <div className="divide-y divide-[#1F1F1F]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-4 py-4 flex items-center gap-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-5 w-16" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-12" />
            <div className="skeleton h-3 w-16 ml-auto" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TradesPage() {
  const router = useRouter()
  const { isAuthenticated, isReady } = useAuth()
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [allTrades, setAllTrades] = useState<Trade[]>([])

  const { data, isLoading, isFetching } = useTrades(PAGE_SIZE, offset)

  // Auth guard
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isReady, isAuthenticated, router])

  // Accumulate trades for pagination
  useEffect(() => {
    if (!data?.trades) return
    setAllTrades((prev) => {
      if (offset === 0) return data.trades
      const existingIds = new Set(prev.map((t) => t.id))
      const newTrades = data.trades.filter((t) => !existingIds.has(t.id))
      return [...prev, ...newTrades]
    })
  }, [data, offset])

  const hasMore = useMemo(() => {
    if (!data?.trades) return false
    return data.trades.length === PAGE_SIZE
  }, [data])

  const handleLoadMore = () => {
    setOffset((prev) => prev + PAGE_SIZE)
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  if (!isReady || !isAuthenticated) return null

  return (
    <div className="page-enter p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight heading-accent">Trade History</h1>
          <p className="text-sm text-gray-500 mt-1">
            {allTrades.length > 0 && (
              <span className="font-mono tabular-nums">{allTrades.length}</span>
            )}
            {allTrades.length > 0 ? ' trades loaded' : 'Past arbitrage executions'}
          </p>
        </div>
      </div>

      {isLoading && offset === 0 && <SkeletonTable />}

      {!isLoading && allTrades.length === 0 && (
        <div className="card rounded-2xl p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#F0B90B]/5 border border-[#F0B90B]/10 mb-4">
            <svg className="w-6 h-6 text-[#F0B90B]/40 spin-ring" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
          </div>
          <div className="text-gray-400 font-medium">No trades yet</div>
          <div className="text-sm text-gray-600 mt-1">Start the agent to begin executing arbitrage trades</div>
        </div>
      )}

      {allTrades.length > 0 && (
        <div className="card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-gold">
              <thead>
                <tr className="border-b border-[#1F1F1F] text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3 text-left font-medium">Market</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Expected Payout</th>
                  <th className="px-4 py-3 text-right font-medium">Spread</th>
                  <th className="px-4 py-3 text-right font-medium">P&L</th>
                  <th className="px-4 py-3 text-right font-medium">Opened</th>
                  <th className="px-4 py-3 text-right font-medium">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F1F1F]">
                {allTrades.map((trade) => {
                  const openedRel = formatRelativeTime(Math.floor(new Date(trade.openedAt).getTime() / 1000))
                  const closedRel = trade.closedAt
                    ? formatRelativeTime(Math.floor(new Date(trade.closedAt).getTime() / 1000))
                    : null
                  const isExpanded = expandedId === trade.id
                  const legA = trade.legA as TradeLeg | null
                  const legB = trade.legB as TradeLeg | null
                  const platforms = [legA?.platform, legB?.platform].filter(Boolean) as string[]
                  const uniquePlatforms = Array.from(new Set(platforms))

                  return (
                    <Fragment key={trade.id}>
                      <tr
                        onClick={() => toggleExpand(trade.id)}
                        className={`transition-colors cursor-pointer ${isExpanded ? 'bg-[#1A1A1A]/40' : 'hover:bg-[#1A1A1A]/60'}`}
                      >
                        <td className="px-4 py-3.5">
                          <div className="max-w-[240px]">
                            <div className="text-xs text-gray-300 truncate" title={trade.marketTitle ?? trade.marketId}>
                              {trade.marketTitle ?? truncateAddress(trade.marketId, 6)}
                            </div>
                            {uniquePlatforms.length > 0 && (
                              <div className="flex gap-1 mt-1">
                                {uniquePlatforms.map((p) => (
                                  <PlatformBadge key={p} name={p} />
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={trade.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                          {formatUSD(trade.totalCost, 2)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                          {formatUSD(trade.expectedPayout, 2)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                          {trade.spreadBps} <span className="text-gray-600">bps</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <PnlCell pnl={trade.pnl} />
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs text-gray-400" title={openedRel.full}>
                          {openedRel.relative}
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs text-gray-400" title={closedRel?.full}>
                          {closedRel ? closedRel.relative : <span className="text-gray-600">&mdash;</span>}
                        </td>
                      </tr>
                      {isExpanded && <ExpandedRow trade={trade} />}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="border-t border-[#1F1F1F] p-4 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isFetching}
                className="px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#2A2A2A] rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isFetching ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-gray-600 border-t-[#F0B90B] rounded-full spin-slow" />
                    Loading...
                  </span>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
