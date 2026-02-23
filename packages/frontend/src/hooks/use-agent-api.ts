'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`/api/agent/${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/agent/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export interface AgentStatus {
  running: boolean
  lastScan: number
  tradesExecuted: number
  uptime: number
  config: AgentConfig
}

export interface AgentConfig {
  minSpreadBps: number
  maxPositionSize: string
  scanIntervalMs: number
}

export interface Opportunity {
  marketId: string
  protocolA: string
  protocolB: string
  yesPriceA: string
  noPriceB: string
  totalCost: string
  spreadBps: number
  estProfit: string
  buyYesOnA: boolean
  guaranteedPayout: string
}

export interface Position {
  positionId: number
  marketIdA: string
  marketIdB: string
  boughtYesOnA: boolean
  sharesA: string
  sharesB: string
  costA: string
  costB: string
  openedAt: number
  closed: boolean
}

export function useAgentStatus() {
  return useQuery<AgentStatus>({
    queryKey: ['agent-status'],
    queryFn: () => fetchJSON('status'),
    refetchInterval: 2000,
  })
}

export function useOpportunities() {
  return useQuery<Opportunity[]>({
    queryKey: ['opportunities'],
    queryFn: () => fetchJSON('opportunities'),
    refetchInterval: 3000,
  })
}

export function usePositions() {
  return useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: () => fetchJSON('positions'),
    refetchInterval: 5000,
  })
}

export function useStartAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJSON('agent/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-status'] }),
  })
}

export function useStopAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJSON('agent/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-status'] }),
  })
}

export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<AgentConfig>) => postJSON('config', config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-status'] }),
  })
}
