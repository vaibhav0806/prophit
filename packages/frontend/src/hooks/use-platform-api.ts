"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = process.env.NEXT_PUBLIC_PLATFORM_URL || "http://localhost:4000";

// --- Token management (Privy access token) ---

let _authenticated = false;
let _accessTokenGetter: (() => Promise<string | null>) | null = null;

export function setAuthenticated(auth: boolean) {
  _authenticated = auth;
}

export function setAccessTokenGetter(fn: (() => Promise<string | null>) | null) {
  _accessTokenGetter = fn;
}

async function getToken(): Promise<string | null> {
  if (_accessTokenGetter) {
    return _accessTokenGetter();
  }
  return null;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

// --- User Profile ---
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<{
      id: string;
      walletAddress: string;
      createdAt: string;
      config: {
        minTradeSize: string;
        maxTradeSize: string;
        minSpreadBps: number;
        maxTotalTrades: number | null;
        tradingDurationMs: string | null;
        dailyLossLimit: string;
        maxResolutionDays: number | null;
        agentStatus: string;
      } | null;
    }>("/api/me"),
    enabled: _authenticated,
    refetchInterval: 10000,
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      apiFetch("/api/me/config", { method: "PATCH", body: JSON.stringify(config) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}

// --- Wallet ---
export function useWallet() {
  return useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<{
      address: string;
      usdtBalance: string;
      bnbBalance: string;
      deposits: Array<{ id: string; token: string; amount: string; confirmedAt: string }>;
    }>("/api/wallet"),
    enabled: _authenticated,
    refetchInterval: 15000,
  });
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { token: string; amount: string; toAddress: string }) =>
      apiFetch<{ id: string; status: string; txHash?: string }>("/api/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet"] }),
  });
}

// --- Agent ---
export function useAgentStatus() {
  return useQuery({
    queryKey: ["agent-status"],
    queryFn: () => apiFetch<{
      running: boolean;
      tradesExecuted: number;
      lastScan: number;
      uptime: number;
      config?: Record<string, unknown>;
    }>("/api/agent/status"),
    enabled: _authenticated,
    refetchInterval: 3000,
  });
}

export function useStartAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/agent/start", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-status"] }),
  });
}

export function useStopAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/agent/stop", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-status"] }),
  });
}

// --- Markets (public, no auth) ---
export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: () => apiFetch<{
      quoteCount: number;
      updatedAt: number;
      opportunities: Array<{
        marketId: string;
        title: string | null;
        links: { predict?: string; probable?: string; opinion?: string } | null;
        protocolA: string;
        protocolB: string;
        buyYesOnA: boolean;
        yesPriceA: string;
        noPriceB: string;
        spreadBps: number;
        grossSpreadBps: number;
        feesDeducted: string;
        estProfit: string;
        totalCost: string;
        liquidityA: string;
        liquidityB: string;
      }>;
    }>("/api/markets"),
    refetchInterval: 10000,
  });
}

// --- Trades ---
export interface TradeLeg {
  platform: string;
  orderId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  filled: boolean;
  filledSize: number;
  transactionHash?: string;
  marketId?: string;
}

export interface Trade {
  id: string;
  marketId: string;
  status: string;
  legA: TradeLeg | null;
  legB: TradeLeg | null;
  totalCost: number;
  expectedPayout: number;
  spreadBps: number;
  pnl: number | null;
  openedAt: string;
  closedAt: string | null;
  marketTitle: string | null;
  marketCategory: string | null;
  resolvesAt: string | null;
}

export function useTrades(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["trades", limit, offset],
    queryFn: () => apiFetch<{
      trades: Trade[];
      limit: number;
      offset: number;
    }>(`/api/trades?limit=${limit}&offset=${offset}`),
    enabled: _authenticated,
  });
}

// --- Session helpers ---
export function hasSession(): boolean {
  return _authenticated;
}
