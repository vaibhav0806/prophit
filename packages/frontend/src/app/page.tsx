'use client'

import Link from 'next/link'
import { useAuth } from '@/hooks/use-auth'

/* ─── Inline SVG icons ────────────────────────────────────────────── */

function ArrowRight({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.2 4.4L2.4 10.8c-.6.2-.6 1.1.1 1.3l4.8 1.5 1.8 5.8c.1.4.6.6.9.3l2.6-2.1 5.1 3.7c.5.3 1.1 0 1.2-.5L21.2 4.4z" />
      <path d="M9.3 13.6l7.4-5.4" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  )
}

function CliIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 10l3 2-3 2" />
      <path d="M12 14h4" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function ChainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" />
      <path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" />
    </svg>
  )
}

/* ─── Page ────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const { isAuthenticated, isReady } = useAuth()
  const authed = isReady && isAuthenticated

  const ctaHref = authed ? '/dashboard' : '/login'
  const ctaLabel = authed ? 'Open Dashboard' : 'Launch App'

  return (
    <div className="min-h-screen relative">

      {/* ── Background atmosphere ───────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden>
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(0,212,255,0.04) 0%, transparent 70%)',
        }} />
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: `linear-gradient(rgba(0,212,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.2) 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
        }} />
      </div>

      {/* ── Navbar ──────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-[#1C2030]/60 backdrop-blur-xl" style={{ background: 'rgba(11,13,17,0.8)' }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="text-[24px] font-bold text-white"
              style={{ fontFamily: 'var(--font-serif), Georgia, serif', textShadow: '0 0 20px rgba(0,212,255,0.12)' }}
            >
              Prophet
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="text-xs uppercase tracking-[0.2em] text-[#6B7280] hover:text-[#E0E2E9] transition-colors font-medium">
              How It Works
            </a>
            <a href="#platforms" className="text-xs uppercase tracking-[0.2em] text-[#6B7280] hover:text-[#E0E2E9] transition-colors font-medium">
              Platforms
            </a>
            <a href="#access" className="text-xs uppercase tracking-[0.2em] text-[#6B7280] hover:text-[#E0E2E9] transition-colors font-medium">
              Access
            </a>
          </div>

          <Link
            href={ctaHref}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold btn-accent"
          >
            {ctaLabel}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-32 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-3xl">
            {/* Eyebrow */}
            <div
              className="flex items-center gap-2.5 mb-8 animate-in"
              style={{ '--stagger': 0 } as React.CSSProperties}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] pulse-dot" />
              <span className="text-xs uppercase tracking-[0.3em] text-[#6B7280] font-semibold font-mono">
                Autonomous Arbitrage on BNB Chain
              </span>
            </div>

            {/* Headline */}
            <h1
              className="text-[clamp(40px,6vw,80px)] leading-[0.95] font-bold text-white mb-8 animate-in"
              style={{
                fontFamily: 'var(--font-serif), Georgia, serif',
                '--stagger': 1,
              } as React.CSSProperties}
            >
              Prediction markets are mispriced.
              <br />
              <span style={{ color: '#00D4FF', textShadow: '0 0 40px rgba(0,212,255,0.3)' }}>
                We fix that.
              </span>
            </h1>

            {/* Subtext */}
            <p
              className="text-lg text-[#6B7280] max-w-xl leading-relaxed mb-12 animate-in"
              style={{ '--stagger': 2 } as React.CSSProperties}
            >
              Prophet finds price discrepancies across prediction market CLOBs
              and executes delta-neutral trades for risk-free profit.
            </p>

            {/* CTA */}
            <div className="flex items-center gap-6 animate-in" style={{ '--stagger': 3 } as React.CSSProperties}>
              <Link
                href={ctaHref}
                className="flex items-center gap-2.5 px-7 py-3.5 rounded-xl text-sm font-semibold btn-accent"
              >
                {ctaLabel}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="https://github.com/vaibhav0806/prophet"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#E0E2E9] transition-colors font-medium"
              >
                <GithubIcon />
                View Source
              </a>
            </div>
          </div>

          {/* Arbitrage demo box — right side */}
          <div
            className="mt-16 lg:mt-0 lg:absolute lg:right-6 lg:top-1/2 lg:-translate-y-1/2 w-full max-w-md animate-in"
            style={{ '--stagger': 4 } as React.CSSProperties}
          >
            <div className="relative rounded-xl border border-[#1C2030] bg-[#111318]/80 backdrop-blur-sm overflow-hidden">
              {/* Scan sweep line */}
              <div className="absolute top-0 left-0 w-full h-px overflow-hidden">
                <div className="h-full w-1/5 bg-gradient-to-r from-transparent via-[#00D4FF]/40 to-transparent" style={{ animation: 'scan-sweep 4s linear infinite' }} />
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-[#6B7280] font-mono font-semibold">Live Example</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] pulse-dot" />
                    <span className="text-[10px] text-[#22C55E] font-mono uppercase tracking-wider">Scanning</span>
                  </span>
                </div>

                <p className="text-sm text-[#E0E2E9]/70 mb-4 font-medium">
                  &ldquo;Will Portugal win FIFA World Cup?&rdquo;
                </p>

                <div className="space-y-2 font-mono text-sm tabular-nums">
                  <div className="flex justify-between items-center py-1.5 px-3 rounded-lg bg-white/[0.02]">
                    <span className="text-[#6B7280]">Predict.fun</span>
                    <span className="text-[#E0E2E9]">YES @ <span className="text-white font-semibold">$0.068</span></span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 px-3 rounded-lg bg-white/[0.02]">
                    <span className="text-[#6B7280]">Probable</span>
                    <span className="text-[#E0E2E9]">NO @ <span className="text-white font-semibold">$0.899</span></span>
                  </div>

                  <div className="h-px bg-[#1C2030] my-3" />

                  <div className="flex justify-between items-center">
                    <span className="text-[#6B7280]">Total cost</span>
                    <span className="text-white font-semibold">$0.967</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#6B7280]">Payout</span>
                    <span className="text-white font-semibold">$1.000</span>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-[#6B7280]">Profit</span>
                    <span className="text-[#00D4FF] font-bold" style={{ textShadow: '0 0 12px rgba(0,212,255,0.3)' }}>
                      +$0.033 <span className="text-xs text-[#00D4FF]/60">(3.4%)</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Divider ─────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-[#1C2030] to-transparent" />
      </div>

      {/* ── How It Works ────────────────────────────────────────── */}
      <section id="how-it-works" className="py-32 px-6 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-20">
            <div className="h-px flex-1 bg-gradient-to-r from-[#1C2030] to-transparent" />
            <h2
              className="text-xs uppercase tracking-[0.4em] text-[#6B7280] font-mono font-semibold"
            >
              How It Works
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-[#1C2030] to-transparent" />
          </div>

          <div className="grid md:grid-cols-2 gap-x-20 gap-y-20">
            {[
              {
                num: '01',
                title: 'Scan',
                desc: 'Agent monitors 2,500+ markets across 3 prediction market platforms every 5 seconds. Quotes are streamed into an in-memory store for instant comparison.',
              },
              {
                num: '02',
                title: 'Detect',
                desc: 'The matching engine identifies identical events priced differently. A 3-pass algorithm — conditionId, template extraction, composite similarity — eliminates false positives.',
              },
              {
                num: '03',
                title: 'Execute',
                desc: 'Sequential execution: unreliable leg first (thin orderbooks), reliable leg second (deep liquidity). If the first leg fails, total cost is $0. Move on.',
              },
              {
                num: '04',
                title: 'Profit',
                desc: 'Guaranteed return regardless of market outcome. Buy YES on one platform, NO on another — when combined cost is under $1.00, profit is locked in. Delta-neutral by construction.',
              },
            ].map((step) => (
              <div key={step.num} className="group">
                <div className="flex items-start gap-5">
                  <span
                    className="text-[48px] leading-none font-bold text-[#1C2030] group-hover:text-[#262D3D] transition-colors duration-500 select-none tabular-nums"
                    style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
                  >
                    {step.num}
                  </span>
                  <div className="pt-1">
                    <h3
                      className="text-2xl font-bold text-white mb-3"
                      style={{ fontFamily: 'var(--font-serif), Georgia, serif' }}
                    >
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-[#6B7280]">
                      {step.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Divider ─────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-[#1C2030] to-transparent" />
      </div>

      {/* ── Platforms ───────────────────────────────────────────── */}
      <section id="platforms" className="py-32 px-6 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-gradient-to-r from-[#1C2030] to-transparent" />
            <h2 className="text-xs uppercase tracking-[0.4em] text-[#6B7280] font-mono font-semibold">
              Platforms
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-[#1C2030] to-transparent" />
          </div>

          <p className="text-center text-sm text-[#4B5563] mb-16 font-mono">
            All three use Gnosis Conditional Token Framework — ERC-1155 outcome tokens on BSC
          </p>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              { name: 'Predict.fun', fees: '200 bps', auth: 'API Key + JWT', volume: 'Deepest liquidity' },
              { name: 'Probable', fees: '175 bps', auth: 'HMAC L2 + Safe', volume: 'Growing orderbooks' },
              { name: 'Opinion Labs', fees: '200 bps', auth: 'API Key', volume: 'Niche markets' },
            ].map((platform) => (
              <div
                key={platform.name}
                className="group rounded-xl border border-[#1C2030] bg-[#111318]/50 p-6 hover:border-[#262D3D] transition-all duration-300"
              >
                <div className="flex items-center gap-2.5 mb-5">
                  <ChainIcon />
                  <span className="text-xs uppercase tracking-[0.2em] text-[#4B5563] font-mono">CLOB · BSC</span>
                </div>

                <h3
                  className="text-xl font-bold text-white mb-1"
                  style={{ fontFamily: 'var(--font-serif), Georgia, serif' }}
                >
                  {platform.name}
                </h3>
                <p className="text-xs text-[#4B5563] mb-5">{platform.volume}</p>

                <div className="space-y-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#6B7280] font-mono text-xs uppercase tracking-wider">Fees</span>
                    <span className="text-[#E0E2E9] font-mono text-xs">{platform.fees}</span>
                  </div>
                  <div className="h-px bg-[#1C2030]" />
                  <div className="flex justify-between text-sm">
                    <span className="text-[#6B7280] font-mono text-xs uppercase tracking-wider">Auth</span>
                    <span className="text-[#E0E2E9] font-mono text-xs">{platform.auth}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Divider ─────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-[#1C2030] to-transparent" />
      </div>

      {/* ── Access Channels ─────────────────────────────────────── */}
      <section id="access" className="py-32 px-6 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-gradient-to-r from-[#1C2030] to-transparent" />
            <h2 className="text-xs uppercase tracking-[0.4em] text-[#6B7280] font-mono font-semibold">
              Access
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-[#1C2030] to-transparent" />
          </div>

          <p className="text-center text-sm text-[#4B5563] mb-16 font-mono">
            Control your agent from anywhere
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: <GlobeIcon />,
                label: 'Web',
                title: 'Dashboard',
                desc: 'Real-time monitoring, wallet management, trade history, and agent configuration.',
              },
              {
                icon: <TelegramIcon />,
                label: 'Telegram',
                title: 'Bot Interface',
                desc: 'Full command suite: /run, /stop, /balance, /opportunities, /positions, /config.',
              },
              {
                icon: <TerminalIcon />,
                label: 'MCP',
                title: 'Claude Integration',
                desc: 'Model Context Protocol server for Claude Desktop and Claude Code. Natural language control.',
              },
              {
                icon: <CliIcon />,
                label: 'CLI',
                title: 'Command Line',
                desc: 'Interactive terminal interface: status, start, stop, balance, opportunities, config.',
              },
            ].map((channel) => (
              <div
                key={channel.label}
                className="rounded-xl border border-[#1C2030] bg-[#111318]/50 p-6 hover:border-[#262D3D] transition-all duration-300"
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-lg border border-[#1C2030] bg-[#0B0D11] flex items-center justify-center text-[#6B7280]">
                    {channel.icon}
                  </div>
                  <span className="text-xs uppercase tracking-[0.25em] text-[#6B7280] font-mono font-semibold">
                    {channel.label}
                  </span>
                </div>

                <h3
                  className="text-lg font-bold text-white mb-2"
                  style={{ fontFamily: 'var(--font-serif), Georgia, serif' }}
                >
                  {channel.title}
                </h3>
                <p className="text-sm leading-relaxed text-[#6B7280]">
                  {channel.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-[#1C2030]/60 py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span
              className="text-lg font-bold text-[#4B5563]"
              style={{ fontFamily: 'var(--font-serif), Georgia, serif' }}
            >
              Prophet
            </span>
            <span className="text-xs text-[#4B5563] font-mono">
              Built on BNB Chain
            </span>
          </div>

          <div className="flex items-center gap-6">
            <a
              href="https://github.com/vaibhav0806/prophet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#4B5563] hover:text-[#6B7280] transition-colors"
              title="GitHub"
            >
              <GithubIcon />
            </a>
            <a
              href="https://t.me/pr0phet_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#4B5563] hover:text-[#6B7280] transition-colors"
              title="Telegram Bot"
            >
              <TelegramIcon />
            </a>
            <a
              href="https://github.com/vaibhav0806/prophet#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#4B5563] hover:text-[#6B7280] transition-colors"
              title="Documentation"
            >
              <DocIcon />
            </a>
            <span className="text-xs text-[#4B5563] font-mono">
              &copy; {new Date().getFullYear()}
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}
