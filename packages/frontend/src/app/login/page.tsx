'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { useProfile } from '@/hooks/use-platform-api'

export default function LoginPage() {
  const router = useRouter()
  const { login, isAuthenticated, isReady } = useAuth()
  const { data: profile, isLoading: isProfileLoading } = useProfile()

  const [error, setError] = useState<string | null>(null)

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (isReady && isAuthenticated && profile && !isProfileLoading) {
      router.replace(profile.config ? '/dashboard' : '/onboarding')
    }
  }, [isReady, isAuthenticated, profile, isProfileLoading, router])

  const handleSignIn = () => {
    setError(null)
    try {
      login()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      setError(message)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        {/* Central gold glow */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 50% 40% at 50% 35%, rgba(0,212,255,0.06) 0%, transparent 70%)',
          }}
        />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,212,255,0.15) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,212,255,0.15) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px',
          }}
        />
        {/* Vignette */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 30%, rgba(0,0,0,0.4) 100%)',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm px-6">
        {/* Branding */}
        <div className="text-center mb-12 animate-in" style={{ '--stagger': 0 } as React.CSSProperties}>
          <h1
            className="text-[42px] font-bold uppercase mb-3 text-white"
            style={{
              textShadow: '0 0 30px rgba(0, 212, 255, 0.25)',
              letterSpacing: '0.02em',
            }}
          >
            PROPHET
          </h1>
          <p className="text-[11px] text-[#3D4350] uppercase tracking-[0.3em] font-semibold">
            Prediction Market Arbitrage
          </p>
        </div>

        {/* Card */}
        <div className="rounded border border-[#1C2030] bg-[#111318] p-8 animate-in" style={{ '--stagger': 1 } as React.CSSProperties}>
          <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] mb-5 font-semibold">
            Sign In
          </div>

          <button
            onClick={handleSignIn}
            disabled={isReady && isAuthenticated && isProfileLoading}
            className="
              w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl text-sm font-semibold
              btn-accent
              disabled:opacity-60 disabled:cursor-not-allowed
            "
          >
            {isReady && isAuthenticated && isProfileLoading ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-[#006680] border-t-[#00D4FF] rounded-full spin-slow" />
                Loading...
              </>
            ) : (
              'Sign In'
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="mt-4 text-red-400 bg-red-950/30 border border-red-900/50 rounded p-4 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Tagline */}
        <p className="text-center text-[11px] text-[#3D4350] mt-8 animate-in font-medium" style={{ '--stagger': 2, letterSpacing: '0.25em' } as React.CSSProperties}>
          Automated prediction market arbitrage
        </p>
      </div>
    </div>
  )
}
