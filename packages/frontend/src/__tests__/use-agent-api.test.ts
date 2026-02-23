import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Stub env vars before importing the module
vi.stubEnv('NEXT_PUBLIC_AGENT_URL', 'http://test-agent:3001')
vi.stubEnv('NEXT_PUBLIC_AGENT_API_KEY', 'test-key')

// Must import after env stubs
const { useAgentStatus, useStartAgent, useStopAgent } = await import(
  '@/hooks/use-agent-api'
)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    )
  }
}

const mockStatus = {
  running: true,
  lastScan: '2024-01-01T00:00:00Z',
  tradesExecuted: 5,
  uptime: 60000,
  config: {
    minSpreadBps: 100,
    maxPositionSize: '1000000',
    scanIntervalMs: 5000,
  },
}

describe('useAgentStatus', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockStatus), { status: 200 }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the correct URL and returns data', async () => {
    const { result } = renderHook(() => useAgentStatus(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-agent:3001/api/status',
    )
    expect(result.current.data).toEqual(mockStatus)
  })

  it('handles fetch errors', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    )

    const { result } = renderHook(() => useAgentStatus(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toContain('500')
  })
})

describe('useStartAgent', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST to /api/agent/start with auth header', async () => {
    const { result } = renderHook(() => useStartAgent(), {
      wrapper: createWrapper(),
    })

    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-agent:3001/api/agent/start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })
})

describe('useStopAgent', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST to /api/agent/stop with auth header', async () => {
    const { result } = renderHook(() => useStopAgent(), {
      wrapper: createWrapper(),
    })

    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-agent:3001/api/agent/stop',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('handles mutation errors', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403, statusText: 'Forbidden' }),
    )

    const { result } = renderHook(() => useStopAgent(), {
      wrapper: createWrapper(),
    })

    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect((result.current.error as Error).message).toContain('403')
  })
})
