'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useExportWallet } from '@privy-io/react-auth'
import { useWallet, useWithdraw } from '@/hooks/use-platform-api'
import { useAuth } from '@/hooks/use-auth'
import { formatUSD, formatNumber } from '@/lib/format'

// --- Helpers ---

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] font-semibold shrink-0">{label}</span>
      <div className="flex-1 h-px bg-[#1C2030]" />
    </div>
  )
}

// --- Skeletons ---

function SkeletonBalances() {
  return (
    <div className="flex gap-12 mb-8">
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="skeleton h-2.5 w-16 mb-2" />
          <div className="skeleton h-7 w-32" />
        </div>
      ))}
    </div>
  )
}

function SkeletonDeposit() {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <div className="skeleton h-2.5 w-16" />
        <div className="flex-1 h-px bg-[#1C2030]" />
      </div>
      <div className="skeleton h-12 w-full mb-3" />
      <div className="skeleton h-3 w-64" />
    </div>
  )
}

function SkeletonHistory() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="skeleton h-2.5 w-28" />
        <div className="flex-1 h-px bg-[#1C2030]" />
      </div>
      <div className="divide-y divide-[#1C2030]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="py-3 flex items-center gap-4">
            <div className="skeleton h-3 w-12" />
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-3 w-32 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Components ---

function BalanceDisplay({ usdtRaw, bnbRaw }: { usdtRaw: string; bnbRaw: string }) {
  const usdt = Number(usdtRaw)
  const bnb = Number(bnbRaw)

  return (
    <div className="flex gap-12 mb-8">
      <div>
        <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.12em] font-medium mb-1">USDT</div>
        <div className="text-xl font-mono font-semibold tabular-nums text-white">
          {formatUSD(usdt, 2)}
        </div>
      </div>
      <div>
        <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.12em] font-medium mb-1">BNB</div>
        <div className="text-xl font-mono font-semibold tabular-nums text-white">
          {formatNumber(bnb, 6)}
        </div>
      </div>
    </div>
  )
}

function DepositSection({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea')
      el.value = address
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
    }
  }

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <div className="mb-8">
      <SectionDivider label="Deposit" />

      <div className="bg-[#191C24]/80 border border-[#262D3D] rounded-lg p-4 flex items-center gap-3">
        <code className="flex-1 font-mono text-sm sm:text-base text-gray-200 break-all leading-relaxed select-all">
          {address}
        </code>
        <button
          onClick={handleCopy}
          className={`
            shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200
            ${copied
              ? 'bg-[#00D4FF]/15 border border-[#00D4FF]/30 text-[#00D4FF]'
              : 'bg-[#191C24] border border-[#262D3D] text-gray-300 hover:bg-[#262D3D] hover:text-white'
            }
          `}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p className="text-[13px] text-gray-500 mt-3">
        Send USDT and BNB to this address on BSC (BEP-20)
      </p>
      <p className="text-xs text-[#00D4FF]/80 mt-1.5 flex items-center gap-1.5">
        <span className="inline-block w-1 h-1 rounded-full bg-[#00D4FF]/80" />
        Only send assets on the BNB Smart Chain network
      </p>
    </div>
  )
}

function ExportWalletSection({ address }: { address: string }) {
  const { exportWallet } = useExportWallet()

  return (
    <div className="mb-8">
      <SectionDivider label="Export Wallet" />
      <p className="text-[13px] text-gray-500 mb-4">
        Export your private key to use this wallet in any external app. You have full custody of your funds.
      </p>
      <button
        onClick={() => exportWallet({ address })}
        className="px-4 py-2.5 rounded-lg text-sm font-medium bg-[#191C24] border border-[#262D3D] text-gray-300 hover:text-white hover:border-gray-600/80 transition-all duration-150"
      >
        Export Private Key
      </button>
    </div>
  )
}

function WithdrawSection({ usdtRaw, bnbRaw }: { usdtRaw: string; bnbRaw: string }) {
  const withdraw = useWithdraw()
  const [token, setToken] = useState<'USDT' | 'BNB'>('USDT')
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const usdtBalance = Number(usdtRaw)
  const bnbBalance = Number(bnbRaw)
  const currentBalance = token === 'USDT' ? usdtBalance : bnbBalance
  const minWithdrawal = token === 'USDT' ? 1 : 0.001

  // Reset success state after delay
  useEffect(() => {
    if (!withdraw.isSuccess) return
    const t = setTimeout(() => {
      withdraw.reset()
      setAmount('')
      setToAddress('')
    }, 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdraw.isSuccess])

  const handleMax = () => {
    setAmount(String(currentBalance))
    setValidationError(null)
  }

  const validate = (): string | null => {
    const num = Number(amount)
    if (!amount || isNaN(num) || num <= 0) return 'Enter a valid amount'
    if (num < minWithdrawal) return `Minimum withdrawal: ${minWithdrawal} ${token}`
    if (num > currentBalance) return 'Insufficient balance'
    if (!toAddress.trim()) return 'Enter a destination address'
    if (!isValidAddress(toAddress.trim())) return 'Invalid address (must be 0x... 42 characters)'
    return null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate()
    if (err) {
      setValidationError(err)
      return
    }
    setValidationError(null)
    withdraw.mutate({ token, amount, toAddress: toAddress.trim() })
  }

  return (
    <div className="mb-8 max-w-2xl">
      <SectionDivider label="Withdraw" />

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Token selector */}
        <div>
          <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
            Token
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setToken('USDT'); setAmount(''); setValidationError(null) }}
              className={`
                flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
                ${token === 'USDT'
                  ? 'bg-[#00D4FF]/10 border-2 border-[#00D4FF]/30 text-[#00D4FF]'
                  : 'bg-[#191C24]/80 border-2 border-[#262D3D] text-gray-500 hover:text-gray-300 hover:border-[#262D3D]'
                }
              `}
            >
              USDT
            </button>
            <button
              type="button"
              onClick={() => { setToken('BNB'); setAmount(''); setValidationError(null) }}
              className={`
                flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
                ${token === 'BNB'
                  ? 'bg-amber-500/10 border-2 border-amber-500/30 text-amber-400'
                  : 'bg-[#191C24]/80 border-2 border-[#262D3D] text-gray-500 hover:text-gray-300 hover:border-[#262D3D]'
                }
              `}
            >
              BNB
            </button>
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
            Amount
            <span className="text-gray-600 ml-1 normal-case tracking-normal">
              (available: {formatNumber(currentBalance, token === 'USDT' ? 2 : 6)} {token})
            </span>
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setValidationError(null) }}
              placeholder="0.00"
              className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 pr-16 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
            />
            <button
              type="button"
              onClick={handleMax}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded text-xs font-medium uppercase tracking-wide bg-[#191C24] text-gray-400 hover:text-white hover:bg-[#262D3D] transition-colors"
            >
              Max
            </button>
          </div>
        </div>

        {/* Destination address */}
        <div>
          <label className="block text-[11px] text-[#6B7280] uppercase tracking-[0.1em] font-medium mb-2">
            Destination Address
          </label>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => { setToAddress(e.target.value); setValidationError(null) }}
            placeholder="0x..."
            className="w-full bg-[#191C24] border border-[#262D3D] rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-[#00D4FF]/50 focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
          />
        </div>

        {/* Validation / mutation error */}
        {(validationError || withdraw.isError) && (
          <div className="text-sm text-[#EF4444] bg-red-950/30 border border-red-900/50 rounded-lg px-3.5 py-2.5">
            {validationError || (withdraw.error as Error)?.message || 'Withdrawal failed'}
          </div>
        )}

        {/* Success */}
        {withdraw.isSuccess && (
          <div className="text-sm text-[#00D4FF] bg-[#00D4FF]/5 border border-[#00D4FF]/20 rounded-lg px-3.5 py-2.5">
            Withdrawal submitted successfully
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={withdraw.isPending}
          className="
            w-full py-3 rounded-xl text-sm
            btn-accent
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          {withdraw.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full spin-slow" />
              Processing...
            </span>
          ) : (
            `Withdraw ${token}`
          )}
        </button>
      </form>
    </div>
  )
}

function TransactionHistory({ deposits }: {
  deposits: Array<{ id: string; token: string; amount: string; confirmedAt: string }>
}) {
  const sorted = useMemo(
    () => [...deposits].sort((a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()),
    [deposits],
  )

  if (sorted.length === 0) {
    return (
      <div>
        <SectionDivider label="Deposit History" />
        <div className="py-8 text-center">
          <div className="text-xs font-mono text-[#262D3D]">No deposits yet — deposits will appear here once confirmed on-chain</div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <SectionDivider label="Deposit History" />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] table-styled">
          <thead>
            <tr className="border-b border-[#1C2030] text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-0 pr-4 py-2.5 text-left font-medium">Token</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="px-4 pr-0 py-2.5 text-right font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1C2030]">
            {sorted.map((dep) => {
              const amount = Number(dep.amount)
              const date = new Date(dep.confirmedAt)
              const dateStr = date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })

              return (
                <tr
                  key={dep.id}
                  className="transition-colors hover:bg-[#191C24]"
                >
                  <td className="px-0 pr-4 py-3">
                    <span className={`
                      text-[10px] px-1.5 py-px rounded font-mono font-medium uppercase tracking-wider border
                      ${dep.token === 'USDT' || dep.token === 'usdt'
                        ? 'bg-[#00D4FF]/10 text-[#00D4FF] border-[#00D4FF]/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }
                    `}>
                      {dep.token.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-200">
                    {formatNumber(amount, dep.token.toUpperCase() === 'BNB' ? 6 : 2)}
                  </td>
                  <td className="px-4 pr-0 py-3 text-right text-gray-400 text-[13px]">
                    {dateStr}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Page ---

export default function WalletPage() {
  const router = useRouter()
  const { isAuthenticated, isReady } = useAuth()

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isReady, isAuthenticated, router])

  const { data: wallet, isLoading, error } = useWallet()

  // Don't render until auth check completes
  if (!isReady || !isAuthenticated) return null

  return (
    <div className="p-5 lg:p-6 page-enter">
      <h1 className="text-xs font-semibold text-[#3D4350] uppercase tracking-[0.15em] mb-5">Wallet</h1>

      {isLoading && (
        <div>
          <SkeletonBalances />
          <SkeletonDeposit />
          <SkeletonHistory />
        </div>
      )}

      {error && (
        <div className="text-[#EF4444] bg-red-950/30 border border-red-900/50 rounded-lg p-4">
          <div className="font-medium mb-1 text-sm">Failed to load wallet</div>
          <div className="text-[13px] text-[#EF4444]/70">{(error as Error).message}</div>
        </div>
      )}

      {wallet && (
        <div>
          <BalanceDisplay usdtRaw={wallet.usdtBalance} bnbRaw={wallet.bnbBalance} />
          <DepositSection address={wallet.address} />
          <ExportWalletSection address={wallet.address} />
          <WithdrawSection usdtRaw={wallet.usdtBalance} bnbRaw={wallet.bnbBalance} />
          <TransactionHistory deposits={wallet.deposits} />
        </div>
      )}
    </div>
  )
}
