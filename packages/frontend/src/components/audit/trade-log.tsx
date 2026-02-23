'use client'

import { useState } from 'react'
import { Position } from '@/hooks/use-agent-api'
import { formatValue, truncateAddress, formatRelativeTime } from '@/lib/format'

interface TradeLogProps {
  positions: Position[]
  actionFilter: 'all' | 'open' | 'closed'
}

export function TradeLog({ positions, actionFilter }: TradeLogProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const filtered = positions
    .filter((pos) => {
      if (actionFilter === 'open') return !pos.closed
      if (actionFilter === 'closed') return pos.closed
      return true
    })
    .sort((a, b) => b.openedAt - a.openedAt)

  if (filtered.length === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
        <div className="text-gray-400 font-medium">No trades match current filters</div>
        <div className="text-sm text-gray-600 mt-1">Try adjusting your filter criteria</div>
      </div>
    )
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800/80 text-[11px] uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3 text-left font-medium">Time</th>
              <th className="px-4 py-3 text-left font-medium">Action</th>
              <th className="px-4 py-3 text-left font-medium">Position</th>
              <th className="px-4 py-3 text-left font-medium">Direction</th>
              <th className="px-4 py-3 text-right font-medium">Cost A</th>
              <th className="px-4 py-3 text-right font-medium">Cost B</th>
              <th className="px-4 py-3 text-right font-medium">Total Cost</th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/40">
            {filtered.map((pos) => {
              const isExpanded = expandedId === pos.positionId
              return (
                <TradeRow
                  key={pos.positionId}
                  pos={pos}
                  isExpanded={isExpanded}
                  onToggle={() =>
                    setExpandedId(isExpanded ? null : pos.positionId)
                  }
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TradeRow({
  pos,
  isExpanded,
  onToggle,
}: {
  pos: Position
  isExpanded: boolean
  onToggle: () => void
}) {
  const totalCost = (BigInt(pos.costA) + BigInt(pos.costB)).toString()
  const { relative, full } = formatRelativeTime(pos.openedAt)

  return (
    <>
      <tr
        className="transition-colors hover:bg-gray-800/30 cursor-pointer group"
        onClick={onToggle}
      >
        {/* Timeline indicator + time */}
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <span
                className={`
                  inline-block w-2 h-2 rounded-full shrink-0
                  ${pos.closed ? 'bg-emerald-400' : 'bg-blue-400'}
                `}
              />
            </div>
            <span className="text-xs text-gray-400 tabular-nums" title={full}>
              {relative}
            </span>
          </div>
        </td>
        <td className="px-4 py-3.5">
          <span
            className={`
              inline-block px-2 py-0.5 rounded text-[11px] font-medium border
              ${pos.closed
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }
            `}
          >
            {pos.closed ? 'Close' : 'Open'}
          </span>
        </td>
        <td className="px-4 py-3.5 font-mono text-xs text-gray-400">
          #{pos.positionId}
        </td>
        <td className="px-4 py-3.5">
          <span className="text-xs text-gray-400">
            {pos.boughtYesOnA ? 'YES on A / NO on B' : 'NO on A / YES on B'}
          </span>
        </td>
        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
          {formatValue(pos.costA, 6)}
        </td>
        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
          {formatValue(pos.costB, 6)}
        </td>
        <td className="px-4 py-3.5 text-right font-mono tabular-nums font-medium">
          {formatValue(totalCost, 6)}
        </td>
        <td className="px-4 py-3.5 text-right">
          <svg
            className={`w-4 h-4 text-gray-600 transition-transform duration-200 group-hover:text-gray-400 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="bg-gray-800/10">
            <div className="px-5 py-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4 text-xs">
                <div>
                  <div className="text-[11px] text-gray-600 uppercase tracking-wide mb-1">Market A</div>
                  <div className="font-mono text-gray-400">{truncateAddress(pos.marketIdA)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-600 uppercase tracking-wide mb-1">Market B</div>
                  <div className="font-mono text-gray-400">{truncateAddress(pos.marketIdB)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-600 uppercase tracking-wide mb-1">Opened At</div>
                  <div className="text-gray-400">{full}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-600 uppercase tracking-wide mb-1">Shares A</div>
                  <div className="font-mono text-gray-300 tabular-nums">{formatValue(pos.sharesA, 6)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-600 uppercase tracking-wide mb-1">Shares B</div>
                  <div className="font-mono text-gray-300 tabular-nums">{formatValue(pos.sharesB, 6)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-600 uppercase tracking-wide mb-1">Explorer</div>
                  <a
                    href={`https://bscscan.com/address/${pos.marketIdA.slice(0, 42)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-800/60 border border-gray-700/40 text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/30 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    BscScan
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
