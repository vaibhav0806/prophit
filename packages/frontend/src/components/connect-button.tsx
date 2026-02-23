'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2 bg-gray-900/80 border border-gray-800 rounded-lg px-3 py-2">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
        <span className="text-xs font-mono text-gray-300 truncate">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="ml-auto text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors shrink-0"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => connect({ connector: injected() })}
      className="w-full text-xs px-3 py-2.5 rounded-lg bg-emerald-600/90 text-white hover:bg-emerald-500 transition-colors font-medium"
    >
      Connect Wallet
    </button>
  )
}
