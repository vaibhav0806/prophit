export type AgentStatusValue = "stopped" | "running" | "error";
export type WithdrawalStatus = "pending" | "processing" | "confirmed" | "failed";
export type TradeStatus = "OPEN" | "PARTIAL" | "FILLED" | "CLOSED" | "EXPIRED";

export interface UserAgentConfig {
  minTradeSize: bigint;
  maxTradeSize: bigint;
  minSpreadBps: number;
  maxSpreadBps: number;
  maxTotalTrades: number | null;
  tradingDurationMs: bigint | null;
  dailyLossLimit: bigint;
  maxResolutionDays: number | null;
}

export interface UserAgentStatus {
  running: boolean;
  tradesExecuted: number;
  pnl: number;
  lastScan: number;
  uptime: number;
}

export interface WalletInfo {
  address: string;
  usdtBalance: string;
  bnbBalance: string;
}
