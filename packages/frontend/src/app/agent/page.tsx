'use client'

import { useState, useEffect } from 'react'
import {
  useAgentStatus,
  useStartAgent,
  useStopAgent,
  useUpdateConfig,
} from '@/hooks/use-agent-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { formatUptime } from '@/lib/format'

function SkeletonAgent() {
  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
        <div className="skeleton h-5 w-32 mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton h-3 w-16 mb-2" />
              <div className="skeleton h-6 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
        <div className="skeleton h-5 w-28 mb-6" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton h-3 w-24 mb-2" />
              <div className="skeleton h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800/30 rounded-lg p-4">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">{label}</div>
      <div>{children}</div>
    </div>
  )
}

export default function AgentPage() {
  const { data: status, isLoading, error } = useAgentStatus()
  const startAgent = useStartAgent()
  const stopAgent = useStopAgent()
  const updateConfig = useUpdateConfig()

  const [minSpreadBps, setMinSpreadBps] = useState('')
  const [maxPositionSize, setMaxPositionSize] = useState('')
  const [scanIntervalMs, setScanIntervalMs] = useState('')

  useEffect(() => {
    if (status?.config) {
      setMinSpreadBps(String(status.config.minSpreadBps))
      setMaxPositionSize(status.config.maxPositionSize)
      setScanIntervalMs(String(status.config.scanIntervalMs))
    }
  }, [status?.config])

  const handleToggle = () => {
    if (status?.running) {
      stopAgent.mutate()
    } else {
      startAgent.mutate()
    }
  }

  const handleSaveConfig = () => {
    const spread = Number(minSpreadBps)
    const interval = Number(scanIntervalMs)
    if (isNaN(spread) || spread < 1 || spread > 10000) {
      alert('Min Spread must be between 1 and 10000 bps')
      return
    }
    if (!maxPositionSize || isNaN(Number(maxPositionSize)) || Number(maxPositionSize) <= 0) {
      alert('Max Position Size must be greater than 0')
      return
    }
    if (isNaN(interval) || interval < 1000) {
      alert('Scan Interval must be at least 1000ms')
      return
    }
    updateConfig.mutate({
      minSpreadBps: spread,
      maxPositionSize,
      scanIntervalMs: interval,
    })
  }

  const isToggling = startAgent.isPending || stopAgent.isPending

  return (
    <ErrorBoundary>
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Agent Control</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor and configure the arbitrage agent</p>
        </div>

        {isLoading && <SkeletonAgent />}

        {error && (
          <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl p-5">
            <div className="font-medium mb-1">Failed to connect to agent</div>
            <div className="text-sm text-red-400/70">{(error as Error).message}</div>
          </div>
        )}

        {status && (
          <div className="space-y-6">
            {/* Main Control */}
            <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                {/* Toggle Button */}
                <button
                  onClick={handleToggle}
                  disabled={isToggling}
                  className={`
                    relative flex items-center gap-3 px-8 py-4 rounded-xl font-medium text-sm transition-all duration-200
                    disabled:opacity-60 disabled:cursor-not-allowed
                    ${status.running
                      ? 'bg-red-500/10 border-2 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:border-red-500/50'
                      : 'bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50'
                    }
                  `}
                >
                  <span
                    className={`
                      inline-block w-3 h-3 rounded-full shrink-0
                      ${status.running ? 'bg-red-400' : 'bg-emerald-400'}
                      ${status.running ? 'status-pulse' : ''}
                    `}
                  />
                  {isToggling
                    ? 'Processing...'
                    : status.running
                      ? 'Stop Agent'
                      : 'Start Agent'
                  }
                </button>

                {/* Status Text */}
                <div className="flex items-center gap-2.5">
                  <span
                    className={`
                      inline-block w-2.5 h-2.5 rounded-full
                      ${status.running ? 'bg-emerald-400 status-pulse' : 'bg-gray-600'}
                    `}
                  />
                  <span className={`font-medium ${status.running ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {status.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Status">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      status.running ? 'bg-emerald-400' : 'bg-gray-600'
                    }`}
                  />
                  <span className="font-medium text-sm">
                    {status.running ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </StatCard>
              <StatCard label="Uptime">
                <div className="font-mono text-lg font-bold tabular-nums">
                  {formatUptime(status.uptime)}
                </div>
              </StatCard>
              <StatCard label="Trades Executed">
                <div className="font-mono text-lg font-bold tabular-nums text-emerald-400">
                  {status.tradesExecuted}
                </div>
              </StatCard>
              <StatCard label="Last Scan">
                <div className="font-mono text-sm tabular-nums">
                  {status.lastScan
                    ? new Date(status.lastScan).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : 'Never'}
                </div>
              </StatCard>
            </div>

            {/* Configuration */}
            <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
              <h2 className="text-base font-semibold mb-5">Configuration</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                    Min Spread
                    <span className="text-gray-600 ml-1 normal-case tracking-normal">(bps)</span>
                  </label>
                  <input
                    type="number"
                    value={minSpreadBps}
                    onChange={(e) => setMinSpreadBps(e.target.value)}
                    min={1}
                    max={10000}
                    className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                    Max Position Size
                    <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
                  </label>
                  <input
                    type="text"
                    value={maxPositionSize}
                    onChange={(e) => setMaxPositionSize(e.target.value)}
                    pattern="[0-9]*"
                    className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                    Scan Interval
                    <span className="text-gray-600 ml-1 normal-case tracking-normal">(ms)</span>
                  </label>
                  <input
                    type="number"
                    value={scanIntervalMs}
                    onChange={(e) => setScanIntervalMs(e.target.value)}
                    min={1000}
                    className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                  />
                </div>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={handleSaveConfig}
                  disabled={updateConfig.isPending}
                  className="px-5 py-2.5 bg-gray-700/60 hover:bg-gray-600/60 border border-gray-600/40 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
                >
                  {updateConfig.isPending ? 'Saving...' : 'Save Configuration'}
                </button>
                {updateConfig.isSuccess && (
                  <span className="text-xs text-emerald-400">Saved</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
