function getPlatformUrl() { return process.env.PLATFORM_URL || "http://localhost:4000"; }
function getBotSecret() { return process.env.TELEGRAM_BOT_SECRET || ""; }

async function apiRequest<T>(chatId: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getPlatformUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bot ${getBotSecret()}`,
      "X-Telegram-Chat-Id": chatId,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || `API error: ${res.status}`);
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Typed methods
export function getProfile(chatId: string) {
  return apiRequest<{ id: string; walletAddress: string; config: Record<string, unknown> | null }>(chatId, "/api/me");
}

export function getAgentStatus(chatId: string) {
  return apiRequest<{ running: boolean; tradesExecuted: number; lastScan: number; uptime: number }>(chatId, "/api/agent/status");
}

export function startAgent(chatId: string) {
  return apiRequest<{ ok: boolean }>(chatId, "/api/agent/start", { method: "POST" });
}

export function stopAgent(chatId: string) {
  return apiRequest<{ ok: boolean }>(chatId, "/api/agent/stop", { method: "POST" });
}

export function getWallet(chatId: string) {
  return apiRequest<{ address: string; usdtBalance: string; bnbBalance: string }>(chatId, "/api/wallet");
}

export function getTrades(chatId: string) {
  return apiRequest<{ trades: Array<{ id: string; marketId: string; status: string; spreadBps: number; totalCost: number; pnl: number | null; openedAt: string; marketTitle: string | null }> }>(chatId, "/api/trades?limit=10");
}

export function getMarkets() {
  // Public endpoint, no auth needed but we still send headers (platform ignores for public routes)
  return apiRequest<{ quoteCount: number; updatedAt: number; opportunities: Array<{ marketId: string; title: string | null; spreadBps: number; estProfit: string; totalCost: string }> }>("", "/api/markets");
}

export function updateConfig(chatId: string, update: Record<string, unknown>) {
  return apiRequest<{ ok: boolean }>(chatId, "/api/me/config", { method: "PATCH", body: JSON.stringify(update) });
}
