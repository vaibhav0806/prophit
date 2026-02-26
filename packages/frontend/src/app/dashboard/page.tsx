'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  useWallet,
  useAgentStatus,
  useStartAgent,
  useStopAgent,
  useTrades,
  useMarkets,
} from '@/hooks/use-platform-api'
import { useAuth } from '@/hooks/use-auth'
import { formatUSD, formatUptime, formatRelativeTime, truncateAddress } from '@/lib/format'

// --- Skeleton ---

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero stats — asymmetric */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="col-span-2 card rounded-2xl p-6">
          <div className="skeleton h-3 w-20 mb-3" />
          <div className="skeleton h-10 w-40" />
        </div>
        <div className="card rounded-2xl p-6">
          <div className="skeleton h-3 w-20 mb-3" />
          <div className="skeleton h-8 w-28" />
        </div>
        <div className="space-y-4">
          <div className="card rounded-2xl p-4">
            <div className="skeleton h-3 w-20 mb-2" />
            <div className="skeleton h-6 w-16" />
          </div>
          <div className="card rounded-2xl p-4">
            <div className="skeleton h-3 w-20 mb-2" />
            <div className="skeleton h-6 w-16" />
          </div>
        </div>
      </div>
      {/* Agent control */}
      <div className="card rounded-2xl p-6">
        <div className="flex items-center gap-6">
          <div className="skeleton h-14 w-48 rounded-xl" />
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-3 w-32 ml-auto" />
        </div>
      </div>
      {/* Table */}
      <div className="card rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1F1F1F]">
          <div className="skeleton h-4 w-28" />
        </div>
        <div className="divide-y divide-[#1F1F1F]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-6 py-4 flex items-center gap-6">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-5 w-16 rounded-full" />
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-3 w-14" />
              <div className="skeleton h-3 w-16 ml-auto" />
              <div className="skeleton h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- Status badge ---

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-[#F0B90B]/10 text-[#F0B90B] border-[#F0B90B]/20',
  FILLED: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CLOSED: 'bg-gray-700/30 text-gray-400 border-gray-600/30',
  EXPIRED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
}

function StatusBadge({ status }: { status: string }) {
  const key = status.toUpperCase()
  const style = STATUS_STYLES[key] || STATUS_STYLES.CLOSED
  return (
    <span className={`inline-block text-[11px] px-2.5 py-0.5 rounded-full font-medium uppercase tracking-wide border ${style}`}>
      {status}
    </span>
  )
}

// --- Main page ---

export default function DashboardPage() {
  const router = useRouter()
  const { isAuthenticated, isReady } = useAuth()

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isReady, isAuthenticated, router])

  const { data: wallet, isLoading: walletLoading } = useWallet()
  const { data: agent, isLoading: agentLoading } = useAgentStatus()
  const startAgent = useStartAgent()
  const stopAgent = useStopAgent()
  const { data: tradesData, isLoading: tradesLoading } = useTrades(5, 0)
  const { data: marketsData, isLoading: marketsLoading } = useMarkets()

  const isLoading = walletLoading || agentLoading || tradesLoading || marketsLoading

  // Derived values
  const usdtBalance = useMemo(() => {
    if (!wallet?.usdtBalance) return 0
    return Number(wallet.usdtBalance)
  }, [wallet?.usdtBalance])

  const totalPnl = useMemo(() => {
    if (!tradesData?.trades) return 0
    return tradesData.trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  }, [tradesData?.trades])

  const trades = tradesData?.trades ?? []

  const topOpportunities = useMemo(() => {
    if (!marketsData?.opportunities) return []
    return [...marketsData.opportunities]
      .sort((a, b) => b.spreadBps - a.spreadBps)
      .slice(0, 3)
  }, [marketsData?.opportunities])

  // Find best spread index in trades table
  const bestTradeIdx = useMemo(() => {
    if (trades.length === 0) return -1
    return trades.reduce((best, t, idx) => t.spreadBps > trades[best].spreadBps ? idx : best, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradesData?.trades])

  const isToggling = startAgent.isPending || stopAgent.isPending

  const handleToggle = () => {
    if (agent?.running) {
      stopAgent.mutate()
    } else {
      startAgent.mutate()
    }
  }

  if (!isReady || !isAuthenticated) return null

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl page-enter">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight heading-accent">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Overview of your arbitrage operations</p>
        </div>
        <DashboardSkeleton />
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl page-enter">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight heading-accent">Dashboard</h1>
        <p className="text-sm text-[#555] mt-1">Overview of your arbitrage operations</p>
      </div>

      <div className="space-y-6">
        {/* ── Hero Stats — Asymmetric Bento ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Balance — 2 cols wide */}
          <div className="col-span-2 card card-accent rounded-2xl p-6 animate-in" style={{ '--stagger': 0 } as React.CSSProperties}>
            <div className="text-[10px] text-[#555] uppercase tracking-[0.1em] font-medium mb-1.5">USDT Balance</div>
            <div className="text-4xl font-mono font-bold tabular-nums text-white">
              {formatUSD(usdtBalance)}
            </div>
            {wallet?.address && (
              <div className="text-[10px] text-gray-600 font-mono mt-2">{truncateAddress(wallet.address)}</div>
            )}
          </div>

          {/* P&L */}
          <div className={`card card-accent rounded-2xl p-6 animate-in`} style={{ '--stagger': 1 } as React.CSSProperties}>
            <div className="text-[10px] text-[#555] uppercase tracking-[0.1em] font-medium mb-1.5">Total P&L</div>
            <div className={`text-2xl font-mono font-bold tabular-nums ${totalPnl >= 0 ? 'text-[#00FF88]' : 'text-[#FF4757]'}`}>
              {totalPnl >= 0 ? '+' : ''}{formatUSD(totalPnl)}
            </div>
            <div className="text-[10px] text-gray-600 mt-1.5">From recent trades</div>
          </div>

          {/* Trades + Uptime stacked */}
          <div className="flex flex-col gap-4 animate-in" style={{ '--stagger': 2 } as React.CSSProperties}>
            <div className="card card-accent rounded-2xl p-4 flex-1">
              <div className="text-[10px] text-[#555] uppercase tracking-[0.1em] font-medium mb-1">Trades</div>
              <div className="text-xl font-mono font-bold tabular-nums text-white">
                {agent?.tradesExecuted ?? 0}
              </div>
            </div>
            <div className="card card-accent rounded-2xl p-4 flex-1">
              <div className="text-[10px] text-[#555] uppercase tracking-[0.1em] font-medium mb-1">Uptime</div>
              <div className="text-xl font-mono font-bold tabular-nums text-white">
                {agent?.running ? formatUptime(agent.uptime) : '---'}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${agent?.running ? 'bg-[#F0B90B] pulse-dot' : 'bg-gray-600'}`} />
                <span className="text-[10px] text-gray-600">{agent?.running ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Agent Control ── */}
        <div className={`card rounded-2xl p-6 ${agent?.running ? 'agent-running-border' : ''}`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <button
              onClick={handleToggle}
              disabled={isToggling}
              className={`
                relative flex items-center gap-3 px-8 py-4 rounded-xl font-medium text-sm transition-all duration-200
                disabled:opacity-60 disabled:cursor-not-allowed
                ${agent?.running
                  ? 'bg-[#FF4757]/10 border-2 border-[#FF4757]/30 text-[#FF4757] hover:bg-[#FF4757]/20 hover:border-[#FF4757]/50'
                  : 'btn-gold border-2 border-transparent'
                }
              `}
            >
              <span
                className={`
                  inline-block w-3 h-3 rounded-full shrink-0
                  ${agent?.running ? 'bg-[#FF4757]' : 'bg-[#F0B90B]'}
                  ${agent?.running ? 'status-pulse' : ''}
                `}
              />
              {isToggling
                ? 'Processing...'
                : agent?.running
                  ? 'Stop Agent'
                  : 'Start Agent'
              }
            </button>

            <div className="flex items-center gap-2.5">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${agent?.running ? 'bg-[#F0B90B] status-pulse' : 'bg-gray-600'}`}
              />
              <span className={`font-medium ${agent?.running ? 'text-[#F0B90B]' : 'text-gray-500'}`}>
                {agent?.running ? 'Running' : 'Stopped'}
              </span>
            </div>

            {agent?.lastScan ? (
              <div className="sm:ml-auto text-[11px] text-[#555]">
                Last scan{' '}
                <span className="font-mono tabular-nums text-gray-400" title={formatRelativeTime(agent.lastScan / 1000).full}>
                  {formatRelativeTime(agent.lastScan / 1000).relative}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Bottom Grid: Trades + Opportunities ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Recent Trades — takes 2 cols */}
          <div className="xl:col-span-2 card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F1F1F]">
              <h2 className="text-sm font-semibold text-gray-200">Recent Trades</h2>
              <Link
                href="/trades"
                className="text-[11px] text-gray-500 hover:text-[#F0B90B] uppercase tracking-wide transition-colors"
              >
                View All
              </Link>
            </div>

            {trades.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#F0B90B]/5 border border-[#F0B90B]/10 mb-4">
                  <svg className="w-6 h-6 text-[#F0B90B]/40 spin-ring" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                  </svg>
                </div>
                <div className="text-gray-500 text-sm">No trades yet</div>
                <div className="text-gray-600 text-xs mt-1">Trades will appear here once the agent executes</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-gold">
                  <thead>
                    <tr className="border-b border-[#1F1F1F] text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="px-6 py-3 text-left font-medium">Market</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Cost</th>
                      <th className="px-4 py-3 text-right font-medium">Payout</th>
                      <th className="px-4 py-3 text-right font-medium">Spread</th>
                      <th className="px-4 py-3 text-right font-medium">P&L</th>
                      <th className="px-4 py-3 text-right font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F1F1F]">
                    {trades.map((trade, idx) => {
                      const time = formatRelativeTime(new Date(trade.openedAt).getTime() / 1000)
                      const isBest = idx === bestTradeIdx
                      return (
                        <tr
                          key={trade.id}
                          className={`transition-colors hover:bg-[#1A1A1A]/60 ${isBest ? 'row-glow' : ''}`}
                        >
                          <td className="px-6 py-3.5">
                            <div className="text-xs text-gray-300 max-w-[200px] truncate" title={trade.marketTitle ?? trade.marketId}>
                              {trade.marketTitle ?? truncateAddress(trade.marketId)}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={trade.status} />
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                            {formatUSD(trade.totalCost)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                            {formatUSD(trade.expectedPayout)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono tabular-nums font-semibold text-[#F0B90B]/80">
                            {trade.spreadBps} bps
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono tabular-nums font-semibold">
                            {trade.pnl !== null ? (
                              <span className={trade.pnl >= 0 ? 'text-[#00FF88]' : 'text-[#FF4757]'}>
                                {trade.pnl >= 0 ? '+' : ''}{formatUSD(trade.pnl)}
                              </span>
                            ) : (
                              <span className="text-gray-600">&mdash;</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right text-xs text-gray-500" title={time.full}>
                            {time.relative}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Active Opportunities — takes 1 col */}
          <div className="card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F1F1F]">
              <h2 className="text-sm font-semibold text-gray-200">Top Opportunities</h2>
              <Link
                href="/markets"
                className="text-[11px] text-gray-500 hover:text-[#F0B90B] uppercase tracking-wide transition-colors"
              >
                View All
              </Link>
            </div>

            {topOpportunities.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="text-gray-500 text-sm">No opportunities</div>
                <div className="text-gray-600 text-xs mt-1">Scanning for spreads...</div>
              </div>
            ) : (
              <div className="divide-y divide-[#1F1F1F]">
                {topOpportunities.map((opp, idx) => {
                  const estProfit = Number(opp.estProfit) / 1e18
                  const totalCost = Number(opp.totalCost) / 1e18
                  return (
                    <div
                      key={`${opp.marketId}-${idx}`}
                      className={`px-6 py-4 transition-colors hover:bg-[#1A1A1A]/40 ${idx === 0 ? 'row-glow' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs text-gray-400">{truncateAddress(opp.marketId)}</span>
                        <span className="font-mono tabular-nums text-sm font-semibold text-[#F0B90B]">
                          {opp.spreadBps} bps
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <span className="text-gray-500">Profit </span>
                          <span className="font-mono tabular-nums text-[#F0B90B]/80">{formatUSD(estProfit)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Cost </span>
                          <span className="font-mono tabular-nums text-gray-400">{formatUSD(totalCost)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {marketsData && (
              <div className="px-6 py-3 border-t border-[#1F1F1F] flex items-center gap-2 text-[10px] text-gray-600">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#F0B90B] pulse-dot" />
                <span className="font-mono tabular-nums">{marketsData.quoteCount}</span> quotes scanned
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
