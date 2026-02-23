export interface MarketQuote {
  marketId: `0x${string}`;
  protocol: string;
  yesPrice: bigint;
  noPrice: bigint;
  yesLiquidity: bigint;
  noLiquidity: bigint;
  feeBps: number; // protocol fee in basis points (e.g. 200 for Predict.fun)
  eventDescription?: string;
  expiresAt?: number;
  category?: string;
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
    maxPositionSize: string;
    scanIntervalMs: number;
  };
}
