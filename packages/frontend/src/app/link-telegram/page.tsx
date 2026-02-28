'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'

const API_BASE = process.env.NEXT_PUBLIC_PLATFORM_URL || 'http://localhost:4000'

type LinkState = 'no-chat-id' | 'needs-login' | 'linking' | 'success' | 'error'

export default function LinkTelegramPage() {
  return (
    <Suspense>
      <LinkTelegramPageInner />
    </Suspense>
  )
}

function LinkTelegramPageInner() {
  const searchParams = useSearchParams()
  const chatId = searchParams.get('chatId')
  const { login, isAuthenticated, isReady, getAccessToken } = useAuth()
  const [state, setState] = useState<LinkState>('linking')
  const [errorMsg, setErrorMsg] = useState('')
  const linkedRef = useRef(false)

  useEffect(() => {
    if (!chatId) {
      setState('no-chat-id')
      return
    }
    if (!isReady) return
    if (!isAuthenticated) {
      setState('needs-login')
      return
    }

    // Auto-link once authenticated
    if (linkedRef.current) return
    linkedRef.current = true
    setState('linking')

    ;(async () => {
      try {
        const token = await getAccessToken()
        const res = await fetch(`${API_BASE}/api/me/telegram/link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ chatId }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(body.error || `Failed: ${res.status}`)
        }

        setState('success')
      } catch (err) {
        setState('error')
        setErrorMsg(err instanceof Error ? err.message : 'Failed to link Telegram')
        linkedRef.current = false
      }
    })()
  }, [chatId, isReady, isAuthenticated, getAccessToken])

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 50% 40% at 50% 35%, rgba(0,212,255,0.06) 0%, transparent 70%)',
          }}
        />
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
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm px-6">
        <div className="text-center mb-12">
          <h1
            className="text-[42px] font-bold uppercase mb-3 text-white"
            style={{ textShadow: '0 0 30px rgba(0, 212, 255, 0.25)', letterSpacing: '0.02em' }}
          >
            PROPHET
          </h1>
          <p className="text-[11px] text-[#3D4350] uppercase tracking-[0.3em] font-semibold">
            Link Telegram
          </p>
        </div>

        <div className="rounded border border-[#1C2030] bg-[#111318] p-8">
          {state === 'no-chat-id' && (
            <div className="text-center">
              <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] mb-4 font-semibold">
                Invalid Link
              </div>
              <p className="text-sm text-[#6B7280]">
                This link is missing the required parameters. Please use the link from the Telegram bot.
              </p>
            </div>
          )}

          {state === 'needs-login' && (
            <div className="text-center">
              <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] mb-5 font-semibold">
                Sign In to Link
              </div>
              <p className="text-sm text-[#6B7280] mb-6">
                Sign in with your Prophet account to link your Telegram.
              </p>
              <button
                onClick={() => login()}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl text-sm font-semibold btn-accent"
              >
                Sign In
              </button>
            </div>
          )}

          {state === 'linking' && (
            <div className="text-center">
              <div className="text-[11px] text-[#3D4350] uppercase tracking-[0.15em] mb-4 font-semibold">
                Linking
              </div>
              <div className="flex items-center justify-center gap-3 text-sm text-[#6B7280]">
                <span className="inline-block w-4 h-4 border-2 border-[#006680] border-t-[#00D4FF] rounded-full spin-slow" />
                Linking your Telegram account...
              </div>
            </div>
          )}

          {state === 'success' && (
            <div className="text-center">
              <div className="text-[11px] text-[#00D4FF] uppercase tracking-[0.15em] mb-4 font-semibold">
                Linked
              </div>
              <p className="text-sm text-[#E0E2E9] mb-2">
                Telegram linked successfully!
              </p>
              <p className="text-sm text-[#6B7280]">
                You can close this page and go back to the bot.
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="text-center">
              <div className="text-[11px] text-red-400 uppercase tracking-[0.15em] mb-4 font-semibold">
                Error
              </div>
              <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded p-4 text-sm">
                {errorMsg}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
