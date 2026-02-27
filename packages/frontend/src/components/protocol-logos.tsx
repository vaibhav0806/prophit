/** Protocol logo + route components for inline use in data tables. */

import Image from 'next/image'

const PROTOCOLS: Record<string, { color: string; logo: string; label: string }> = {
  predict:  { color: '#60A5FA', logo: '/logos/predict.png',  label: 'Predict' },
  probable: { color: '#34D399', logo: '/logos/probable.png', label: 'Probable' },
  opinion:  { color: '#C084FC', logo: '/logos/opinion.png',  label: 'Opinion' },
}

function getProto(name: string) {
  const key = name.toLowerCase().replace(/\.fun$/, '')
  return PROTOCOLS[key] ?? null
}

/** Single protocol logo — 16x16 default, shows tooltip on hover. */
export function ProtocolLogo({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const proto = getProto(name)
  if (!proto) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-[#191C24] text-[8px] font-mono text-[#6B7280] ${className ?? ''}`}
        style={{ width: size, height: size }}
        title={name}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full shrink-0 ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: `${proto.color}10`,
        boxShadow: `0 0 0 1px ${proto.color}20`,
      }}
      title={proto.label}
    >
      <Image
        src={proto.logo}
        alt={proto.label}
        width={size - 4}
        height={size - 4}
        className="rounded-full"
        unoptimized
      />
    </span>
  )
}

/** Two protocol logos with a thin arrow between them — for route display in tables. */
export function ProtocolRoute({ from, to, size = 16 }: { from: string; to: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <ProtocolLogo name={from} size={size} />
      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="text-[#3D4350] shrink-0">
        <path d="M6 1l3 3-3 3M0 4h8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <ProtocolLogo name={to} size={size} />
    </span>
  )
}
