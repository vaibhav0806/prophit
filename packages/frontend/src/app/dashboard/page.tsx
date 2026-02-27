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
import { ProtocolRoute } from '@/components/protocol-logos'

/* ─── Metric ─── */

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.12em] font-medium mb-1">{label}</div>
      {children}
    </div>
  )
}

/* ─── Section divider ─── */

function SectionLine({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] font-semibold shrink-0">{label}</span>
      <div className="flex-1 h-px bg-[#1C2030]" />
      {right}
    </div>
  )
}

/* ─── Spread bar ─── */

function SpreadIndicator({ bps, best }: { bps: number; best?: boolean }) {
  const pct = Math.min(100, (bps / 500) * 100)
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <span className={`font-mono tabular-nums text-[13px] font-medium ${best ? 'text-[#00D4FF]' : 'text-[#E0E2E9]'}`}>
        {bps}
      </span>
      <div className="w-8 h-[3px] bg-[#1C2030] rounded-sm overflow-hidden">
        <div
          className="h-full rounded-sm bg-[#00D4FF]"
          style={{ width: `${pct}%`, opacity: 0.35 + (pct / 160) }}
        />
      </div>
    </div>
  )
}

/* ─── Status badge ─── */

const STATUS_CLS: Record<string, string> = {
  OPEN: 'text-[#00D4FF] bg-[#00D4FF]/6 border-[#00D4FF]/12',
  FILLED: 'text-blue-400 bg-blue-500/6 border-blue-500/12',
  PARTIAL: 'text-amber-400/80 bg-amber-500/6 border-amber-500/12',
  CLOSED: 'text-[#6B7280] bg-[#191C24] border-[#262D3D]',
  EXPIRED: 'text-[#6B7280] bg-[#191C24] border-[#262D3D]',
}

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLS[status.toUpperCase()] || STATUS_CLS.CLOSED
  return (
    <span className={`inline-block text-[10px] px-1.5 py-px rounded font-mono font-medium uppercase tracking-wider border ${cls}`}>
      {status}
    </span>
  )
}

/* ─── Skeleton ─── */

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-3 rounded border border-[#1C2030] bg-[#111318]">
        <div className="skeleton h-7 w-20 rounded" />
        <div className="skeleton h-3 w-16" />
        <div className="flex-1" />
        <div className="skeleton h-2.5 w-24" />
      </div>
      <div className="flex gap-10">
        {[1, 2, 3, 4].map(i => (
          <div key={i}>
            <div className="skeleton h-2 w-12 mb-2" />
            <div className="skeleton h-5 w-20" />
          </div>
        ))}
      </div>
      <div>
        <div className="skeleton h-2 w-20 mb-4" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-4 py-2.5 border-t border-[#1C2030]/40">
            <div className="skeleton h-3 w-4" />
            <div className="skeleton h-3 w-52" />
            <div className="flex-1" />
            <div className="skeleton h-3 w-10" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-14" />
          </div>
        ))}
      </div>
      <div>
        <div className="skeleton h-2 w-24 mb-4" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-4 py-2.5 border-t border-[#1C2030]/40">
            <div className="skeleton h-3 w-44" />
            <div className="skeleton h-3 w-12" />
            <div className="flex-1" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Page ─── */

export default function DashboardPage() {
  const router = useRouter()
  const { isAuthenticated, isReady } = useAuth()

  useEffect(() => {
    if (isReady && !isAuthenticated) router.replace('/login')
  }, [isReady, isAuthenticated, router])

  const { data: wallet, isLoading: wL } = useWallet()
  const { data: agent, isLoading: aL } = useAgentStatus()
  const startAgent = useStartAgent()
  const stopAgent = useStopAgent()
  const { data: tradesData, isLoading: tL } = useTrades(5, 0)
  const { data: marketsData, isLoading: mL } = useMarkets()

  const isLoading = wL || aL || tL || mL

  const balance = useMemo(() => Number(wallet?.usdtBalance ?? 0), [wallet?.usdtBalance])
  const trades = tradesData?.trades ?? []
  const totalPnl = useMemo(() => trades.reduce((s, t) => s + (t.pnl ?? 0), 0), [trades])

  const topOpps = useMemo(() => {
    if (!marketsData?.opportunities) return []
    return [...marketsData.opportunities].sort((a, b) => b.spreadBps - a.spreadBps).slice(0, 5)
  }, [marketsData?.opportunities])

  const bestTradeIdx = useMemo(() => {
    if (!trades.length) return -1
    return trades.reduce((b, t, i) => t.spreadBps > trades[b].spreadBps ? i : b, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradesData?.trades])

  const toggling = startAgent.isPending || stopAgent.isPending
  const toggle = () => agent?.running ? stopAgent.mutate() : startAgent.mutate()

  if (!isReady || !isAuthenticated) return null

  return (
    <div className="p-5 lg:p-6 page-enter">
      <h1 className="text-xs font-semibold text-[#3D4350] uppercase tracking-[0.15em] mb-5">Dashboard</h1>

      {isLoading ? <DashboardSkeleton /> : (
        <div className="space-y-7">

          {/* ── Agent Status Bar ── */}
          <div
            className={`
              relative flex flex-col sm:flex-row items-start sm:items-center gap-3
              px-4 py-3 rounded border bg-[#111318] overflow-hidden
              ${agent?.running ? 'border-[#00D4FF]/15' : 'border-[#1C2030]'}
            `}
          >
            <button
              onClick={toggle}
              disabled={toggling}
              className={`
                flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold
                tracking-wide uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed
                ${agent?.running
                  ? 'bg-[#EF4444]/8 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/15'
                  : 'bg-[#00D4FF] text-[#0B0D11] border border-transparent hover:bg-[#33DFFF]'
                }
              `}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${agent?.running ? 'bg-[#EF4444]' : 'bg-[#0B0D11]'}`} />
              {toggling ? '\u00B7\u00B7\u00B7' : agent?.running ? 'Stop' : 'Start'}
            </button>

            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${agent?.running ? 'bg-[#00D4FF] status-pulse' : 'bg-[#3D4350]'}`} />
              <span className={`text-xs font-mono tracking-wide ${agent?.running ? 'text-[#00D4FF]' : 'text-[#3D4350]'}`}>
                {agent?.running ? 'ONLINE' : 'OFFLINE'}
              </span>
              {agent?.running && (
                <span className="text-[11px] font-mono text-[#3D4350]">{formatUptime(agent.uptime)}</span>
              )}
            </div>

            <div className="sm:ml-auto flex items-center gap-3 text-[11px] font-mono text-[#3D4350]">
              {agent?.tradesExecuted !== undefined && <span>{agent.tradesExecuted} exec</span>}
              {agent?.lastScan && (
                <span title={formatRelativeTime(agent.lastScan / 1000).full}>
                  scan {formatRelativeTime(agent.lastScan / 1000).relative}
                </span>
              )}
            </div>

            {/* Scan sweep when active */}
            {agent?.running && (
              <div className="absolute bottom-0 left-0 right-0 h-px overflow-hidden">
                <div
                  className="h-full w-1/5 bg-gradient-to-r from-transparent via-[#00D4FF]/25 to-transparent"
                  style={{ animation: 'scan-sweep 3s linear infinite' }}
                />
              </div>
            )}
          </div>

          {/* ── Metrics ── */}
          <div className="flex flex-wrap items-start gap-x-10 gap-y-4 animate-in" style={{ '--stagger': 1 } as React.CSSProperties}>
            <Metric label="Balance">
              <div className="text-xl font-mono font-semibold tabular-nums text-white leading-tight">
                {formatUSD(balance)}
              </div>
              {wallet?.address && (
                <div className="text-[10px] font-mono text-[#262D3D] mt-0.5">{truncateAddress(wallet.address, 4)}</div>
              )}
            </Metric>

            <Metric label="P&L">
              <div
                className={`text-xl font-mono font-semibold tabular-nums leading-tight ${totalPnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}
                style={totalPnl > 0 ? { textShadow: '0 0 20px rgba(34, 197, 94, 0.12)' } : undefined}
              >
                {totalPnl >= 0 ? '+' : ''}{formatUSD(totalPnl)}
              </div>
            </Metric>

            <Metric label="Trades">
              <div className="text-xl font-mono font-semibold tabular-nums text-[#E0E2E9] leading-tight">
                {agent?.tradesExecuted ?? 0}
              </div>
            </Metric>

            <Metric label="Quotes">
              <div className="text-xl font-mono font-semibold tabular-nums text-[#E0E2E9] leading-tight">
                {marketsData?.quoteCount ?? 0}
              </div>
            </Metric>
          </div>

          {/* ── Live Spreads ── */}
          <div className="animate-in" style={{ '--stagger': 2 } as React.CSSProperties}>
            <SectionLine
              label="Live Spreads"
              right={
                <div className="flex items-center gap-3">
                  {(marketsData?.opportunities?.length ?? 0) > 0 && (
                    <span className="text-[11px] font-mono text-[#3D4350]">
                      {marketsData!.opportunities.length} active
                    </span>
                  )}
                  <Link href="/markets" className="text-[11px] text-[#3D4350] hover:text-[#00D4FF] transition-colors">
                    View all &rarr;
                  </Link>
                </div>
              }
            />

            {topOpps.length === 0 ? (
              <div className="py-8 text-center">
                <div className="text-xs font-mono text-[#262D3D]">NO ACTIVE SPREADS</div>
                <div className="text-[11px] text-[#1C2030] mt-1">Waiting for scanner</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-[#3D4350] uppercase tracking-widest">
                      <th className="pb-2 pl-1 text-left font-medium w-6">#</th>
                      <th className="pb-2 text-left font-medium">Market</th>
                      <th className="pb-2 text-left font-medium">Route</th>
                      <th className="pb-2 text-right font-medium pr-1">Spread</th>
                      <th className="pb-2 text-right font-medium">Profit</th>
                      <th className="pb-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topOpps.map((opp, i) => {
                      const profit = Number(opp.estProfit) / 1e18
                      const cost = Number(opp.totalCost) / 1e18
                      return (
                        <tr
                          key={`${opp.marketId}-${i}`}
                          className={`
                            border-t border-[#1C2030]/50 text-[13px] transition-colors
                            hover:bg-[#191C24]/40 ${i === 0 ? 'row-glow' : ''}
                          `}
                        >
                          <td className="py-2.5 pl-1 font-mono text-[11px] text-[#262D3D]">{i + 1}</td>
                          <td className="py-2.5 pr-4">
                            <span className="text-[#E0E2E9] truncate block max-w-[320px]" title={opp.title ?? opp.marketId}>
                              {opp.title || truncateAddress(opp.marketId)}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <ProtocolRoute from={opp.protocolA} to={opp.protocolB} size={18} />
                          </td>
                          <td className="py-2.5 pr-1">
                            <SpreadIndicator bps={opp.spreadBps} best={i === 0} />
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-[#22C55E]/70">
                            {formatUSD(profit)}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-[#3D4350]">
                            {formatUSD(cost)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Recent Trades ── */}
          <div className="animate-in" style={{ '--stagger': 3 } as React.CSSProperties}>
            <SectionLine
              label="Recent Trades"
              right={
                trades.length > 0 ? (
                  <Link href="/trades" className="text-[11px] text-[#3D4350] hover:text-[#00D4FF] transition-colors">
                    View all &rarr;
                  </Link>
                ) : undefined
              }
            />

            {trades.length === 0 ? (
              <div className="py-8 text-center">
                <div className="text-xs font-mono text-[#262D3D]">AWAITING EXECUTION</div>
                <div className="text-[11px] text-[#1C2030] mt-1">Trades appear after agent runs</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-[#3D4350] uppercase tracking-widest">
                      <th className="pb-2 text-left font-medium">Market</th>
                      <th className="pb-2 text-left font-medium">Status</th>
                      <th className="pb-2 text-right font-medium">Cost</th>
                      <th className="pb-2 text-right font-medium">Payout</th>
                      <th className="pb-2 text-right font-medium">Spread</th>
                      <th className="pb-2 text-right font-medium">P&L</th>
                      <th className="pb-2 text-right font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => {
                      const time = formatRelativeTime(new Date(t.openedAt).getTime() / 1000)
                      return (
                        <tr
                          key={t.id}
                          className={`
                            border-t border-[#1C2030]/50 text-[13px] transition-colors
                            hover:bg-[#191C24]/40 ${i === bestTradeIdx ? 'row-glow' : ''}
                          `}
                        >
                          <td className="py-2.5 pr-4">
                            <span className="text-[#E0E2E9] truncate block max-w-[240px]" title={t.marketTitle ?? t.marketId}>
                              {t.marketTitle || truncateAddress(t.marketId)}
                            </span>
                          </td>
                          <td className="py-2.5"><Badge status={t.status} /></td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-[#6B7280]">
                            {formatUSD(t.totalCost)}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-[#6B7280]">
                            {formatUSD(t.expectedPayout)}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-[#E0E2E9]">
                            {t.spreadBps}<span className="text-[#3D4350] text-[11px]">&thinsp;bps</span>
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums font-medium">
                            {t.pnl !== null ? (
                              <span className={t.pnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                                {t.pnl >= 0 ? '+' : ''}{formatUSD(t.pnl)}
                              </span>
                            ) : (
                              <span className="text-[#262D3D]">&mdash;</span>
                            )}
                          </td>
                          <td className="py-2.5 text-right font-mono text-[11px] text-[#3D4350]" title={time.full}>
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

          {/* ── Footer status ── */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#262D3D] pt-1">
            <span className="w-1 h-1 rounded-full bg-[#00D4FF]/25 pulse-dot" />
            <span>{marketsData?.quoteCount ?? 0} quotes</span>
            <span className="text-[#1C2030]">&middot;</span>
            <span>3 protocols</span>
            {marketsData?.updatedAt && (
              <>
                <span className="text-[#1C2030]">&middot;</span>
                <span>{formatRelativeTime(marketsData.updatedAt / 1000).relative}</span>
              </>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
