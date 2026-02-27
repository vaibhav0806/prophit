'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet, useProfile, useUpdateConfig } from '@/hooks/use-platform-api'
import { useAuth } from '@/hooks/use-auth'
import { formatNumber, truncateAddress } from '@/lib/format'

const STEPS = ['Welcome', 'Fund', 'Configure', 'Ready'] as const

const RESOLUTION_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'Any', value: null },
] as const

const MIN_USDT = 5
const MIN_BNB = 0.005

function StepIndicator({ current, steps }: { current: number; steps: readonly string[] }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-10">
      {steps.map((label, i) => {
        const isActive = i === current
        const isDone = i < current
        return (
          <div key={label} className="flex items-center gap-1.5">
            {i > 0 && (
              <div
                className={`w-8 h-px transition-colors duration-300 ${
                  isDone ? 'bg-[#00D4FF]/50' : 'bg-gray-800'
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono font-bold
                  transition-all duration-300 border
                  ${
                    isActive
                      ? 'border-[#00D4FF] text-[#00D4FF]'
                      : isDone
                        ? 'border-[#00D4FF]/30 text-[#00D4FF]'
                        : 'border-[#262D3D] text-[#3D4350]'
                  }
                `}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span
                className={`text-[11px] uppercase tracking-wider ${
                  isActive ? 'text-[#00D4FF]' : isDone ? 'text-gray-500' : 'text-[#3D4350]'
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="
        px-3 py-1.5 rounded-lg text-[13px] font-medium
        bg-[#191C24] border border-[#262D3D]
        text-gray-400 hover:text-white hover:border-gray-600/80
        transition-all duration-150
      "
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// --- Step Components ---

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center max-w-lg mx-auto">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Welcome to{' '}
          <span
            className="inline-block font-bold uppercase text-white"
            style={{ textShadow: '0 0 20px rgba(0, 212, 255, 0.3)' }}
          >
            PROPHIT
          </span>
        </h1>
      </div>
      <p className="text-sm text-[#6B7280] mb-8">
        Automated prediction market arbitrage on BNB Smart Chain
      </p>

      <div className="rounded border border-[#1C2030] bg-[#111318] p-6 text-left space-y-4 mb-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-xs font-mono text-[#3D4350] flex-shrink-0 w-4 text-right">1.</span>
          <div>
            <div className="text-sm font-medium text-gray-200">Scan for spreads</div>
            <div className="text-[13px] text-gray-500 mt-0.5">
              The agent continuously monitors prediction markets across Polymarket, Kalshi, and
              on-chain protocols for price discrepancies.
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-xs font-mono text-[#3D4350] flex-shrink-0 w-4 text-right">2.</span>
          <div>
            <div className="text-sm font-medium text-gray-200">Execute arbitrage</div>
            <div className="text-[13px] text-gray-500 mt-0.5">
              When a profitable spread is found, the agent buys opposing positions across
              platforms to lock in a guaranteed return.
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-xs font-mono text-[#3D4350] flex-shrink-0 w-4 text-right">3.</span>
          <div>
            <div className="text-sm font-medium text-gray-200">Collect profits on resolution</div>
            <div className="text-[13px] text-gray-500 mt-0.5">
              When markets resolve, one side always pays out. Your profit is the spread minus
              fees, regardless of the outcome.
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onNext}
        className="px-8 py-3 rounded-xl text-sm btn-accent"
      >
        Get Started
      </button>
    </div>
  )
}

function FundStep({ onNext }: { onNext: () => void }) {
  const { data: wallet, isLoading } = useWallet()

  const usdtBalance = wallet ? Number(wallet.usdtBalance) : 0
  const bnbBalance = wallet ? Number(wallet.bnbBalance) : 0
  const usdtMet = usdtBalance >= MIN_USDT
  const bnbMet = bnbBalance >= MIN_BNB
  const canContinue = usdtMet && bnbMet

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Fund Your Wallet</h2>
        <p className="text-sm text-[#6B7280]">
          Send USDT and a small amount of BNB (for gas) to this address on BSC
        </p>
      </div>

      <div className="rounded border border-[#1C2030] bg-[#111318] p-6 space-y-5">
        {/* Deposit address */}
        <div>
          <div className="text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
            Deposit Address (BSC)
          </div>
          {isLoading ? (
            <div className="skeleton h-10 w-full" />
          ) : wallet?.address ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums text-gray-300 truncate">
                {wallet.address}
              </div>
              <CopyButton text={wallet.address} />
            </div>
          ) : (
            <div className="text-sm text-gray-600">Loading wallet...</div>
          )}
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#191C24]/60 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium">USDT</span>
              {usdtMet && <span className="text-[#00D4FF] text-[13px]">Funded</span>}
            </div>
            {isLoading ? (
              <div className="skeleton h-7 w-20" />
            ) : (
              <div
                className={`font-mono text-lg font-bold tabular-nums ${
                  usdtMet ? 'text-[#00D4FF]' : 'text-gray-400'
                }`}
              >
                ${formatNumber(usdtBalance, 2)}
              </div>
            )}
            <div className="text-[11px] text-gray-600 mt-1">
              Min: ${MIN_USDT.toFixed(2)}
            </div>
          </div>

          <div className="bg-[#191C24]/60 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium">BNB</span>
              {bnbMet && <span className="text-[#00D4FF] text-[13px]">Funded</span>}
            </div>
            {isLoading ? (
              <div className="skeleton h-7 w-20" />
            ) : (
              <div
                className={`font-mono text-lg font-bold tabular-nums ${
                  bnbMet ? 'text-[#00D4FF]' : 'text-gray-400'
                }`}
              >
                {formatNumber(bnbBalance, 4)}
              </div>
            )}
            <div className="text-[11px] text-gray-600 mt-1">
              Min: {MIN_BNB} BNB
            </div>
          </div>
        </div>

        {!canContinue && !isLoading && (
          <div className="flex items-center gap-2 text-[13px] text-gray-500">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500/60 pulse-dot" />
            Waiting for deposits... balances refresh automatically.
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-center">
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="
            px-8 py-3 rounded-xl text-sm
            btn-accent
            disabled:opacity-30 disabled:cursor-not-allowed
          "
        >
          Continue
        </button>
      </div>
    </div>
  )
}

function ConfigureStep({ onNext }: { onNext: () => void }) {
  const updateConfig = useUpdateConfig()

  const [minTradeSize, setMinTradeSize] = useState('5')
  const [maxTradeSize, setMaxTradeSize] = useState('50')
  const [minProfitPercent, setMinProfitPercent] = useState('1.5')
  const [maxTrades, setMaxTrades] = useState('')
  const [maxResolutionDays, setMaxResolutionDays] = useState<number | null>(30)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setError(null)

    const minSize = Number(minTradeSize)
    const maxSize = Number(maxTradeSize)
    const profitPct = Number(minProfitPercent)
    const trades = maxTrades ? Number(maxTrades) : null

    if (isNaN(minSize) || minSize < 1) {
      setError('Minimum trade size must be at least $1')
      return
    }
    if (isNaN(maxSize) || maxSize < minSize) {
      setError('Maximum trade size must be greater than minimum')
      return
    }
    if (isNaN(profitPct) || profitPct <= 0 || profitPct > 100) {
      setError('Profit margin must be between 0% and 100%')
      return
    }
    if (trades !== null && (isNaN(trades) || trades < 1)) {
      setError('Max trades must be at least 1, or leave empty for unlimited')
      return
    }

    // Convert percentage to basis points
    const spreadBps = Math.round(profitPct * 100)

    try {
      await updateConfig.mutateAsync({
        minTradeSize: String(minSize),
        maxTradeSize: String(maxSize),
        minSpreadBps: spreadBps,
        maxTotalTrades: trades,
        maxResolutionDays,
      })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration')
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Configure Agent</h2>
        <p className="text-sm text-[#6B7280]">
          Set your trading parameters. You can change these later.
        </p>
      </div>

      <div className="rounded border border-[#1C2030] bg-[#111318] p-6 space-y-5">
        {/* Trade size range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
              Min Trade Size
              <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
            </label>
            <input
              type="number"
              value={minTradeSize}
              onChange={(e) => setMinTradeSize(e.target.value)}
              min={1}
              step={1}
              className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
              Max Trade Size
              <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
            </label>
            <input
              type="number"
              value={maxTradeSize}
              onChange={(e) => setMaxTradeSize(e.target.value)}
              min={1}
              step={1}
              className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
            />
          </div>
        </div>

        {/* Profit margin */}
        <div>
          <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
            Min Profit Margin
            <span className="text-gray-600 ml-1 normal-case tracking-normal">
              (% &mdash; {Math.round(Number(minProfitPercent || 0) * 100)} bps)
            </span>
          </label>
          <input
            type="number"
            value={minProfitPercent}
            onChange={(e) => setMinProfitPercent(e.target.value)}
            min={0.01}
            max={100}
            step={0.1}
            className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
          />
        </div>

        {/* Max trades */}
        <div>
          <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
            Max Total Trades
            <span className="text-gray-600 ml-1 normal-case tracking-normal">(leave empty for unlimited)</span>
          </label>
          <input
            type="number"
            value={maxTrades}
            onChange={(e) => setMaxTrades(e.target.value)}
            min={1}
            placeholder="Unlimited"
            className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums placeholder:text-gray-600 focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
          />
        </div>

        {/* Resolution window */}
        <div>
          <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
            Resolution Window
          </label>
          <div className="flex flex-wrap gap-2">
            {RESOLUTION_OPTIONS.map((opt) => {
              const isSelected = maxResolutionDays === opt.value
              return (
                <button
                  key={opt.label}
                  onClick={() => setMaxResolutionDays(opt.value)}
                  className={`
                    px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150
                    ${
                      isSelected
                        ? 'bg-[#00D4FF]/15 border border-[#00D4FF]/40 text-[#00D4FF]'
                        : 'bg-[#191C24] border border-[#262D3D] text-gray-400 hover:text-gray-300 hover:border-gray-600/80'
                    }
                  `}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded p-4 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-center">
        <button
          onClick={handleSave}
          disabled={updateConfig.isPending}
          className="
            flex items-center gap-2.5 px-8 py-3 rounded-xl text-sm
            btn-accent
            disabled:opacity-60 disabled:cursor-not-allowed
          "
        >
          {updateConfig.isPending ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-[#006680] border-t-[#00D4FF] rounded-full spin-slow" />
              Saving...
            </>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </div>
  )
}

function ReadyStep() {
  const router = useRouter()
  const { data: profile, isLoading } = useProfile()
  const { data: wallet } = useWallet()

  const config = profile?.config

  return (
    <div className="max-w-lg mx-auto text-center">
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#00D4FF]/30 mb-4">
          <span className="text-[#00D4FF] text-sm">&#10003;</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2">Ready to Trade</h2>
        <p className="text-sm text-[#6B7280]">Your agent is configured and funded. Here is a summary.</p>
      </div>

      <div className="rounded border border-[#1C2030] bg-[#111318] p-6 text-left">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-4 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <SummaryRow label="Wallet" value={truncateAddress(wallet?.address || '')} mono />
            <SummaryRow
              label="USDT Balance"
              value={`$${formatNumber(Number(wallet?.usdtBalance || 0), 2)}`}
              mono
            />
            <div className="border-t border-[#1C2030] my-2" />
            <SummaryRow
              label="Trade Size"
              value={`$${config?.minTradeSize || '—'} – $${config?.maxTradeSize || '—'}`}
              mono
            />
            <SummaryRow
              label="Min Profit"
              value={config ? `${(config.minSpreadBps / 100).toFixed(1)}%` : '—'}
              mono
            />
            <SummaryRow
              label="Max Trades"
              value={config?.maxTotalTrades ? String(config.maxTotalTrades) : 'Unlimited'}
            />
            <SummaryRow
              label="Resolution Window"
              value={config?.maxResolutionDays ? `${config.maxResolutionDays} days` : 'Any'}
            />
          </div>
        )}
      </div>

      <div className="mt-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="px-8 py-3 rounded-xl text-sm btn-accent"
        >
          Start Trading
        </button>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium">{label}</span>
      <span className={`text-sm text-gray-200 ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </span>
    </div>
  )
}

// --- Main Page ---

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const { isAuthenticated, isReady } = useAuth()

  // Guard: redirect to login if not authenticated
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isReady, isAuthenticated, router])

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6">
      {/* Subtle bg */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              radial-gradient(ellipse 80% 60% at 50% 30%, rgba(0,212,255,0.06) 0%, transparent 70%)
            `,
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-xl py-12">
        <StepIndicator current={step} steps={STEPS} />

        <div className="transition-opacity duration-200">
          {step === 0 && <WelcomeStep onNext={next} />}
          {step === 1 && <FundStep onNext={next} />}
          {step === 2 && <ConfigureStep onNext={next} />}
          {step === 3 && <ReadyStep />}
        </div>
      </div>
    </div>
  )
}
