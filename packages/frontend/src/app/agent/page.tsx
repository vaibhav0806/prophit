'use client'

import { useState, useEffect } from 'react'
import {
  useAgentStatus,
  useStartAgent,
  useStopAgent,
  useUpdateConfig,
} from '@/hooks/use-agent-api'

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h ${m}m ${s}s`
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Agent Control</h1>

      {isLoading && (
        <div className="text-gray-400 animate-pulse">Loading agent status...</div>
      )}

      {error && (
        <div className="text-red-400 bg-red-950/50 border border-red-900 rounded-lg p-4 mb-6">
          Failed to connect to agent: {(error as Error).message}
        </div>
      )}

      {status && (
        <div className="space-y-6">
          {/* Status Section */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Status</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-gray-500 mb-1">State</div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      status.running ? 'bg-emerald-400' : 'bg-red-400'
                    }`}
                  />
                  <span className="font-medium">
                    {status.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">Last Scan</div>
                <div className="font-mono text-sm">
                  {status.lastScan
                    ? new Date(status.lastScan).toLocaleTimeString()
                    : 'Never'}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">Trades Executed</div>
                <div className="font-mono text-lg font-bold">{status.tradesExecuted}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">Uptime</div>
                <div className="font-mono text-sm">{formatUptime(status.uptime)}</div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-800">
              <button
                onClick={handleToggle}
                disabled={startAgent.isPending || stopAgent.isPending}
                className={`px-6 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
                  status.running
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {startAgent.isPending || stopAgent.isPending
                  ? 'Processing...'
                  : status.running
                    ? 'Stop Agent'
                    : 'Start Agent'}
              </button>
            </div>
          </div>

          {/* Config Section */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Configuration</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Min Spread (bps)
                </label>
                <input
                  type="number"
                  value={minSpreadBps}
                  onChange={(e) => setMinSpreadBps(e.target.value)}
                  min={1}
                  max={10000}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Max Position Size (USDT)
                </label>
                <input
                  type="text"
                  value={maxPositionSize}
                  onChange={(e) => setMaxPositionSize(e.target.value)}
                  pattern="[0-9]*"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Scan Interval (ms)
                </label>
                <input
                  type="number"
                  value={scanIntervalMs}
                  onChange={(e) => setScanIntervalMs(e.target.value)}
                  min={1000}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
            <div className="mt-4">
              <button
                onClick={handleSaveConfig}
                disabled={updateConfig.isPending}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
              >
                {updateConfig.isPending ? 'Saving...' : 'Save Config'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
