import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CREDENTIALS_PATH = join(homedir(), ".prophet", "credentials.json");

function getPlatformUrl() { return process.env.PLATFORM_URL || "http://localhost:4000"; }
function getBotSecret() { return process.env.TELEGRAM_BOT_SECRET || ""; }

export function getUserWallet(): string {
  // Env var takes priority
  if (process.env.USER_WALLET_ADDRESS) return process.env.USER_WALLET_ADDRESS;
  // Fallback to saved credentials
  try {
    const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
    return creds.walletAddress || "";
  } catch {
    return "";
  }
}

export function saveCredentials(walletAddress: string) {
  mkdirSync(join(homedir(), ".prophet"), { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify({ walletAddress }, null, 2), { mode: 0o600 });
}

export function clearCredentials() {
  try { unlinkSync(CREDENTIALS_PATH); } catch { /* ignore */ }
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const wallet = getUserWallet();
  if (!wallet) throw new Error("Not logged in. Use 'login' first.");
  const res = await fetch(`${getPlatformUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bot ${getBotSecret()}`,
      "X-User-Wallet": wallet,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as Record<string, string>).error || `API error: ${res.status}`);
  }
  return res.json() as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getProfile() {
  return apiRequest<{ id: string; walletAddress: string; config: Record<string, unknown> | null }>("/api/me");
}

export function getAgentStatus() {
  return apiRequest<{ running: boolean; tradesExecuted: number; lastScan: number; uptime: number }>("/api/agent/status");
}

export function startAgent() {
  return apiRequest<{ ok: boolean }>("/api/agent/start", { method: "POST" });
}

export function stopAgent() {
  return apiRequest<{ ok: boolean }>("/api/agent/stop", { method: "POST" });
}

export function getWallet() {
  return apiRequest<{ address: string; usdtBalance: string; bnbBalance: string }>("/api/wallet");
}

export function getTrades() {
  return apiRequest<{ trades: Array<{ id: string; marketId: string; status: string; spreadBps: number; totalCost: number; pnl: number | null; openedAt: string; marketTitle: string | null }> }>("/api/trades?limit=10");
}

export function getMarkets() {
  return apiRequest<{ quoteCount: number; updatedAt: number; opportunities: Array<{ marketId: string; title: string | null; spreadBps: number; estProfit: string; totalCost: string }> }>("/api/markets");
}

export function updateConfig(update: Record<string, unknown>) {
  return apiRequest<{ ok: boolean }>("/api/me/config", { method: "PATCH", body: JSON.stringify(update) });
}
