'use client'

import { Fragment, useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTrades } from '@/hooks/use-platform-api'
import type { Trade, TradeLeg } from '@/hooks/use-platform-api'
import { useAuth } from '@/hooks/use-auth'
import { formatUSD, truncateAddress, formatRelativeTime } from '@/lib/format'
import { ProtocolLogo } from '@/components/protocol-logos'

const PAGE_SIZE = 20

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'text-[#00D4FF] bg-[#00D4FF]/6 border-[#00D4FF]/12',
  PARTIAL: 'text-blue-400 bg-blue-500/6 border-blue-500/12',
  FILLED: 'text-cyan-400 bg-cyan-500/6 border-cyan-500/12',
  CLOSED: 'text-[#6B7280] bg-[#191C24] border-[#262D3D]',
  EXPIRED: 'text-amber-400/80 bg-amber-500/6 border-amber-500/12',
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.CLOSED
  return (
    <span className={`inline-block text-[10px] px-1.5 py-px rounded font-mono font-medium uppercase tracking-wider border ${style}`}>
      {status}
    </span>
  )
}

function PnlCell({ pnl }: { pnl: number | null }) {
  if (pnl === null) {
    return <span className="text-[#262D3D] font-mono tabular-nums">&mdash;</span>
  }
  const isPositive = pnl > 0
  const isNegative = pnl < 0
  return (
    <span className={`font-mono tabular-nums font-medium ${isPositive ? 'text-[#22C55E]' : isNegative ? 'text-[#EF4444]' : 'text-[#6B7280]'}`}>
      {isPositive ? '+' : ''}{formatUSD(pnl, 2)}
    </span>
  )
}

function LegDetail({ leg, label }: { leg: TradeLeg | null; label: string }) {
  if (!leg) {
    return (
      <div className="flex-1 min-w-0 p-3 rounded border border-[#1C2030] bg-[#0B0D11]">
        <div className="text-[11px] uppercase tracking-wider text-[#3D4350] mb-2">{label}</div>
        <div className="text-[13px] text-[#3D4350]">No data</div>
      </div>
    )
  }

  const sideColor = leg.side === 'BUY' ? 'text-[#22C55E]' : 'text-[#EF4444]'

  return (
    <div className="flex-1 min-w-0 p-3 rounded border border-[#1C2030] bg-[#0B0D11]">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[11px] uppercase tracking-wider text-[#3D4350]">{label}</div>
        <div className="flex items-center gap-1.5">
          <ProtocolLogo name={leg.platform} size={14} />
          <span className="text-[11px] font-mono text-[#3D4350] uppercase tracking-wider">
            {leg.platform.charAt(0).toUpperCase() + leg.platform.slice(1).toLowerCase()}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        <div>
          <span className="text-[#3D4350]">Side </span>
          <span className={`font-medium ${sideColor}`}>{leg.side}</span>
        </div>
        <div>
          <span className="text-[#3D4350]">Price </span>
          <span className="font-mono tabular-nums text-[#E0E2E9]">{leg.price.toFixed(4)}</span>
        </div>
        <div>
          <span className="text-[#3D4350]">Size </span>
          <span className="font-mono tabular-nums text-[#E0E2E9]">{leg.size.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-[#3D4350]">Filled </span>
          <span className="font-mono tabular-nums text-[#E0E2E9]">{leg.filledSize.toFixed(2)}</span>
          {leg.filled && <span className="text-[#22C55E] ml-1 text-[11px]">&#10003;</span>}
        </div>
      </div>

      {(leg.orderId || leg.transactionHash) && (
        <div className="mt-2.5 pt-2 border-t border-[#1C2030] space-y-1">
          {leg.orderId && (
            <div className="text-[11px]">
              <span className="text-[#3D4350]">Order </span>
              <span className="font-mono text-[#3D4350]">{truncateAddress(leg.orderId, 6)}</span>
            </div>
          )}
          {leg.transactionHash && (
            <div className="text-[11px]">
              <span className="text-[#3D4350]">Tx </span>
              <span className="font-mono text-[#3D4350]">{truncateAddress(leg.transactionHash, 6)}</span>
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
        <div className="px-4 pb-3 pt-0">
          <div className="rounded border border-[#1C2030] bg-[#111318] p-4 space-y-3">
            {/* Legs side by side */}
            <div className="flex gap-3">
              <LegDetail leg={trade.legA} label="Leg A" />
              <LegDetail leg={trade.legB} label="Leg B" />
            </div>

            {/* Market details */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-[#3D4350] pt-1">
              {trade.marketCategory && (
                <div>
                  <span className="text-[#3D4350]">Category </span>
                  <span className="text-[#6B7280]">{trade.marketCategory}</span>
                </div>
              )}
              {trade.resolvesAt && (
                <div>
                  <span className="text-[#3D4350]">Resolves </span>
                  <span className="text-[#6B7280] font-mono tabular-nums">
                    {new Date(trade.resolvesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}
              <div>
                <span className="text-[#3D4350]">ID </span>
                <span className="font-mono text-[#3D4350]">{truncateAddress(trade.marketId, 8)}</span>
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
    <div className="space-y-0">
      <div className="flex items-center gap-4 py-2.5 px-1">
        <div className="skeleton h-2 w-20" />
        <div className="skeleton h-2 w-12" />
        <div className="flex-1" />
        <div className="skeleton h-2 w-12" />
        <div className="skeleton h-2 w-14" />
        <div className="skeleton h-2 w-10" />
        <div className="skeleton h-2 w-12" />
        <div className="skeleton h-2 w-12" />
        <div className="skeleton h-2 w-12" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3 px-1 border-t border-[#1C2030]/50">
          <div className="skeleton h-3 w-44" />
          <div className="skeleton h-4 w-14 rounded" />
          <div className="flex-1" />
          <div className="skeleton h-3 w-14" />
          <div className="skeleton h-3 w-14" />
          <div className="skeleton h-3 w-10" />
          <div className="skeleton h-3 w-14" />
          <div className="skeleton h-3 w-12" />
          <div className="skeleton h-3 w-12" />
        </div>
      ))}
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
    <div className="p-5 lg:p-6 page-enter">
      <h1 className="text-xs font-semibold text-[#3D4350] uppercase tracking-[0.15em] mb-5">Trade History</h1>

      {isLoading && offset === 0 && <SkeletonTable />}

      {!isLoading && allTrades.length === 0 && (
        <div className="py-8 text-center">
          <div className="text-xs font-mono text-[#262D3D]">NO TRADES YET</div>
          <div className="text-[11px] text-[#1C2030] mt-1">Start the agent to begin executing arbitrage trades</div>
        </div>
      )}

      {allTrades.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] font-semibold shrink-0">Executions</span>
            <div className="flex-1 h-px bg-[#1C2030]" />
            <span className="text-[11px] font-mono text-[#3D4350]">{allTrades.length} loaded</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-[#3D4350] uppercase tracking-widest">
                  <th className="pb-2 text-left font-medium">Market</th>
                  <th className="pb-2 text-left font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                  <th className="pb-2 text-right font-medium">Expected Payout</th>
                  <th className="pb-2 text-right font-medium">Spread</th>
                  <th className="pb-2 text-right font-medium">P&L</th>
                  <th className="pb-2 text-right font-medium">Opened</th>
                  <th className="pb-2 text-right font-medium">Closed</th>
                </tr>
              </thead>
              <tbody>
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
                        className={`border-t border-[#1C2030]/50 text-[13px] transition-colors cursor-pointer ${isExpanded ? 'bg-[#191C24]/40' : 'hover:bg-[#191C24]/40'}`}
                      >
                        <td className="py-2.5 pr-4">
                          <div className="max-w-[240px]">
                            <div className="text-[13px] text-[#E0E2E9] truncate" title={trade.marketTitle ?? trade.marketId}>
                              {trade.marketTitle ?? truncateAddress(trade.marketId, 6)}
                            </div>
                            {uniquePlatforms.length > 0 && (
                              <div className="flex items-center gap-1.5 mt-1">
                                {uniquePlatforms.map((p) => (
                                  <ProtocolLogo key={p} name={p} size={14} />
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5">
                          <StatusBadge status={trade.status} />
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#6B7280]">
                          {formatUSD(trade.totalCost, 2)}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#6B7280]">
                          {formatUSD(trade.expectedPayout, 2)}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#E0E2E9]">
                          {trade.spreadBps}<span className="text-[#3D4350] text-[11px]">&thinsp;bps</span>
                        </td>
                        <td className="py-2.5 text-right">
                          <PnlCell pnl={trade.pnl} />
                        </td>
                        <td className="py-2.5 text-right font-mono text-[11px] text-[#3D4350]" title={openedRel.full}>
                          {openedRel.relative}
                        </td>
                        <td className="py-2.5 text-right font-mono text-[11px] text-[#3D4350]" title={closedRel?.full}>
                          {closedRel ? closedRel.relative : <span className="text-[#262D3D]">&mdash;</span>}
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
            <div className="pt-3 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isFetching}
                className="px-4 py-1.5 bg-[#111318] hover:bg-[#191C24] border border-[#1C2030] rounded text-xs font-mono uppercase tracking-wider text-[#3D4350] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isFetching ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border border-[#3D4350] border-t-[#00D4FF] rounded-full spin-slow" />
                    Loading
                  </span>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
