import type {
  MarketQuote,
  ArbitOpportunity,
  ClobPosition,
  ClobLeg,
  Position,
} from "../../types.js";

const ONE = 10n ** 18n;

export const MARKET_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
export const ADAPTER_A =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
export const ADAPTER_B =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;

export function makeQuote(
  overrides?: Partial<MarketQuote>,
): MarketQuote {
  return {
    marketId: MARKET_ID,
    protocol: "testA",
    yesPrice: ONE / 2n,
    noPrice: ONE / 2n,
    yesLiquidity: ONE,
    noLiquidity: ONE,
    feeBps: 0,
    quotedAt: Date.now(),
    ...overrides,
  };
}

export function makeArbitOpportunity(
  overrides?: Partial<ArbitOpportunity>,
): ArbitOpportunity {
  return {
    marketId: MARKET_ID,
    protocolA: "probable",
    protocolB: "predict",
    buyYesOnA: true,
    yesPriceA: (ONE * 40n) / 100n,
    noPriceB: (ONE * 30n) / 100n,
    totalCost: (ONE * 70n) / 100n,
    guaranteedPayout: ONE,
    spreadBps: 3000,
    grossSpreadBps: 3000,
    feesDeducted: 0n,
    estProfit: 30_000_000n,
    liquidityA: 500_000_000n,
    liquidityB: 500_000_000n,
    ...overrides,
  };
}

export function makeClobLeg(
  overrides?: Partial<ClobLeg>,
): ClobLeg {
  return {
    platform: "probable",
    orderId: "order-1",
    tokenId: "token-1",
    side: "BUY",
    price: 0.5,
    size: 100,
    filled: false,
    filledSize: 0,
    ...overrides,
  };
}

export function makeClobPosition(
  overrides?: Partial<ClobPosition>,
): ClobPosition {
  return {
    id: "pos-1",
    marketId: MARKET_ID,
    status: "OPEN",
    legA: makeClobLeg({ platform: "probable" }),
    legB: makeClobLeg({ platform: "predict", orderId: "order-2", tokenId: "token-2" }),
    totalCost: 90,
    expectedPayout: 100,
    spreadBps: 1000,
    openedAt: Date.now(),
    ...overrides,
  };
}

export function makePosition(
  overrides?: Partial<Position>,
): Position {
  return {
    positionId: 1,
    adapterA: ADAPTER_A,
    adapterB: ADAPTER_B,
    marketIdA: MARKET_ID,
    marketIdB: MARKET_ID,
    boughtYesOnA: true,
    sharesA: ONE,
    sharesB: ONE,
    costA: 500_000n,
    costB: 500_000n,
    openedAt: BigInt(Math.floor(Date.now() / 1000)),
    closed: false,
    ...overrides,
  };
}
