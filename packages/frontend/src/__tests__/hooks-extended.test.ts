import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const { useOpportunities, usePositions, useUpdateConfig } = await import(
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

// ---------------------------------------------------------------------------
// useOpportunities
// ---------------------------------------------------------------------------

describe('useOpportunities', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches opportunities from proxy', async () => {
    const mockOpps = [
      {
        marketId: '0x01',
        protocolA: 'Probable',
        protocolB: 'Predict',
        yesPriceA: '400000000000000000',
        noPriceB: '300000000000000000',
        totalCost: '700000000000000000',
        spreadBps: 3000,
        estProfit: '30000000',
        buyYesOnA: true,
        guaranteedPayout: '1000000000000000000',
      },
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockOpps), { status: 200 }),
    )

    const { result } = renderHook(() => useOpportunities(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/agent/opportunities')
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].spreadBps).toBe(3000)
  })

  it('handles error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Server Error' }),
    )

    const { result } = renderHook(() => useOpportunities(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toContain('500')
  })
})

// ---------------------------------------------------------------------------
// usePositions
// ---------------------------------------------------------------------------

describe('usePositions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches positions from proxy', async () => {
    const mockPositions = [
      {
        positionId: 0,
        marketIdA: '0x01',
        marketIdB: '0x01',
        boughtYesOnA: true,
        sharesA: '1000000000000000000',
        sharesB: '1000000000000000000',
        costA: '500000',
        costB: '500000',
        openedAt: 1700000000,
        closed: false,
      },
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockPositions), { status: 200 }),
    )

    const { result } = renderHook(() => usePositions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/agent/positions')
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].positionId).toBe(0)
    expect(result.current.data![0].closed).toBe(false)
  })

  it('returns empty array when no positions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    )

    const { result } = renderHook(() => usePositions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// useUpdateConfig
// ---------------------------------------------------------------------------

describe('useUpdateConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST with config body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    const { result } = renderHook(() => useUpdateConfig(), {
      wrapper: createWrapper(),
    })

    result.current.mutate({ minSpreadBps: 200 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/agent/config',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ minSpreadBps: 200 }),
      }),
    )
  })

  it('handles update failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid config' }), { status: 400, statusText: 'Bad Request' }),
    )

    const { result } = renderHook(() => useUpdateConfig(), {
      wrapper: createWrapper(),
    })

    result.current.mutate({ minSpreadBps: -1 })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toContain('400')
  })
})
