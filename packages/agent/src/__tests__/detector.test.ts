import { describe, it, expect } from "vitest";
import { detectArbitrage } from "../arbitrage/detector.js";
import type { MarketQuote } from "../types.js";

const ONE = 10n ** 18n;
const marketId = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

function quote(
  protocol: string,
  yesPrice: bigint,
  noPrice: bigint,
  feeBps = 0,
): MarketQuote {
  return {
    marketId,
    protocol,
    yesPrice,
    noPrice,
    yesLiquidity: ONE,
    noLiquidity: ONE,
    feeBps,
    quotedAt: Date.now(),
  };
}

describe("detectArbitrage", () => {
  it("returns empty array when given no quotes", () => {
    expect(detectArbitrage([])).toEqual([]);
  });

  it("returns empty array when only one provider exists", () => {
    const quotes = [quote("A", ONE / 2n, ONE / 2n)];
    expect(detectArbitrage(quotes)).toEqual([]);
  });

  it("returns empty array when prices sum to 1 (no arb)", () => {
    const quotes = [
      quote("A", ONE / 2n, ONE / 2n),
      quote("B", ONE / 2n, ONE / 2n),
    ];
    expect(detectArbitrage(quotes)).toEqual([]);
  });

  it("detects arbitrage when yes_A + no_B < 1", () => {
    // A: yes=0.40, no=0.60  B: yes=0.60, no=0.30
    // yes_A + no_B = 0.40 + 0.30 = 0.70 < 1 => arb
    const now = Date.now();
    const quotes = [
      quote("A", (ONE * 40n) / 100n, (ONE * 60n) / 100n),
      quote("B", (ONE * 60n) / 100n, (ONE * 30n) / 100n),
    ];
    // Give B an older quotedAt to verify min() propagation
    quotes[1].quotedAt = now - 5000;

    const result = detectArbitrage(quotes);
    expect(result.length).toBeGreaterThanOrEqual(1);

    const arb = result.find((o) => o.buyYesOnA === true);
    expect(arb).toBeDefined();
    expect(arb!.protocolA).toBe("A");
    expect(arb!.protocolB).toBe("B");
    expect(arb!.spreadBps).toBeGreaterThan(0);
    expect(arb!.totalCost).toBeLessThan(ONE);
    expect(arb!.quotedAt).toBe(now - 5000);
  });

  it("detects arbitrage when no_A + yes_B < 1", () => {
    // A: yes=0.70, no=0.20  B: yes=0.30, no=0.80
    // no_A + yes_B = 0.20 + 0.30 = 0.50 < 1 => arb
    const now = Date.now();
    const quotes = [
      quote("A", (ONE * 70n) / 100n, (ONE * 20n) / 100n),
      quote("B", (ONE * 30n) / 100n, (ONE * 80n) / 100n),
    ];
    quotes[0].quotedAt = now - 3000;

    const result = detectArbitrage(quotes);
    expect(result.length).toBeGreaterThanOrEqual(1);

    const arb = result.find((o) => o.buyYesOnA === false);
    expect(arb).toBeDefined();
    expect(arb!.spreadBps).toBeGreaterThan(0);
    expect(arb!.quotedAt).toBe(now - 3000);
  });

  it("returns no opportunity when prices sum above 1", () => {
    // A: yes=0.55, no=0.55  B: yes=0.55, no=0.55
    // Both combos = 1.10 > 1
    const quotes = [
      quote("A", (ONE * 55n) / 100n, (ONE * 55n) / 100n),
      quote("B", (ONE * 55n) / 100n, (ONE * 55n) / 100n),
    ];

    expect(detectArbitrage(quotes)).toEqual([]);
  });

  it("sorts opportunities by spreadBps descending", () => {
    const marketId2 = "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`;

    const quotes: MarketQuote[] = [
      // Market 1: small spread (yes_A + no_B = 0.95)
      { marketId, protocol: "A", yesPrice: (ONE * 50n) / 100n, noPrice: (ONE * 50n) / 100n, yesLiquidity: ONE, noLiquidity: ONE, feeBps: 0, quotedAt: Date.now() },
      { marketId, protocol: "B", yesPrice: (ONE * 60n) / 100n, noPrice: (ONE * 45n) / 100n, yesLiquidity: ONE, noLiquidity: ONE, feeBps: 0, quotedAt: Date.now() },
      // Market 2: bigger spread (yes_A + no_B = 0.70)
      { marketId: marketId2, protocol: "A", yesPrice: (ONE * 40n) / 100n, noPrice: (ONE * 60n) / 100n, yesLiquidity: ONE, noLiquidity: ONE, feeBps: 0, quotedAt: Date.now() },
      { marketId: marketId2, protocol: "B", yesPrice: (ONE * 60n) / 100n, noPrice: (ONE * 30n) / 100n, yesLiquidity: ONE, noLiquidity: ONE, feeBps: 0, quotedAt: Date.now() },
    ];

    const result = detectArbitrage(quotes);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Should be sorted descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].spreadBps).toBeGreaterThanOrEqual(result[i].spreadBps);
    }
  });

  it("computes correct spreadBps with zero fees", () => {
    // yes_A + no_B = 0.40 + 0.30 = 0.70
    // gross spread = (1 - 0.70) / 1 * 10000 = 3000 bps
    // feeBps = 0 => net spread = gross spread
    const quotes = [
      quote("A", (ONE * 40n) / 100n, (ONE * 60n) / 100n),
      quote("B", (ONE * 60n) / 100n, (ONE * 30n) / 100n),
    ];

    const result = detectArbitrage(quotes);
    const arb = result.find((o) => o.buyYesOnA === true);
    expect(arb).toBeDefined();
    expect(arb!.spreadBps).toBe(3000);
    expect(arb!.grossSpreadBps).toBe(3000);
    expect(arb!.feesDeducted).toBe(0n);
    expect(arb!.liquidityA).toBe(ONE);
    expect(arb!.liquidityB).toBe(ONE);
  });

  it("computes estProfit correctly with zero fees", () => {
    // 100 USDT reference, 30% spread => estProfit = 100 * 0.30 = 30 USDT (6 decimals)
    const quotes = [
      quote("A", (ONE * 40n) / 100n, (ONE * 60n) / 100n),
      quote("B", (ONE * 60n) / 100n, (ONE * 30n) / 100n),
    ];

    const result = detectArbitrage(quotes);
    const arb = result.find((o) => o.buyYesOnA === true);
    expect(arb).toBeDefined();
    // REF_AMOUNT = 100 * 1e6 = 100_000_000
    // estProfit = 100_000_000 * (1e18 - 0.7e18) / 1e18 = 30_000_000
    expect(arb!.estProfit).toBe(30_000_000n);
  });

  it("deducts fees using worst-case profit fee", () => {
    // A: yes=0.40, feeBps=200 (2%)  B: no=0.30, feeBps=200 (2%)
    // cost = 0.40 + 0.30 = 0.70, gross spread = 3000 bps
    // feeIfYesWins = (1 - 0.40) * 200/10000 = 0.60 * 0.02 = 0.012
    // feeIfNoWins  = (1 - 0.30) * 200/10000 = 0.70 * 0.02 = 0.014
    // worstCaseFee = 0.014
    // effectivePayout = 1 - 0.014 = 0.986
    // netSpread = 0.986 - 0.70 = 0.286 => 2860 bps
    const quotes = [
      quote("A", (ONE * 40n) / 100n, (ONE * 60n) / 100n, 200),
      quote("B", (ONE * 60n) / 100n, (ONE * 30n) / 100n, 200),
    ];

    const result = detectArbitrage(quotes);
    const arb = result.find((o) => o.buyYesOnA === true);
    expect(arb).toBeDefined();
    expect(arb!.grossSpreadBps).toBe(3000);
    expect(arb!.spreadBps).toBe(2860);
    // worstCaseFee = 0.70 * 0.02 * 1e18 = 0.014e18
    expect(arb!.feesDeducted).toBe((ONE * 70n * 200n) / (100n * 10000n));
    // estProfit = 100_000_000 * 0.286e18 / 1e18 = 28_600_000
    expect(arb!.estProfit).toBe(28_600_000n);
  });

  it("excludes opportunities where fees exceed gross spread", () => {
    // A: yes=0.48, feeBps=200  B: no=0.48, feeBps=200
    // cost = 0.96, gross spread = 400 bps
    // feeIfYesWins = (1 - 0.48) * 0.02 = 0.0104
    // feeIfNoWins  = (1 - 0.48) * 0.02 = 0.0104
    // worstCaseFee = 0.0104
    // netSpread = (1 - 0.0104) - 0.96 = 0.0296 > 0 => still an arb
    //
    // But with very tight spread:
    // A: yes=0.495, feeBps=200  B: no=0.495, feeBps=200
    // cost = 0.99, gross spread = 100 bps
    // feeIfWins = (1 - 0.495) * 0.02 = 0.0101
    // netSpread = (1 - 0.0101) - 0.99 = -0.0001 < 0 => no arb
    const quotes = [
      quote("A", (ONE * 495n) / 1000n, (ONE * 505n) / 1000n, 200),
      quote("B", (ONE * 505n) / 1000n, (ONE * 495n) / 1000n, 200),
    ];

    const result = detectArbitrage(quotes);
    expect(result).toEqual([]);
  });
});
