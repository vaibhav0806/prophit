export interface MarketQuote {
  marketId: `0x${string}`;
  protocol: string;
  yesPrice: bigint;
  noPrice: bigint;
  yesLiquidity: bigint;
  noLiquidity: bigint;
  feeBps: number; // protocol fee in basis points (e.g. 200 for Predict.fun)
  quotedAt: number; // Date.now() when quote was fetched
  eventDescription?: string;
  expiresAt?: number;
  category?: string;
  title?: string;                    // market question/title from discovery
  outcomeLabels?: [string, string];  // [yesLabel, noLabel]
}

export interface MatchVerification {
  match: boolean;
  confidence: number;
  reasoning: string;
}

export interface RiskAssessment {
  riskScore: number;
  recommendedSizeMultiplier: number;
  concerns: string[];
}

export interface ArbitOpportunity {
  marketId: `0x${string}`;
  protocolA: string;
  protocolB: string;
  buyYesOnA: boolean;
  yesPriceA: bigint;
  noPriceB: bigint;
  totalCost: bigint;
  guaranteedPayout: bigint; // 1e18 per share
  spreadBps: number;
  grossSpreadBps: number; // spread before fee deduction
  feesDeducted: bigint; // total fees deducted (18 decimals)
  estProfit: bigint;
  liquidityA: bigint; // available liquidity for leg A (6 decimals USDT)
  liquidityB: bigint; // available liquidity for leg B (6 decimals USDT)
  polarityFlip?: boolean; // YES on A = NO on B (prices inverted)
  quotedAt: number; // min(quotedAtA, quotedAtB) — oldest underlying quote
}

export interface Position {
  positionId: number;
  adapterA: `0x${string}`;
  adapterB: `0x${string}`;
  marketIdA: `0x${string}`;
  marketIdB: `0x${string}`;
  boughtYesOnA: boolean;
  sharesA: bigint;
  sharesB: bigint;
  costA: bigint;
  costB: bigint;
  openedAt: bigint;
  closed: boolean;
}

export interface AgentStatus {
  running: boolean;
  lastScan: number;
  tradesExecuted: number;
  uptime: number;
  config: {
    minSpreadBps: number;
    maxSpreadBps: number;
    maxPositionSize: string;
    scanIntervalMs: number;
    executionMode: ExecutionMode;
  };
}

// --- CLOB execution types ---

export type ExecutionMode = "vault" | "clob";

export type ClobPositionStatus = "OPEN" | "PARTIAL" | "FILLED" | "CLOSED" | "EXPIRED";

export interface ClobLeg {
  platform: string;
  orderId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  filled: boolean;
  filledSize: number;
  transactionHash?: string;
  /** Predict.fun market ID — needed for per-market exchange resolution during unwind */
  marketId?: string;
}

export interface ClobPosition {
  id: string;
  marketId: `0x${string}`;
  status: ClobPositionStatus;
  legA: ClobLeg;
  legB: ClobLeg;
  totalCost: number;
  expectedPayout: number;
  spreadBps: number;
  openedAt: number;
  closedAt?: number;
  pnl?: number;
}

export interface MarketMeta {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  /** Predict.fun numeric market ID — used for per-market exchange resolution */
  predictMarketId?: string;
}
