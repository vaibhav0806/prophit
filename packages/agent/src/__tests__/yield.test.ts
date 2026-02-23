import { describe, it, expect } from "vitest";
import { scorePositions } from "../yield/scorer.js";
import { allocateCapital } from "../yield/allocator.js";
import { checkRotations } from "../yield/rotator.js";
import type { Position, ArbitOpportunity } from "../types.js";
import type { ScoredPosition } from "../yield/types.js";

const ONE = 10n ** 18n;
const USDT = 10n ** 6n;

const addrA = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const addrB = "0x0000000000000000000000000000000000000002" as `0x${string}`;
const marketId = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    positionId: 0,
    adapterA: addrA,
    adapterB: addrA, // same adapter = no cross-oracle risk
    marketIdA: marketId,
    marketIdB: marketId,
    boughtYesOnA: true,
    sharesA: 120n * ONE, // 120 shares at 1e18 each
    sharesB: 120n * ONE,
    costA: 50n * USDT, // 50 USDT per side
    costB: 50n * USDT,
    openedAt: BigInt(Math.floor(Date.now() / 1000) - 86400), // 1 day ago
    closed: false,
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<ArbitOpportunity> = {}): ArbitOpportunity {
  return {
    marketId,
    protocolA: "A",
    protocolB: "B",
    buyYesOnA: true,
    yesPriceA: (ONE * 40n) / 100n,
    noPriceB: (ONE * 30n) / 100n,
    totalCost: (ONE * 70n) / 100n, // 0.70 => 30% spread
    guaranteedPayout: ONE,
    spreadBps: 3000,
    grossSpreadBps: 3000,
    feesDeducted: 0n,
    estProfit: 30n * USDT,
    liquidityA: ONE,
    liquidityB: ONE,
    ...overrides,
  };
}

// --- Scorer tests ---

describe("scorePositions", () => {
  it("returns empty array for empty input", () => {
    expect(scorePositions([])).toEqual([]);
  });

  it("skips closed positions", () => {
    const pos = makePosition({ closed: true });
    expect(scorePositions([pos])).toEqual([]);
  });

  it("scores an open position with positive return", () => {
    const pos = makePosition();
    const result = scorePositions([pos]);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBeGreaterThan(0);
    expect(result[0].annualizedYield).toBeGreaterThan(0);
    expect(result[0].estimatedResolutionMs).toBeGreaterThan(0);
    expect(result[0].position).toBe(pos);
  });

  it("adds cross_oracle risk factor for different adapters", () => {
    const pos = makePosition({ adapterB: addrB });
    const result = scorePositions([pos]);

    expect(result).toHaveLength(1);
    expect(result[0].riskFactors).toContain("cross_oracle");
  });

  it("does not add cross_oracle for same adapter", () => {
    const pos = makePosition({ adapterA: addrA, adapterB: addrA });
    const result = scorePositions([pos]);

    expect(result).toHaveLength(1);
    expect(result[0].riskFactors).not.toContain("cross_oracle");
  });

  it("adds imbalanced_shares risk factor when shares differ significantly", () => {
    const pos = makePosition({
      sharesA: 100n * ONE,
      sharesB: 50n * ONE, // 50% ratio
    });
    const result = scorePositions([pos]);

    expect(result).toHaveLength(1);
    expect(result[0].riskFactors).toContain("imbalanced_shares");
  });

  it("cross-oracle position scores lower than same-oracle", () => {
    const sameOracle = makePosition({ positionId: 0, adapterA: addrA, adapterB: addrA });
    const crossOracle = makePosition({ positionId: 1, adapterA: addrA, adapterB: addrB });

    const result = scorePositions([sameOracle, crossOracle]);

    expect(result).toHaveLength(2);
    // Same oracle should score higher (sorted first)
    expect(result[0].position.adapterB).toBe(addrA);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("skips positions with zero cost", () => {
    const pos = makePosition({ costA: 0n, costB: 0n });
    expect(scorePositions([pos])).toEqual([]);
  });

  it("handles negative expected return", () => {
    // Cost exceeds payout: 200 USDT cost but only 120 shares (= 120 USDT payout)
    const pos = makePosition({
      costA: 100n * USDT,
      costB: 100n * USDT,
      sharesA: 120n * ONE,
      sharesB: 120n * ONE,
    });
    const result = scorePositions([pos]);

    expect(result).toHaveLength(1);
    expect(result[0].riskFactors).toContain("negative_expected_return");
    expect(result[0].score).toBe(0);
  });
});

// --- Allocator tests ---

describe("allocateCapital", () => {
  it("returns empty for zero capital", () => {
    expect(allocateCapital(0n, [makeOpportunity()], 500n * USDT)).toEqual([]);
  });

  it("returns empty for no opportunities", () => {
    expect(allocateCapital(1000n * USDT, [], 500n * USDT)).toEqual([]);
  });

  it("allocates capital to a valid opportunity", () => {
    const opp = makeOpportunity();
    const result = allocateCapital(1000n * USDT, [opp], 500n * USDT);

    expect(result).toHaveLength(1);
    expect(result[0].opportunity).toBe(opp);
    expect(result[0].recommendedSize).toBeGreaterThan(0n);
    expect(result[0].kellyFraction).toBeGreaterThan(0);
  });

  it("respects max position size", () => {
    const opp = makeOpportunity({ totalCost: (ONE * 50n) / 100n }); // huge spread
    const maxSize = 100n * USDT;
    const result = allocateCapital(10000n * USDT, [opp], maxSize);

    expect(result).toHaveLength(1);
    expect(result[0].recommendedSize).toBeLessThanOrEqual(maxSize);
  });

  it("does not exceed available capital", () => {
    const opp = makeOpportunity();
    const available = 50n * USDT;
    const result = allocateCapital(available, [opp], 10000n * USDT);

    expect(result).toHaveLength(1);
    expect(result[0].recommendedSize).toBeLessThanOrEqual(available);
  });

  it("skips opportunities with totalCost >= 1", () => {
    const opp = makeOpportunity({ totalCost: ONE }); // no spread
    const result = allocateCapital(1000n * USDT, [opp], 500n * USDT);

    expect(result).toEqual([]);
  });

  it("ranks opportunities by annualized yield descending", () => {
    const oppLow = makeOpportunity({ totalCost: (ONE * 90n) / 100n, spreadBps: 1000 }); // 10% spread
    const oppHigh = makeOpportunity({ totalCost: (ONE * 70n) / 100n, spreadBps: 3000 }); // 30% spread

    const result = allocateCapital(10000n * USDT, [oppLow, oppHigh], 5000n * USDT);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // Best opportunity should be first
    expect(result[0].opportunity.spreadBps).toBe(3000);
  });
});

// --- Rotator tests ---

describe("checkRotations", () => {
  const nowMs = Date.now();

  function makeScoredPosition(overrides: Partial<ScoredPosition> = {}): ScoredPosition {
    return {
      position: makePosition(),
      score: 1.0,
      annualizedYield: 0.10, // 10% annualized
      riskFactors: [],
      estimatedResolutionMs: 29 * 24 * 60 * 60 * 1000,
      ...overrides,
    };
  }

  it("returns empty for no positions", () => {
    expect(checkRotations([], [makeOpportunity()], 1000000n)).toEqual([]);
  });

  it("returns empty for no opportunities", () => {
    expect(checkRotations([makeScoredPosition()], [], 1000000n)).toEqual([]);
  });

  it("suggests rotation when yield improvement exceeds threshold", () => {
    // Current position yields 10% annualized
    const scored = makeScoredPosition({ annualizedYield: 0.10 });

    // New opportunity: 30% spread over 30 days ~ 365% annualized
    const opp = makeOpportunity({ totalCost: (ONE * 70n) / 100n });

    const result = checkRotations([scored], [opp], 1000000n, 200);

    expect(result).toHaveLength(1);
    expect(result[0].newYield).toBeGreaterThan(result[0].currentYield);
    expect(result[0].yieldImprovement).toBeGreaterThan(0);
    expect(result[0].exitPositionId).toBe(scored.position.positionId);
  });

  it("does not suggest rotation below min improvement threshold", () => {
    // Both yielding roughly the same
    const scored = makeScoredPosition({ annualizedYield: 3.5 });
    // 10% spread ~ 121% annualized — less than 3.5 + 0.02 threshold
    const opp = makeOpportunity({ totalCost: (ONE * 70n) / 100n });

    // Use a very high threshold (99999 bps) to ensure no rotation
    const result = checkRotations([scored], [opp], 1000000n, 99999);

    expect(result).toEqual([]);
  });

  it("accounts for gas cost in rotation decision", () => {
    // Low-value position with tiny improvement
    const scored = makeScoredPosition({
      annualizedYield: 0.10,
      position: makePosition({ costA: 1n, costB: 1n }), // tiny position
    });

    const opp = makeOpportunity({ totalCost: (ONE * 95n) / 100n }); // small spread

    // Very high gas cost relative to position
    const result = checkRotations([scored], [opp], 10n ** 18n, 0);

    // Should not suggest rotation because gas cost exceeds benefit
    expect(result).toEqual([]);
  });

  it("returns at most one suggestion per position", () => {
    const scored = makeScoredPosition({ annualizedYield: 0.05 });

    const opp1 = makeOpportunity({ totalCost: (ONE * 70n) / 100n, spreadBps: 3000 });
    const opp2 = makeOpportunity({ totalCost: (ONE * 60n) / 100n, spreadBps: 4000 });

    const result = checkRotations([scored], [opp1, opp2], 1000000n, 200);

    // Should only have 1 suggestion (best opportunity per position)
    expect(result).toHaveLength(1);
  });

  it("includes estimated exit cost as 2x gas estimate", () => {
    const scored = makeScoredPosition({ annualizedYield: 0.05 });
    const opp = makeOpportunity();
    const gasCost = 5000000n; // 5 USDT

    const result = checkRotations([scored], [opp], gasCost, 200);

    expect(result).toHaveLength(1);
    expect(result[0].estimatedExitCost).toBe(gasCost * 2n);
  });
});
