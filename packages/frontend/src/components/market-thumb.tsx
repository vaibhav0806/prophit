'use client'

import { useState } from 'react'

const GRADIENTS = [
  'from-blue-600/40 to-cyan-600/20',
  'from-emerald-600/40 to-teal-600/20',
  'from-violet-600/40 to-purple-600/20',
  'from-amber-600/40 to-orange-600/20',
  'from-rose-600/40 to-pink-600/20',
  'from-indigo-600/40 to-blue-600/20',
  'from-teal-600/40 to-emerald-600/20',
  'from-fuchsia-600/40 to-violet-600/20',
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function MarketThumb({ src, title, size = 40 }: { src?: string | null; title?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const letter = (title ?? '?')[0].toUpperCase()
  const grad = GRADIENTS[hashStr(title ?? '') % GRADIENTS.length]

  if (src && !failed) {
    return (
      <div
        className="shrink-0 rounded-lg overflow-hidden bg-[#191C24] ring-1 ring-white/[0.04]"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={`shrink-0 rounded-lg bg-gradient-to-br ${grad} ring-1 ring-white/[0.04] flex items-center justify-center`}
      style={{ width: size, height: size }}
    >
      <span className="text-sm font-semibold text-white/50" style={{ fontSize: size * 0.35 }}>{letter}</span>
    </div>
  )
}
