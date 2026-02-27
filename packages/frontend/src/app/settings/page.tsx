'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile, useUpdateConfig } from '@/hooks/use-platform-api'
import { useAuth } from '@/hooks/use-auth'

const DURATION_OPTIONS = [
  { label: '1 hour', value: '3600000' },
  { label: '6 hours', value: '21600000' },
  { label: '12 hours', value: '43200000' },
  { label: '24 hours', value: '86400000' },
  { label: 'Unlimited', value: '' },
] as const

const RESOLUTION_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'Any', value: null },
] as const

// Config trade sizes are stored as plain USDT amounts (no wei conversion)
function parseUsdt(raw: string): string {
  const num = parseFloat(raw)
  if (isNaN(num) || num === 0) return ''
  return String(num)
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] font-semibold shrink-0">{label}</span>
      <div className="flex-1 h-px bg-[#1C2030]" />
    </div>
  )
}

function SkeletonSettings() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="skeleton h-2.5 w-28" />
          <div className="flex-1 h-px bg-[#1C2030]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton h-3 w-32 mb-2.5" />
              <div className="skeleton h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="skeleton h-2.5 w-24" />
          <div className="flex-1 h-px bg-[#1C2030]" />
        </div>
        <div className="skeleton h-10 w-full rounded-lg mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="skeleton h-3 w-28 mb-2.5" />
            <div className="skeleton h-10 w-full rounded-lg" />
          </div>
          <div>
            <div className="skeleton h-3 w-28 mb-2.5" />
            <div className="skeleton h-10 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { isAuthenticated, isReady } = useAuth()
  const { data: profile, isLoading } = useProfile()
  const updateConfig = useUpdateConfig()

  const [minTradeSize, setMinTradeSize] = useState('')
  const [maxTradeSize, setMaxTradeSize] = useState('')
  const [minSpreadPct, setMinSpreadPct] = useState(1)
  const [maxSpreadPct, setMaxSpreadPct] = useState(4)
  const [maxTotalTrades, setMaxTotalTrades] = useState('')
  const [unlimitedTrades, setUnlimitedTrades] = useState(true)
  const [tradingDuration, setTradingDuration] = useState('')
  const [dailyLossLimit, setDailyLossLimit] = useState('')
  const [maxResolutionDays, setMaxResolutionDays] = useState<number | null>(null)

  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Auth guard
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isReady, isAuthenticated, router])

  // Populate form from profile
  const populateForm = useCallback(() => {
    const config = profile?.config
    if (!config) return

    setMinTradeSize(parseUsdt(config.minTradeSize))
    setMaxTradeSize(parseUsdt(config.maxTradeSize))
    setMinSpreadPct(config.minSpreadBps / 100)
    setMaxSpreadPct((config.maxSpreadBps ?? 400) / 100)
    setUnlimitedTrades(config.maxTotalTrades === null)
    setMaxTotalTrades(config.maxTotalTrades !== null ? String(config.maxTotalTrades) : '')
    setTradingDuration(config.tradingDurationMs ?? '')
    setDailyLossLimit(parseUsdt(config.dailyLossLimit))
    setMaxResolutionDays(config.maxResolutionDays)
    setDirty(false)
  }, [profile?.config])

  useEffect(() => {
    populateForm()
  }, [populateForm])

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
  }

  const handleSave = () => {
    const minTrade = parseFloat(minTradeSize)
    const maxTrade = parseFloat(maxTradeSize)
    const lossLimit = parseFloat(dailyLossLimit)

    if (isNaN(minTrade) || minTrade <= 0) return
    if (isNaN(maxTrade) || maxTrade <= 0) return
    if (maxTrade < minTrade) return
    if (isNaN(lossLimit) || lossLimit <= 0) return

    const payload: Record<string, unknown> = {
      minTradeSize: minTradeSize,
      maxTradeSize: maxTradeSize,
      minSpreadBps: Math.round(minSpreadPct * 100),
      maxSpreadBps: Math.round(maxSpreadPct * 100),
      maxTotalTrades: unlimitedTrades ? null : Number(maxTotalTrades) || null,
      tradingDurationMs: tradingDuration || null,
      dailyLossLimit: dailyLossLimit,
      maxResolutionDays: maxResolutionDays,
    }

    updateConfig.mutate(payload, {
      onSuccess: () => {
        setSaved(true)
        setDirty(false)
        setTimeout(() => setSaved(false), 3000)
      },
    })
  }

  if (!isReady || !isAuthenticated) return null

  return (
    <div className="p-5 lg:p-6 page-enter max-w-2xl">
      <h1 className="text-xs font-semibold text-[#3D4350] uppercase tracking-[0.15em] mb-5">Settings</h1>

      {isLoading && <SkeletonSettings />}

      {profile?.config && (
        <div className="space-y-8">
          {/* Trade Sizing */}
          <div>
            <SectionDivider label="Trade Sizing" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
                  Minimum Trade Size
                  <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    value={minTradeSize}
                    onChange={(e) => { setMinTradeSize(e.target.value); markDirty() }}
                    min={0}
                    step={0.01}
                    placeholder="1.00"
                    className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg pl-7 pr-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
                  Maximum Trade Size
                  <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    value={maxTradeSize}
                    onChange={(e) => { setMaxTradeSize(e.target.value); markDirty() }}
                    min={0}
                    step={0.01}
                    placeholder="100.00"
                    className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg pl-7 pr-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
                  Safety Circuit Breaker
                  <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    value={dailyLossLimit}
                    onChange={(e) => { setDailyLossLimit(e.target.value); markDirty() }}
                    min={0}
                    step={0.01}
                    placeholder="50.00"
                    className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg pl-7 pr-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
                  />
                </div>
                <p className="text-xs text-gray-600 mt-1.5">Pauses the agent if execution failures (partial fills, RPC errors) cause net losses exceeding this amount in a day</p>
              </div>
            </div>
          </div>

          {/* Profit & Risk */}
          <div>
            <SectionDivider label="Profit & Risk" />

            {/* Spread slider */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium">
                  Minimum Profit Margin
                </label>
                <span className="text-sm font-mono tabular-nums text-[#00D4FF]">
                  {minSpreadPct.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.1}
                value={minSpreadPct}
                onChange={(e) => { setMinSpreadPct(parseFloat(e.target.value)); markDirty() }}
                className="w-full h-1.5 rounded-full cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                <span>0.5%</span>
                <span>10%</span>
              </div>
            </div>

            {/* Max spread slider */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium">
                  Maximum Profit Margin
                </label>
                <span className="text-sm font-mono tabular-nums text-[#00D4FF]">
                  {maxSpreadPct.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.1}
                value={maxSpreadPct}
                onChange={(e) => { setMaxSpreadPct(parseFloat(e.target.value)); markDirty() }}
                className="w-full h-1.5 rounded-full cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                <span>1%</span>
                <span>10%</span>
              </div>
              <p className="text-xs text-gray-600 mt-1.5">Spreads above this are likely illiquid traps — skip them</p>
            </div>

            {/* Max total trades */}
            <div>
              <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
                Maximum Total Trades
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={unlimitedTrades}
                    onClick={() => { setUnlimitedTrades(!unlimitedTrades); markDirty() }}
                    className={`
                      relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200
                      ${unlimitedTrades ? 'bg-[#00D4FF]/60' : 'bg-gray-700'}
                    `}
                  >
                    <span
                      className={`
                        pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200
                        ${unlimitedTrades ? 'translate-x-4' : 'translate-x-0'}
                      `}
                    />
                  </button>
                  <span className="text-sm text-gray-400">Unlimited</span>
                </label>
                {!unlimitedTrades && (
                  <input
                    type="number"
                    value={maxTotalTrades}
                    onChange={(e) => { setMaxTotalTrades(e.target.value); markDirty() }}
                    min={1}
                    placeholder="100"
                    className="w-32 bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Timing */}
          <div>
            <SectionDivider label="Timing" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
                  Trading Duration
                </label>
                <select
                  value={tradingDuration}
                  onChange={(e) => { setTradingDuration(e.target.value); markDirty() }}
                  className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors appearance-none cursor-pointer"
                >
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1.5">How long the agent trades per session</p>
              </div>
              <div>
                <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
                  Market Resolution Window
                </label>
                <select
                  value={maxResolutionDays === null ? '' : String(maxResolutionDays)}
                  onChange={(e) => { setMaxResolutionDays(e.target.value === '' ? null : Number(e.target.value)); markDirty() }}
                  className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors appearance-none cursor-pointer"
                >
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <option key={String(opt.value)} value={opt.value === null ? '' : String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1.5">Only trade markets that resolve within this window</p>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={updateConfig.isPending || !dirty}
              className={`
                px-6 py-3 rounded-xl text-sm
                disabled:opacity-40 disabled:cursor-not-allowed
                ${saved
                  ? 'bg-[#00D4FF]/20 border-2 border-[#00D4FF]/40 text-[#00D4FF]'
                  : 'btn-accent'
                }
              `}
            >
              {updateConfig.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-[#006680] border-t-[#00D4FF] rounded-full spin-slow" />
                  Saving...
                </span>
              ) : saved ? (
                'Settings saved'
              ) : (
                'Save Settings'
              )}
            </button>
            {dirty && !saved && (
              <span className="text-xs text-[#00D4FF]/70">Unsaved changes</span>
            )}
          </div>
        </div>
      )}

      {!isLoading && !profile?.config && (
        <div className="py-8 text-center">
          <div className="text-xs font-mono text-[#262D3D]">No configuration found — complete onboarding to set up trading parameters</div>
        </div>
      )}
    </div>
  )
}
