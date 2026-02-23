'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:3001'
const API_KEY = process.env.NEXT_PUBLIC_AGENT_API_KEY || ''

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`
  }
  const res = await fetch(`${AGENT_URL}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export interface AgentStatus {
  running: boolean
  lastScan: string | null
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
}

export interface Position {
  id: number
  marketIdA: string
  marketIdB: string
  boughtYesOnA: boolean
  sharesA: string
  sharesB: string
  costA: string
  costB: string
  totalCost: string
  openedAt: number
  closed: boolean
}

export function useAgentStatus() {
  return useQuery<AgentStatus>({
    queryKey: ['agent-status'],
    queryFn: () => fetchJSON('/api/status'),
    refetchInterval: 2000,
  })
}

export function useOpportunities() {
  return useQuery<Opportunity[]>({
    queryKey: ['opportunities'],
    queryFn: () => fetchJSON('/api/opportunities'),
    refetchInterval: 3000,
  })
}

export function usePositions() {
  return useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: () => fetchJSON('/api/positions'),
    refetchInterval: 5000,
  })
}

export function useStartAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJSON('/api/agent/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-status'] }),
  })
}

export function useStopAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJSON('/api/agent/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-status'] }),
  })
}

export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<AgentConfig>) => postJSON('/api/config', config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-status'] }),
  })
}
