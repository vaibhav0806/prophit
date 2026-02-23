'use client'

import { useState } from 'react'
import { usePositions } from '@/hooks/use-agent-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { TradeLog } from '@/components/audit/trade-log'

function SkeletonAudit() {
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
      <div className="divide-y divide-gray-800/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-4 flex items-center gap-4">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-5 w-14" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-32" />
            <div className="skeleton h-3 w-16 ml-auto" />
            <div className="skeleton h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AuditPage() {
  const { data: positions, isLoading, error } = usePositions()
  const [actionFilter, setActionFilter] = useState<'all' | 'open' | 'closed'>('all')

  return (
    <ErrorBoundary>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1>
            <p className="text-sm text-gray-500 mt-1">Complete trade execution history</p>
          </div>
          {positions && (
            <div className="text-xs text-gray-500 bg-gray-900/60 border border-gray-800/60 rounded-lg px-3 py-1.5 font-mono tabular-nums">
              {positions.length} trade{positions.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5 mb-6">
          {(['all', 'open', 'closed'] as const).map((val) => (
            <button
              key={val}
              onClick={() => setActionFilter(val)}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all duration-150
                ${actionFilter === val
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : 'bg-gray-800/40 text-gray-400 border border-gray-700/40 hover:bg-gray-800/60 hover:text-gray-300'
                }
              `}
            >
              {val === 'all' ? 'All Trades' : val === 'open' ? 'Open Only' : 'Closed Only'}
            </button>
          ))}
        </div>

        {isLoading && <SkeletonAudit />}

        {error && (
          <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl p-5">
            <div className="font-medium mb-1">Failed to load trade history</div>
            <div className="text-sm text-red-400/70">{(error as Error).message}</div>
          </div>
        )}

        {positions && positions.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
              <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
              </svg>
            </div>
            <div className="text-gray-400 font-medium">No trades recorded</div>
            <div className="text-sm text-gray-600 mt-1">The agent has not executed any trades yet</div>
          </div>
        )}

        {positions && positions.length > 0 && (
          <TradeLog positions={positions} actionFilter={actionFilter} />
        )}
      </div>
    </ErrorBoundary>
  )
}
