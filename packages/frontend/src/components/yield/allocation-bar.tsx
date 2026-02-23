'use client'

import { formatNumber } from '@/lib/format'

interface AllocationSegment {
  protocol: string
  amount: number
  color: string
}

const PROTOCOL_COLOR_LIST = [
  { bg: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { bg: 'bg-blue-500', dot: 'bg-blue-500' },
  { bg: 'bg-amber-500', dot: 'bg-amber-500' },
  { bg: 'bg-purple-500', dot: 'bg-purple-500' },
  { bg: 'bg-rose-500', dot: 'bg-rose-500' },
  { bg: 'bg-cyan-500', dot: 'bg-cyan-500' },
]

function getColor(index: number) {
  return PROTOCOL_COLOR_LIST[index % PROTOCOL_COLOR_LIST.length]
}

interface AllocationBarProps {
  segments: AllocationSegment[]
  total: number
}

export function AllocationBar({ segments, total }: AllocationBarProps) {
  if (total === 0 || segments.length === 0) {
    return (
      <div className="w-full h-3 rounded-full bg-gray-800/60" />
    )
  }

  return (
    <div>
      {/* Bar */}
      <div className="w-full h-3 rounded-full overflow-hidden flex bg-gray-800/40">
        {segments.map((seg, i) => {
          const pct = (seg.amount / total) * 100
          if (pct <= 0) return null
          const color = getColor(i)
          return (
            <div
              key={seg.protocol}
              className={`${color.bg} h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full`}
              style={{ width: `${pct}%` }}
              title={`${seg.protocol}: ${formatNumber(seg.amount, 2)} USDT (${pct.toFixed(1)}%)`}
            />
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4">
        {segments.map((seg, i) => {
          const pct = total > 0 ? (seg.amount / total) * 100 : 0
          const color = getColor(i)
          return (
            <div key={seg.protocol} className="flex items-center gap-2 text-xs">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${color.dot}`} />
              <span className="text-gray-400">{seg.protocol}</span>
              <span className="font-mono tabular-nums text-gray-500">
                {formatNumber(seg.amount, 2)} USDT
              </span>
              <span className="text-gray-600">({pct.toFixed(1)}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
