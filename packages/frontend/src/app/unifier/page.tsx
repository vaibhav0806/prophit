'use client'

import { useState, useMemo } from 'react'
import { useOpportunities } from '@/hooks/use-agent-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { MarketTable } from '@/components/unifier/market-table'

function SkeletonUnifier() {
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-800/60">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-4 w-20 ml-auto" />
        </div>
      </div>
      <div className="divide-y divide-gray-800/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-4 flex items-center gap-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-3 w-16 ml-auto" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function UnifierPage() {
  const { data: opportunities, isLoading, error } = useOpportunities()
  const [protocolFilter, setProtocolFilter] = useState('')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [sortBySpread, setSortBySpread] = useState(true)

  const protocols = useMemo(() => {
    if (!opportunities) return []
    const set = new Set<string>()
    for (const opp of opportunities) {
      set.add(opp.protocolA)
      set.add(opp.protocolB)
    }
    return Array.from(set).sort()
  }, [opportunities])

  return (
    <ErrorBoundary>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Market Unifier</h1>
            <p className="text-sm text-gray-500 mt-1">Cross-protocol market comparison and matching</p>
          </div>
          {opportunities && (
            <div className="text-xs text-gray-500 bg-gray-900/60 border border-gray-800/60 rounded-lg px-3 py-1.5 font-mono tabular-nums">
              {opportunities.length} market{opportunities.length === 1 ? '' : 's'}
            </div>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Protocol filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setProtocolFilter('')}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                ${protocolFilter === ''
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : 'bg-gray-800/40 text-gray-400 border border-gray-700/40 hover:bg-gray-800/60 hover:text-gray-300'
                }
              `}
            >
              All Protocols
            </button>
            {protocols.map((p) => (
              <button
                key={p}
                onClick={() => setProtocolFilter(protocolFilter === p ? '' : p)}
                className={`
                  px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                  ${protocolFilter === p
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                    : 'bg-gray-800/40 text-gray-400 border border-gray-700/40 hover:bg-gray-800/60 hover:text-gray-300'
                  }
                `}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-800 hidden sm:block" />

          {/* Match filter pills */}
          <div className="flex items-center gap-1.5">
            {(['all', 'matched', 'unmatched'] as const).map((val) => (
              <button
                key={val}
                onClick={() => setMatchFilter(val)}
                className={`
                  px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all duration-150
                  ${matchFilter === val
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                    : 'bg-gray-800/40 text-gray-400 border border-gray-700/40 hover:bg-gray-800/60 hover:text-gray-300'
                  }
                `}
              >
                {val}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-800 hidden sm:block" />

          {/* Sort toggle */}
          <button
            onClick={() => setSortBySpread(!sortBySpread)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
              ${sortBySpread
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                : 'bg-gray-800/40 text-gray-400 border border-gray-700/40 hover:bg-gray-800/60 hover:text-gray-300'
              }
            `}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 16.5m0 0L12 12m4.5 4.5V7.5" />
            </svg>
            Sort by Spread
          </button>
        </div>

        {isLoading && <SkeletonUnifier />}

        {error && (
          <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl p-5">
            <div className="font-medium mb-1">Failed to load markets</div>
            <div className="text-sm text-red-400/70">{(error as Error).message}</div>
          </div>
        )}

        {opportunities && opportunities.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
              <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            </div>
            <div className="text-gray-400 font-medium">No markets found across protocols</div>
            <div className="text-sm text-gray-600 mt-1">Markets will appear as protocols are scanned</div>
          </div>
        )}

        {opportunities && opportunities.length > 0 && (
          <MarketTable
            opportunities={opportunities}
            protocolFilter={protocolFilter}
            matchFilter={matchFilter}
            sortBySpread={sortBySpread}
          />
        )}
      </div>
    </ErrorBoundary>
  )
}
