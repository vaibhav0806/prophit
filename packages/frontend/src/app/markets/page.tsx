'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMarkets } from '@/hooks/use-platform-api'
import { formatUSD, truncateAddress } from '@/lib/format'
import { ProtocolLogo, ProtocolRoute } from '@/components/protocol-logos'
import { MarketThumb } from '@/components/market-thumb'

// ---------------------------------------------------------------------------
// Protocol config
// ---------------------------------------------------------------------------

const PROTOCOL: Record<string, { color: string; bg: string; border: string }> = {
  Predict:  { color: '#60A5FA', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.22)' },
  Probable: { color: '#34D399', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.22)' },
  Opinion:  { color: '#C084FC', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.22)' },
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type SortKey = 'spread' | 'profit' | 'liquidity'

const SPREAD_RANGES = [
  { label: '< 100', min: 0, max: 99 },
  { label: '100–200', min: 100, max: 200 },
  { label: '200–500', min: 200, max: 500 },
  { label: '500+', min: 500, max: Infinity },
] as const

const LIQUIDITY_TIERS = [
  { label: 'All', min: 0 },
  { label: '> $100', min: 100 },
  { label: '> $500', min: 500 },
  { label: '> $1K', min: 1000 },
] as const

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('-')
}

function getProtocol(name: string) {
  return PROTOCOL[name] ?? { color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)', border: 'rgba(156,163,175,0.22)' }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPrice(bigintStr: string): number {
  return parseFloat(bigintStr) / 1e18
}

function toLiquidity(bigintStr: string): number {
  return parseFloat(bigintStr) / 1e6
}

function toProfit(bigintStr: string): number {
  return parseFloat(bigintStr) / 1e6
}

function fmtPrice(p: number): string {
  return p.toFixed(3)
}

function fmtLiquidity(usdt: number): string {
  if (usdt >= 1_000_000) return `$${(usdt / 1_000_000).toFixed(1)}M`
  if (usdt >= 1_000) return `$${(usdt / 1_000).toFixed(1)}K`
  return `$${usdt.toFixed(0)}`
}

function spreadColor(bps: number): string {
  if (bps >= 500) return '#33DFFF'
  if (bps >= 200) return '#00D4FF'
  if (bps >= 100) return '#34D399'
  return '#6B7280'
}

function lastScanLabel(updatedAt: number): string {
  const s = Math.floor((Date.now() - updatedAt) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// ---------------------------------------------------------------------------
// Market card
// ---------------------------------------------------------------------------

type Opp = ReturnType<typeof useMarkets>['data'] extends { opportunities: (infer T)[] } | undefined ? T : never

function MarketCard({ opp, rank }: { opp: Opp; rank: number }) {
  const [open, setOpen] = useState(false)

  const yesPrice = toPrice(opp.yesPriceA)
  const noPrice  = toPrice(opp.noPriceB)
  const estProfit = toProfit(opp.estProfit)
  const liqA = toLiquidity(opp.liquidityA)
  const liqB = toLiquidity(opp.liquidityB)
  const feesBps = opp.grossSpreadBps - opp.spreadBps

  const sideA    = opp.buyYesOnA ? 'YES' : 'NO'
  const sideB    = opp.buyYesOnA ? 'NO'  : 'YES'
  const priceA   = opp.buyYesOnA ? yesPrice : noPrice
  const priceB   = opp.buyYesOnA ? noPrice  : yesPrice

  const color     = spreadColor(opp.spreadBps)
  const barWidth  = Math.min(opp.spreadBps / 500, 1) * 100

  return (
    <div
      className={`group border rounded-lg overflow-hidden transition-all duration-200 ${
        open
          ? 'border-[#262D3D] bg-[#111318]'
          : 'border-[#1C2030] bg-[#0B0D11] hover:border-[#262D3D]/60 hover:bg-[#0E1015]'
      }`}
      style={{
        animationDelay: `${rank * 30}ms`,
      }}
    >
      {/* Clickable header */}
      <button className="w-full text-left" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3 px-3 py-3">
          {/* Rank */}
          <span className="shrink-0 w-5 text-[11px] font-mono text-[#262D3D] text-right tabular-nums select-none">
            {rank}
          </span>

          {/* Market image */}
          <MarketThumb src={opp.image} title={opp.title} size={40} />

          {/* Title + route */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-[#E0E2E9] font-medium leading-snug truncate pr-2">
              {opp.title ?? truncateAddress(opp.marketId, 8)}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <ProtocolRoute from={opp.protocolA} to={opp.protocolB} size={16} />
              <span className="text-[10px] font-mono text-[#3D4350]">
                {sideA} {fmtPrice(priceA)} / {sideB} {fmtPrice(priceB)}
              </span>
            </div>
          </div>

          {/* Right: spread + profit */}
          <div className="shrink-0 text-right ml-2">
            <div className="flex items-baseline justify-end gap-1">
              <span className="text-[15px] font-mono font-bold tabular-nums leading-tight" style={{ color }}>
                {opp.spreadBps.toLocaleString()}
              </span>
              <span className="text-[10px] font-mono text-[#3D4350]">bps</span>
            </div>
            <div className="text-[11px] font-mono text-[#3D4350] mt-0.5 tabular-nums">
              ~{formatUSD(estProfit, 2)}
              <span className="text-[#262D3D]"> / 100</span>
            </div>
          </div>

          {/* Chevron */}
          <div className="shrink-0 ml-0.5">
            <svg
              className={`w-3.5 h-3.5 text-[#3D4350] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Spread bar */}
        <div className="px-3 pb-2.5">
          <div className="h-[2px] bg-[#151820] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${barWidth}%`, background: color, opacity: 0.6 }}
            />
          </div>
        </div>
      </button>

      {/* Expanded detail panel */}
      {open && (
        <div className="border-t border-[#1C2030] px-3 py-3">
          {/* Price boxes */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg border p-3" style={{ background: '#0B0D11', borderColor: getProtocol(opp.protocolA).border }}>
              <div className="flex items-center gap-2 mb-2">
                <ProtocolLogo name={opp.protocolA} size={16} />
                <span className="text-[11px] text-[#3D4350] uppercase tracking-widest font-medium">{opp.protocolA}</span>
                <span className="text-[10px] text-[#3D4350] uppercase tracking-widest ml-auto">Buy {sideA}</span>
              </div>
              <div className="text-xl font-mono font-bold text-[#E8E8E8] tabular-nums">
                {fmtPrice(priceA)}
              </div>
              <div className="text-[11px] text-[#3D4350] mt-1 font-mono">
                Liq: {fmtLiquidity(liqA)}
              </div>
            </div>

            <div className="rounded-lg border p-3" style={{ background: '#0B0D11', borderColor: getProtocol(opp.protocolB).border }}>
              <div className="flex items-center gap-2 mb-2">
                <ProtocolLogo name={opp.protocolB} size={16} />
                <span className="text-[11px] text-[#3D4350] uppercase tracking-widest font-medium">{opp.protocolB}</span>
                <span className="text-[10px] text-[#3D4350] uppercase tracking-widest ml-auto">Buy {sideB}</span>
              </div>
              <div className="text-xl font-mono font-bold text-[#E8E8E8] tabular-nums">
                {fmtPrice(priceB)}
              </div>
              <div className="text-[11px] text-[#3D4350] mt-1 font-mono">
                Liq: {fmtLiquidity(liqB)}
              </div>
            </div>
          </div>

          {/* P&L row */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="text-center">
              <div className="text-[11px] text-[#3D4350] uppercase tracking-widest mb-1">Net Spread</div>
              <div className="text-[13px] font-mono font-bold tabular-nums" style={{ color }}>
                {opp.spreadBps} bps
              </div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-[#3D4350] uppercase tracking-widest mb-1">Gross</div>
              <div className="text-[13px] font-mono text-[#3D4350] tabular-nums">
                {opp.grossSpreadBps} bps
              </div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-[#3D4350] uppercase tracking-widest mb-1">Fees</div>
              <div className="text-[13px] font-mono text-[#3D4350] tabular-nums">
                {feesBps} bps
              </div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-[#3D4350] uppercase tracking-widest mb-1">Profit / 100</div>
              <div className="text-[13px] font-mono font-bold text-[#22C55E] tabular-nums">
                {formatUSD(estProfit, 2)}
              </div>
            </div>
          </div>

          {/* Platform links + Market ID */}
          <div className="pt-2 border-t border-[#1C2030]">
            {opp.links && (
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {(['predict', 'probable', 'opinion'] as const).map((key) => {
                  const url = opp.links?.[key]
                  if (!url) return null
                  const cfg = getProtocol(key.charAt(0).toUpperCase() + key.slice(1))
                  return (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-opacity hover:opacity-80 border"
                      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
                    >
                      <ProtocolLogo name={key} size={12} />
                      Open on {key.charAt(0).toUpperCase() + key.slice(1)}
                      <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )
                })}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#3D4350] uppercase tracking-widest">Market ID</span>
              <span className="text-[11px] font-mono text-[#3D4350] truncate">{opp.marketId}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="border border-[#1C2030] rounded-lg px-3 py-3">
          <div className="flex items-center gap-3">
            <div className="skeleton w-5 h-3 shrink-0" />
            <div className="skeleton w-10 h-10 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-3/4" />
              <div className="skeleton h-3 w-1/3" />
            </div>
            <div className="shrink-0 space-y-1.5">
              <div className="skeleton h-4 w-16" />
              <div className="skeleton h-2.5 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketsPage() {
  return (
    <Suspense>
      <MarketsPageInner />
    </Suspense>
  )
}

function MarketsPageInner() {
  const searchParams = useSearchParams()
  const { data, isLoading, dataUpdatedAt } = useMarkets()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [pairFilter, setPairFilter] = useState<string | null>(null)

  // Sync search if navigated with ?q=
  useEffect(() => {
    const q = searchParams.get('q')
    if (q) setSearch(q)
  }, [searchParams])
  const [spreadFilter, setSpreadFilter] = useState<number | null>(null)
  const [minLiquidity, setMinLiquidity] = useState(0)
  const [sortBy, setSortBy] = useState<SortKey>('spread')

  // All opps sorted by chosen key
  const sorted = useMemo(() => {
    if (!data?.opportunities) return []
    const opps = [...data.opportunities]
    switch (sortBy) {
      case 'profit':
        return opps.sort((a, b) => toProfit(b.estProfit) - toProfit(a.estProfit))
      case 'liquidity':
        return opps.sort((a, b) =>
          Math.min(toLiquidity(b.liquidityA), toLiquidity(b.liquidityB))
          - Math.min(toLiquidity(a.liquidityA), toLiquidity(a.liquidityB)),
        )
      default:
        return opps.sort((a, b) => b.spreadBps - a.spreadBps)
    }
  }, [data?.opportunities, sortBy])

  // Unique protocol pairs present in data (for filter chips)
  const availablePairs = useMemo(() => {
    const seen = new Map<string, { a: string; b: string; count: number }>()
    for (const o of sorted) {
      const key = pairKey(o.protocolA, o.protocolB)
      const existing = seen.get(key)
      if (existing) {
        existing.count++
      } else {
        // Keep alphabetical order for display consistency
        const [first, second] = [o.protocolA, o.protocolB].sort()
        seen.set(key, { a: first, b: second, count: 1 })
      }
    }
    return Array.from(seen.entries()).sort((a, b) => b[1].count - a[1].count)
  }, [sorted])

  // Apply all filters
  const filtered = useMemo(() => {
    let result = sorted

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(o =>
        (o.title ?? '').toLowerCase().includes(q) ||
        o.protocolA.toLowerCase().includes(q) ||
        o.protocolB.toLowerCase().includes(q),
      )
    }

    // Protocol pair
    if (pairFilter) {
      result = result.filter(o => pairKey(o.protocolA, o.protocolB) === pairFilter)
    }

    // Spread range
    if (spreadFilter !== null) {
      const range = SPREAD_RANGES[spreadFilter]
      result = result.filter(o => o.spreadBps >= range.min && o.spreadBps <= range.max)
    }

    // Min liquidity
    if (minLiquidity > 0) {
      result = result.filter(o =>
        Math.min(toLiquidity(o.liquidityA), toLiquidity(o.liquidityB)) >= minLiquidity,
      )
    }

    return result
  }, [sorted, search, pairFilter, spreadFilter, minLiquidity])

  const hasActiveFilters = pairFilter !== null || spreadFilter !== null || minLiquidity > 0

  const avgSpread = useMemo(() => {
    if (sorted.length === 0) return 0
    return Math.round(sorted.reduce((s, o) => s + o.spreadBps, 0) / sorted.length)
  }, [sorted])

  const topProfit = useMemo(() => {
    if (sorted.length === 0) return 0
    return toProfit(sorted[0].estProfit)
  }, [sorted])

  return (
    <div className="p-5 lg:p-6 page-enter">
      <h1 className="text-xs font-semibold text-[#3D4350] uppercase tracking-[0.15em] mb-5">Opportunities</h1>

      {/* Metrics */}
      {data && sorted.length > 0 && (
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4 mb-6">
          <div>
            <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.12em] font-medium mb-1">Opportunities</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-[#E0E2E9]">{sorted.length}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.12em] font-medium mb-1">Avg Spread</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-[#E0E2E9]">
              {avgSpread.toLocaleString()}<span className="text-sm text-[#3D4350] ml-0.5">bps</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.12em] font-medium mb-1">Best Profit</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-[#22C55E]">{formatUSD(topProfit, 2)}</div>
            <div className="text-[10px] text-[#262D3D] font-mono mt-0.5">per 100 USDT</div>
          </div>
          <div>
            <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.12em] font-medium mb-1">Last Scan</div>
            <div className="text-xl font-mono font-semibold tabular-nums text-[#E0E2E9]">
              {data.updatedAt ? lastScanLabel(data.updatedAt) : '\u2014'}
            </div>
          </div>
          {dataUpdatedAt > 0 && (
            <div className="flex items-center gap-1.5 self-center ml-auto">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00D4FF] pulse-dot" />
              <span className="text-[11px] font-mono text-[#3D4350]">
                {data?.quoteCount ?? 0} quotes
              </span>
            </div>
          )}
        </div>
      )}

      {/* Section divider + search */}
      {sorted.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] font-semibold shrink-0">Spreads</span>
            <div className="flex-1 h-px bg-[#1C2030]" />
            <span className="text-[11px] font-mono text-[#3D4350]">{filtered.length} shown</span>
          </div>

          <div className="relative mb-3">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#3D4350]"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by market title or protocol..."
              className="w-full bg-[#0B0D11] border border-[#1C2030] rounded-lg pl-9 pr-4 py-2.5 text-sm text-[#E0E2E9] placeholder-[#3D4350] focus:outline-none focus:border-[#262D3D] transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3D4350] hover:text-[#6B7280] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* ---- Filters ---- */}
          <div className="flex items-center gap-0 mb-4 rounded-lg border border-[#1C2030]/80 bg-[#0A0C10] overflow-x-auto">
            {/* Pair group */}
            <div className="flex items-center shrink-0">
              <span className="text-[9px] text-[#262D3D] uppercase tracking-[0.15em] font-semibold px-3 shrink-0 select-none">Pair</span>
              <div className="flex items-center">
                <button
                  onClick={() => setPairFilter(null)}
                  className={`relative px-2.5 py-[7px] text-[11px] font-medium transition-all duration-150 ${
                    pairFilter === null
                      ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
                      : 'text-[#3D4350] hover:text-[#6B7280] hover:bg-white/[0.02]'
                  }`}
                >
                  All
                  {pairFilter === null && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#00D4FF]/60" />}
                </button>
                {availablePairs.map(([key, { a, b, count }]) => (
                  <button
                    key={key}
                    onClick={() => setPairFilter(pairFilter === key ? null : key)}
                    className={`relative inline-flex items-center gap-1 px-2.5 py-[7px] text-[11px] font-medium transition-all duration-150 ${
                      pairFilter === key
                        ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
                        : 'text-[#3D4350] hover:text-[#6B7280] hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className="inline-flex items-center -space-x-1">
                      <ProtocolLogo name={a} size={14} />
                      <ProtocolLogo name={b} size={14} />
                    </span>
                    <span className="font-mono text-[10px] opacity-40 tabular-nums">{count}</span>
                    {pairFilter === key && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#00D4FF]/60" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-px h-5 bg-[#1C2030] shrink-0" />

            {/* Spread group */}
            <div className="flex items-center shrink-0">
              <span className="text-[9px] text-[#262D3D] uppercase tracking-[0.15em] font-semibold px-3 shrink-0 select-none">Spread</span>
              <div className="flex items-center">
                <button
                  onClick={() => setSpreadFilter(null)}
                  className={`relative px-2.5 py-[7px] text-[11px] font-mono font-medium transition-all duration-150 ${
                    spreadFilter === null
                      ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
                      : 'text-[#3D4350] hover:text-[#6B7280] hover:bg-white/[0.02]'
                  }`}
                >
                  All
                  {spreadFilter === null && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#00D4FF]/60" />}
                </button>
                {SPREAD_RANGES.map((range, i) => (
                  <button
                    key={i}
                    onClick={() => setSpreadFilter(spreadFilter === i ? null : i)}
                    className={`relative px-2.5 py-[7px] text-[11px] font-mono font-medium transition-all duration-150 whitespace-nowrap ${
                      spreadFilter === i
                        ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
                        : 'text-[#3D4350] hover:text-[#6B7280] hover:bg-white/[0.02]'
                    }`}
                  >
                    {range.label}
                    {spreadFilter === i && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#00D4FF]/60" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-px h-5 bg-[#1C2030] shrink-0" />

            {/* Liquidity group */}
            <div className="flex items-center shrink-0">
              <span className="text-[9px] text-[#262D3D] uppercase tracking-[0.15em] font-semibold px-3 shrink-0 select-none">Liq</span>
              <div className="flex items-center">
                {LIQUIDITY_TIERS.map((tier) => (
                  <button
                    key={tier.min}
                    onClick={() => setMinLiquidity(minLiquidity === tier.min ? 0 : tier.min)}
                    className={`relative px-2.5 py-[7px] text-[11px] font-mono font-medium transition-all duration-150 whitespace-nowrap ${
                      minLiquidity === tier.min
                        ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
                        : 'text-[#3D4350] hover:text-[#6B7280] hover:bg-white/[0.02]'
                    }`}
                  >
                    {tier.label}
                    {minLiquidity === tier.min && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#00D4FF]/60" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-px h-5 bg-[#1C2030] shrink-0" />

            {/* Sort group */}
            <div className="flex items-center shrink-0">
              <span className="text-[9px] text-[#262D3D] uppercase tracking-[0.15em] font-semibold px-3 shrink-0 select-none">Sort</span>
              <div className="flex items-center">
                {([
                  { key: 'spread' as SortKey, label: 'Spread' },
                  { key: 'profit' as SortKey, label: 'Profit' },
                  { key: 'liquidity' as SortKey, label: 'Liq' },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={`relative px-2.5 py-[7px] text-[11px] font-medium transition-all duration-150 ${
                      sortBy === key
                        ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
                        : 'text-[#3D4350] hover:text-[#6B7280] hover:bg-white/[0.02]'
                    }`}
                  >
                    {sortBy === key && <span className="mr-0.5 text-[9px] opacity-60">{'\u25BE'}</span>}
                    {label}
                    {sortBy === key && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#00D4FF]/60" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear — pushed right */}
            {hasActiveFilters && (
              <>
                <div className="flex-1 min-w-2" />
                <button
                  onClick={() => { setPairFilter(null); setSpreadFilter(null); setMinLiquidity(0) }}
                  className="shrink-0 px-3 py-[7px] text-[10px] font-mono text-[#3D4350] hover:text-[#00D4FF] transition-colors"
                >
                  Reset
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Content */}
      {isLoading && <Skeleton />}

      {!isLoading && sorted.length === 0 && (
        <div className="py-8 text-center">
          <div className="text-xs font-mono text-[#262D3D]">NO OPPORTUNITIES FOUND</div>
          <div className="text-[11px] text-[#1C2030] mt-1">Scanner may be starting up -- refreshes every 10 seconds</div>
        </div>
      )}

      {filtered.length === 0 && sorted.length > 0 && (
        <div className="py-8 text-center">
          <div className="text-xs font-mono text-[#262D3D]">
            {search ? <>No opportunities matching &ldquo;{search}&rdquo;</> : 'No opportunities match current filters'}
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => { setPairFilter(null); setSpreadFilter(null); setMinLiquidity(0); setSearch('') }}
              className="text-[11px] font-mono text-[#3D4350] hover:text-[#00D4FF] transition-colors mt-2"
            >
              Reset all filters
            </button>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((opp, i) => (
            <MarketCard key={`${opp.marketId}-${i}`} opp={opp} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
