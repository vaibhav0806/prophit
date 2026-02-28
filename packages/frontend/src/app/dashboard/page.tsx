'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useExportWallet, useFundWallet } from '@privy-io/react-auth'
import { bsc } from 'viem/chains'
import {
  useWallet,
  useAgentStatus,
  useStartAgent,
  useStopAgent,
  useTrades,
  useMarkets,
} from '@/hooks/use-platform-api'
import { useAuth } from '@/hooks/use-auth'
import { formatUSD, formatUptime, formatRelativeTime, truncateAddress, formatNumber } from '@/lib/format'
import { ProtocolLogo } from '@/components/protocol-logos'
import { MarketThumb } from '@/components/market-thumb'

/* ─── Clipboard helper ─── */

function useCopy() {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
  }
  return { copied, copy }
}

/* ─── Section divider ─── */

function SectionLine({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[11px] text-[#4A5060] uppercase tracking-[0.15em] font-semibold shrink-0">{label}</span>
      <div className="flex-1 h-px bg-[#1C2030]" />
      {right}
    </div>
  )
}

/* ─── Spread bar ─── */

function SpreadIndicator({ bps, best }: { bps: number; best?: boolean }) {
  const pct = Math.min(100, (bps / 500) * 100)
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className={`font-mono tabular-nums text-sm font-semibold ${best ? 'text-[#00D4FF]' : 'text-[#C8CBD4]'}`}>
        {bps}
      </span>
      <div className="w-10 h-[3px] bg-[#1C2030] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-[#00D4FF]"
          style={{ width: `${pct}%`, opacity: 0.4 + (pct / 200) }}
        />
      </div>
    </div>
  )
}

/* ─── Status badge ─── */

const STATUS_CLS: Record<string, string> = {
  OPEN: 'text-[#00D4FF] bg-[#00D4FF]/8 border-[#00D4FF]/15',
  FILLED: 'text-blue-400 bg-blue-500/8 border-blue-500/15',
  PARTIAL: 'text-amber-400 bg-amber-500/8 border-amber-500/15',
  CLOSED: 'text-[#6B7280] bg-[#191C24] border-[#262D3D]',
  EXPIRED: 'text-[#6B7280] bg-[#191C24] border-[#262D3D]',
}

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLS[status.toUpperCase()] || STATUS_CLS.CLOSED
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded font-mono font-semibold uppercase tracking-wider border ${cls}`}>
      {status}
    </span>
  )
}

/* ─── Icon components ─── */

function IconCopy({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5" />
    </svg>
  )
}

function IconExternal({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4H8" />
      <path d="M10 2h4v4" />
      <path d="M7 9L14 2" />
    </svg>
  )
}

function IconKey({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="11" r="3" />
      <path d="M7.5 8.5L14 2" />
      <path d="M11 5l2-2" />
      <path d="M12.5 3.5L14 5" />
    </svg>
  )
}

function IconWallet({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" />
      <path d="M1.5 7h13" />
      <circle cx="11.5" cy="10" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* ─── Skeleton ─── */

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Agent bar skeleton */}
      <div className="rounded-xl border border-[#1C2030] bg-[#111318] p-5">
        <div className="flex items-center gap-4">
          <div className="skeleton h-10 w-28 rounded-lg" />
          <div className="skeleton h-4 w-20" />
          <div className="flex-1" />
          <div className="skeleton h-3 w-32" />
        </div>
      </div>
      {/* Cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-xl border border-[#1C2030] bg-[#111318] p-5">
            <div className="skeleton h-3 w-16 mb-3" />
            <div className="skeleton h-8 w-28 mb-2" />
            <div className="skeleton h-3 w-20" />
          </div>
        ))}
      </div>
      {/* Stats skeleton */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-lg border border-[#1C2030] bg-[#111318] p-4">
            <div className="skeleton h-2.5 w-14 mb-2" />
            <div className="skeleton h-6 w-12" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div>
        <div className="skeleton h-3 w-24 mb-4" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-4 py-3 border-t border-[#1C2030]/40">
            <div className="skeleton h-4 w-4" />
            <div className="skeleton w-8 h-8 rounded-lg" />
            <div className="skeleton h-4 w-52" />
            <div className="flex-1" />
            <div className="skeleton h-4 w-14" />
            <div className="skeleton h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Page ─── */

export default function DashboardPage() {
  const router = useRouter()
  const { isAuthenticated, isReady, address: authAddress } = useAuth()
  const { exportWallet } = useExportWallet()
  const { fundWallet } = useFundWallet()
  const { copied, copy } = useCopy()

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
  const bnbBalance = useMemo(() => Number(wallet?.bnbBalance ?? 0), [wallet?.bnbBalance])
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
  const walletAddr = wallet?.address || authAddress

  if (!isReady || !isAuthenticated) return null

  const isRunning = !!agent?.running

  return (
    <div className="p-5 lg:p-6 page-enter">
      <h1 className="text-[11px] font-semibold text-[#4A5060] uppercase tracking-[0.2em] mb-6">Dashboard</h1>

      {isLoading ? <DashboardSkeleton /> : (
        <div className="space-y-5">

          {/* ── Agent Control ── */}
          <div
            className={`
              relative rounded-xl overflow-hidden transition-all duration-500
              ${isRunning
                ? 'bg-gradient-to-r from-[#00D4FF]/[0.04] via-[#111318] to-[#111318] border border-[#00D4FF]/20'
                : 'bg-[#111318] border border-[#1C2030]'
              }
            `}
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 px-5 py-4">
              {/* Start/Stop */}
              <button
                onClick={toggle}
                disabled={toggling}
                className={`
                  relative flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-sm font-bold
                  tracking-wide uppercase transition-all duration-300
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${isRunning
                    ? 'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/25 hover:bg-[#EF4444]/20 hover:border-[#EF4444]/40'
                    : 'bg-[#00D4FF] text-[#0B0D11] border border-[#00D4FF]/50 hover:bg-[#33DFFF] hover:shadow-[0_0_24px_rgba(0,212,255,0.25)]'
                  }
                `}
              >
                <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-[#EF4444] animate-pulse' : 'bg-[#0B0D11]'}`} />
                {toggling ? '\u00B7\u00B7\u00B7' : isRunning ? 'Stop Agent' : 'Start Agent'}
              </button>

              {/* Status */}
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-[#00D4FF] status-pulse' : 'bg-[#3D4350]'}`} />
                <span className={`text-sm font-mono font-semibold tracking-wide ${isRunning ? 'text-[#00D4FF]' : 'text-[#4A5060]'}`}>
                  {isRunning ? 'ONLINE' : 'OFFLINE'}
                </span>
                {isRunning && agent?.uptime && (
                  <span className="text-xs font-mono text-[#4A5060]">{formatUptime(agent.uptime)}</span>
                )}
              </div>

              {/* Runtime stats */}
              <div className="sm:ml-auto flex items-center gap-4 text-xs font-mono text-[#4A5060]">
                {agent?.tradesExecuted !== undefined && (
                  <span><span className="text-[#6B7280]">{agent.tradesExecuted}</span> executed</span>
                )}
                {agent?.lastScan && (
                  <span title={formatRelativeTime(agent.lastScan / 1000).full}>
                    scan {formatRelativeTime(agent.lastScan / 1000).relative}
                  </span>
                )}
              </div>
            </div>

            {/* Scan sweep */}
            {isRunning && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
                <div
                  className="h-full w-1/5 bg-gradient-to-r from-transparent via-[#00D4FF]/40 to-transparent"
                  style={{ animation: 'scan-sweep 3s linear infinite' }}
                />
              </div>
            )}
          </div>

          {/* ── Hero Cards: Balance + P&L + Wallet ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-in" style={{ '--stagger': 1 } as React.CSSProperties}>

            {/* Balance */}
            <div className="rounded-xl border border-[#1C2030] bg-[#111318] p-5">
              <div className="text-[11px] text-[#4A5060] uppercase tracking-[0.15em] font-semibold mb-3">Balance</div>
              <div className="text-3xl font-mono font-bold tabular-nums text-white leading-none tracking-tight">
                {formatUSD(balance)}
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#1C2030]/60">
                <span className="text-xs font-mono text-[#4A5060]">BNB</span>
                <span className="text-sm font-mono font-semibold tabular-nums text-[#9CA3AF]">
                  {formatNumber(bnbBalance, 4)}
                </span>
              </div>
            </div>

            {/* P&L */}
            <div className="rounded-xl border border-[#1C2030] bg-[#111318] p-5">
              <div className="text-[11px] text-[#4A5060] uppercase tracking-[0.15em] font-semibold mb-3">Total P&L</div>
              <div
                className={`text-3xl font-mono font-bold tabular-nums leading-none tracking-tight ${totalPnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}
                style={totalPnl > 0 ? { textShadow: '0 0 30px rgba(34, 197, 94, 0.15)' } : totalPnl < 0 ? { textShadow: '0 0 30px rgba(239, 68, 68, 0.15)' } : undefined}
              >
                {totalPnl >= 0 ? '+' : ''}{formatUSD(totalPnl)}
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#1C2030]/60">
                <span className="text-xs font-mono text-[#4A5060]">Trades</span>
                <span className="text-sm font-mono font-semibold tabular-nums text-[#9CA3AF]">
                  {agent?.tradesExecuted ?? 0}
                </span>
              </div>
            </div>

            {/* Wallet */}
            <div className="rounded-xl border border-[#1C2030] bg-[#111318] p-5">
              <div className="text-[11px] text-[#4A5060] uppercase tracking-[0.15em] font-semibold mb-3">Wallet</div>
              {walletAddr ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <code className="text-sm font-mono text-[#C8CBD4] tracking-wide">
                      {truncateAddress(walletAddr, 6)}
                    </code>
                    <button
                      onClick={() => copy(walletAddr)}
                      className={`p-1.5 rounded-md transition-all duration-200 ${
                        copied
                          ? 'text-[#00D4FF] bg-[#00D4FF]/10'
                          : 'text-[#4A5060] hover:text-[#9CA3AF] hover:bg-white/[0.04]'
                      }`}
                      title={copied ? 'Copied!' : 'Copy address'}
                    >
                      {copied ? (
                        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 8.5l3 3 7-7" />
                        </svg>
                      ) : (
                        <IconCopy size={14} />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <a
                      href={`https://bscscan.com/address/${walletAddr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#4A5060] hover:text-[#9CA3AF] hover:bg-white/[0.04] border border-[#1C2030] transition-all"
                    >
                      <IconExternal size={12} />
                      Explorer
                    </a>
                    <button
                      onClick={() => fundWallet({ address: walletAddr, options: { chain: bsc } })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#4A5060] hover:text-[#00D4FF] hover:bg-[#00D4FF]/[0.04] border border-[#1C2030] transition-all"
                    >
                      <IconWallet size={12} />
                      Fund
                    </button>
                    <button
                      onClick={() => exportWallet({ address: walletAddr })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#4A5060] hover:text-[#9CA3AF] hover:bg-white/[0.04] border border-[#1C2030] transition-all"
                    >
                      <IconKey size={12} />
                      Export
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-[#3D4350] font-mono">Loading...</div>
              )}
            </div>
          </div>

          {/* ── Quick Stats ── */}
          <div className="grid grid-cols-3 gap-3 animate-in" style={{ '--stagger': 2 } as React.CSSProperties}>
            <div className="rounded-lg border border-[#1C2030] bg-[#0E1015] px-4 py-3">
              <div className="text-[10px] text-[#3D4350] uppercase tracking-[0.15em] font-medium mb-1">Quotes</div>
              <div className="text-lg font-mono font-bold tabular-nums text-[#C8CBD4]">
                {marketsData?.quoteCount ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-[#1C2030] bg-[#0E1015] px-4 py-3">
              <div className="text-[10px] text-[#3D4350] uppercase tracking-[0.15em] font-medium mb-1">Opportunities</div>
              <div className="text-lg font-mono font-bold tabular-nums text-[#C8CBD4]">
                {marketsData?.opportunities?.length ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-[#1C2030] bg-[#0E1015] px-4 py-3">
              <div className="text-[10px] text-[#3D4350] uppercase tracking-[0.15em] font-medium mb-1">Protocols</div>
              <div className="text-lg font-mono font-bold tabular-nums text-[#C8CBD4]">3</div>
            </div>
          </div>

          {/* ── Live Spreads ── */}
          <div className="animate-in" style={{ '--stagger': 3 } as React.CSSProperties}>
            <SectionLine
              label="Live Spreads"
              right={
                <div className="flex items-center gap-4">
                  {(marketsData?.opportunities?.length ?? 0) > 0 && (
                    <span className="text-xs font-mono text-[#4A5060]">
                      {marketsData!.opportunities.length} active
                    </span>
                  )}
                  <Link href="/markets" className="text-xs font-medium text-[#4A5060] hover:text-[#00D4FF] transition-colors">
                    View all &rarr;
                  </Link>
                </div>
              }
            />

            {topOpps.length === 0 ? (
              <div className="py-10 text-center">
                <div className="text-sm font-mono text-[#3D4350]">NO ACTIVE SPREADS</div>
                <div className="text-xs text-[#262D3D] mt-1.5">Waiting for scanner to find opportunities</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-[#3D4350] uppercase tracking-[0.12em]">
                      <th className="pb-2.5 pl-1 text-left font-semibold w-7">#</th>
                      <th className="pb-2.5 text-left font-semibold">Market</th>
                      <th className="pb-2.5 text-left font-semibold">Platforms</th>
                      <th className="pb-2.5 text-right font-semibold pr-1">Spread</th>
                      <th className="pb-2.5 text-right font-semibold">Profit</th>
                      <th className="pb-2.5 text-right font-semibold">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topOpps.map((opp, i) => {
                      const profit = Number(opp.estProfit) / 1e6
                      const cost = Number(opp.totalCost) / 1e18
                      const marketQuery = encodeURIComponent(opp.title || opp.marketId)
                      return (
                        <tr
                          key={`${opp.marketId}-${i}`}
                          className={`
                            border-t border-[#1C2030]/50 transition-colors cursor-pointer
                            hover:bg-[#191C24]/60 ${i === 0 ? 'row-glow' : ''}
                          `}
                          onClick={() => router.push(`/markets?q=${marketQuery}`)}
                        >
                          <td className="py-3 pl-1 font-mono text-xs text-[#3D4350] font-medium">{i + 1}</td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-3">
                              <MarketThumb src={opp.image} title={opp.title} size={32} />
                              <span className="text-sm text-[#C8CBD4] truncate block max-w-[300px] font-medium" title={opp.title ?? opp.marketId}>
                                {opp.title || truncateAddress(opp.marketId)}
                              </span>
                            </div>
                          </td>
                          <td className="py-3">
                            <span className="inline-flex items-center gap-1.5">
                              <ProtocolLogo name={opp.protocolA} size={20} />
                              <ProtocolLogo name={opp.protocolB} size={20} />
                            </span>
                          </td>
                          <td className="py-3 pr-1">
                            <SpreadIndicator bps={opp.spreadBps} best={i === 0} />
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-sm text-[#22C55E]/80 font-medium">
                            {formatUSD(profit)}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-sm text-[#4A5060]">
                            {formatUSD(cost)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="mt-3 pt-3 border-t border-[#1C2030]/50 text-center">
                  <Link
                    href="/markets"
                    className="text-xs font-medium font-mono text-[#4A5060] hover:text-[#00D4FF] transition-colors"
                  >
                    View all opportunities &rarr;
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ── Recent Trades ── */}
          <div className="animate-in" style={{ '--stagger': 4 } as React.CSSProperties}>
            <SectionLine
              label="Recent Trades"
              right={
                trades.length > 0 ? (
                  <Link href="/trades" className="text-xs font-medium text-[#4A5060] hover:text-[#00D4FF] transition-colors">
                    View all &rarr;
                  </Link>
                ) : undefined
              }
            />

            {trades.length === 0 ? (
              <div className="py-10 text-center">
                <div className="text-sm font-mono text-[#3D4350]">AWAITING EXECUTION</div>
                <div className="text-xs text-[#262D3D] mt-1.5">Trades appear after agent executes opportunities</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-[#3D4350] uppercase tracking-[0.12em]">
                      <th className="pb-2.5 text-left font-semibold">Market</th>
                      <th className="pb-2.5 text-left font-semibold">Status</th>
                      <th className="pb-2.5 text-right font-semibold">Cost</th>
                      <th className="pb-2.5 text-right font-semibold">Payout</th>
                      <th className="pb-2.5 text-right font-semibold">Spread</th>
                      <th className="pb-2.5 text-right font-semibold">P&L</th>
                      <th className="pb-2.5 text-right font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => {
                      const time = formatRelativeTime(new Date(t.openedAt).getTime() / 1000)
                      return (
                        <tr
                          key={t.id}
                          className={`
                            border-t border-[#1C2030]/50 transition-colors
                            hover:bg-[#191C24]/60 ${i === bestTradeIdx ? 'row-glow' : ''}
                          `}
                        >
                          <td className="py-3 pr-4">
                            <span className="text-sm text-[#C8CBD4] truncate block max-w-[260px] font-medium" title={t.marketTitle ?? t.marketId}>
                              {t.marketTitle || truncateAddress(t.marketId)}
                            </span>
                          </td>
                          <td className="py-3"><Badge status={t.status} /></td>
                          <td className="py-3 text-right font-mono tabular-nums text-sm text-[#6B7280]">
                            {formatUSD(t.totalCost)}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-sm text-[#6B7280]">
                            {formatUSD(t.expectedPayout)}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-sm text-[#C8CBD4] font-medium">
                            {t.spreadBps}<span className="text-[#4A5060] text-xs ml-0.5">bps</span>
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-sm font-semibold">
                            {t.pnl !== null ? (
                              <span className={t.pnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                                {t.pnl >= 0 ? '+' : ''}{formatUSD(t.pnl)}
                              </span>
                            ) : (
                              <span className="text-[#3D4350]">&mdash;</span>
                            )}
                          </td>
                          <td className="py-3 text-right font-mono text-xs text-[#4A5060]" title={time.full}>
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

          {/* ── Footer ── */}
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#3D4350] pt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00D4FF]/30 pulse-dot" />
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
