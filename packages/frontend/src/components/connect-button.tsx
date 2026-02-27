'use client'

import { useAuth } from '@/hooks/use-auth'

export function ConnectButton() {
  const { address, isAuthenticated, login, logout } = useAuth()

  if (isAuthenticated && address) {
    return (
      <div className="flex items-center gap-2 bg-gray-900/80 border border-gray-800 rounded-lg px-3 py-2">
        <span className="inline-block w-2 h-2 rounded-full bg-[#00D4FF] shrink-0" />
        <span className="text-xs font-mono text-gray-300 truncate">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button
          onClick={() => logout()}
          className="ml-auto text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors shrink-0"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => login()}
      className="w-full text-xs px-3 py-2.5 rounded-lg btn-accent font-medium"
    >
      Connect Wallet
    </button>
  )
}
