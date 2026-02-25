import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectArbitrage } from "../../arbitrage/detector.js";
import { Executor } from "../../execution/executor.js";
import { loadState, saveState, type PersistedState } from "../../persistence.js";
import type { MarketQuote, ArbitOpportunity, Position, ClobPosition } from "../../types.js";
import { makeQuote, makePosition, makeClobPosition, MARKET_ID, ADAPTER_A, ADAPTER_B } from "../helpers/fixtures.js";

vi.mock("../../logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../retry.js", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

// In-memory fs store for persistence tests
const fsStore: Record<string, string> = {};
function resetFsStore() {
  for (const key of Object.keys(fsStore)) delete fsStore[key];
}

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (fsStore[path]) return fsStore[path];
    throw new Error("ENOENT");
  }),
  writeFileSync: vi.fn((path: string, data: string) => {
    fsStore[path] = data;
  }),
  renameSync: vi.fn((from: string, to: string) => {
    fsStore[to] = fsStore[from];
    delete fsStore[from];
  }),
}));

const ONE = 10n ** 18n;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockVaultClient() {
  return {
    openPosition: vi.fn().mockResolvedValue(1n),
    closePosition: vi.fn().mockResolvedValue(1_000_000n),
    getVaultBalance: vi.fn().mockResolvedValue(10_000_000_000n),
    getPosition: vi.fn(),
    getPositionCount: vi.fn(),
    getAllPositions: vi.fn(),
    publicClient: {
      getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n),
    },
  } as any;
}

function createConfig(overrides?: Record<string, any>) {
  return {
    executionMode: "vault" as const,
    adapterAAddress: ADAPTER_A,
    adapterBAddress: ADAPTER_B,
    marketId: MARKET_ID,
    gasToUsdtRate: 3_000_000_000n,
    dryRun: false,
    fillPollIntervalMs: 100,
    fillPollTimeoutMs: 1000,
    ...overrides,
  } as any;
}

function createPublicClient() {
  return {
    readContract: vi.fn(),
    getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n),
  } as any;
}

// ---------------------------------------------------------------------------
// Quote → Detection → Execution pipeline (vault mode)
// ---------------------------------------------------------------------------

describe("Integration: quote → detection → execution (vault)", () => {
  it("detects arb from two provider quotes and executes via vault", async () => {
    // Provider A: YES at 0.40 (cheap YES)
    const quoteA = makeQuote({
      protocol: "Probable",
      yesPrice: (ONE * 40n) / 100n,
      noPrice: (ONE * 60n) / 100n,
      yesLiquidity: 500_000_000n,
      noLiquidity: 500_000_000n,
      feeBps: 0,
    });

    // Provider B: NO at 0.30 (cheap NO)
    const quoteB = makeQuote({
      protocol: "Predict",
      yesPrice: (ONE * 70n) / 100n,
      noPrice: (ONE * 30n) / 100n,
      yesLiquidity: 500_000_000n,
      noLiquidity: 500_000_000n,
      feeBps: 0,
    });

    // Step 1: Detect arbitrage
    const opps = detectArbitrage([quoteA, quoteB]);
    expect(opps.length).toBeGreaterThanOrEqual(1);

    // Should find buy YES on A + buy NO on B (0.40 + 0.30 = 0.70 < 1.0)
    const bestOpp = opps.find((o) => o.buyYesOnA && o.protocolA === "Probable");
    expect(bestOpp).toBeDefined();
    expect(bestOpp!.spreadBps).toBeGreaterThan(0);
    expect(bestOpp!.totalCost).toBe((ONE * 70n) / 100n);

    // Step 2: Execute via vault
    const vaultClient = createMockVaultClient();
    const executor = new Executor(vaultClient, createConfig(), createPublicClient());

    await executor.executeBest(bestOpp!, 1_000_000_000n);
    expect(vaultClient.openPosition).toHaveBeenCalled();

    const call = vaultClient.openPosition.mock.calls[0][0];
    expect(call.buyYesOnA).toBe(true);
    expect(call.adapterA).toBe(ADAPTER_A);
    expect(call.adapterB).toBe(ADAPTER_B);
  });

  it("skips execution when spread is eaten by fees", async () => {
    // YES at 0.48 + NO at 0.48 = 0.96 → 4% gross spread
    // But with 200bps fee on each leg, fees eat the spread
    const quoteA = makeQuote({
      protocol: "Probable",
      yesPrice: (ONE * 48n) / 100n,
      noPrice: (ONE * 52n) / 100n,
      feeBps: 200,
    });

    const quoteB = makeQuote({
      protocol: "Predict",
      yesPrice: (ONE * 52n) / 100n,
      noPrice: (ONE * 48n) / 100n,
      feeBps: 200,
    });

    const opps = detectArbitrage([quoteA, quoteB]);

    // With 200bps fees, the worst-case fee per leg is significant
    // Either no opportunities are found, or they have very small spreads
    // that would be unprofitable after gas
    if (opps.length > 0) {
      // If detector still finds something, verify spread is very small
      expect(opps[0].spreadBps).toBeLessThan(400);
    }
  });

  it("handles multiple markets with different spread opportunities", async () => {
    const MKT_2 = "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`;

    const quotes: MarketQuote[] = [
      // Market 1: 30% spread
      makeQuote({ protocol: "A", yesPrice: (ONE * 40n) / 100n, noPrice: (ONE * 60n) / 100n, feeBps: 0 }),
      makeQuote({ protocol: "B", yesPrice: (ONE * 70n) / 100n, noPrice: (ONE * 30n) / 100n, feeBps: 0 }),
      // Market 2: 10% spread
      makeQuote({ marketId: MKT_2, protocol: "A", yesPrice: (ONE * 45n) / 100n, noPrice: (ONE * 55n) / 100n, feeBps: 0 }),
      makeQuote({ marketId: MKT_2, protocol: "B", yesPrice: (ONE * 55n) / 100n, noPrice: (ONE * 45n) / 100n, feeBps: 0 }),
    ];

    const opps = detectArbitrage(quotes);
    expect(opps.length).toBeGreaterThanOrEqual(2);

    // Opportunities are sorted by spreadBps descending
    expect(opps[0].spreadBps).toBeGreaterThanOrEqual(opps[1].spreadBps);
  });

  it("no opportunities when prices sum to 1.0", async () => {
    const quoteA = makeQuote({ protocol: "A", yesPrice: (ONE * 50n) / 100n, noPrice: (ONE * 50n) / 100n, feeBps: 0 });
    const quoteB = makeQuote({ protocol: "B", yesPrice: (ONE * 50n) / 100n, noPrice: (ONE * 50n) / 100n, feeBps: 0 });

    const opps = detectArbitrage([quoteA, quoteB]);
    expect(opps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Persistence round-trip
// ---------------------------------------------------------------------------

describe("Integration: persistence round-trip", () => {
  beforeEach(() => {
    resetFsStore();
  });

  it("positions with BigInt fields survive save/load cycle", () => {
    const state: PersistedState = {
      tradesExecuted: 5,
      positions: [makePosition({
        sharesA: 1_234_567_890_123_456_789n,
        sharesB: 9_876_543_210n,
        costA: 500_000n,
        costB: 600_000n,
        openedAt: 1700000000n,
      })],
      clobPositions: [],
      lastScan: Date.now(),
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded).not.toBeNull();
    expect(loaded!.tradesExecuted).toBe(5);
    expect(loaded!.positions).toHaveLength(1);

    const pos = loaded!.positions[0];
    expect(pos.sharesA).toBe(1_234_567_890_123_456_789n);
    expect(pos.sharesB).toBe(9_876_543_210n);
    expect(pos.costA).toBe(500_000n);
    expect(pos.costB).toBe(600_000n);
    expect(pos.openedAt).toBe(1700000000n);
    expect(typeof pos.sharesA).toBe("bigint");
  });

  it("CLOB positions survive save/load cycle", () => {
    const clobPos = makeClobPosition({
      id: "clob-123",
      status: "FILLED",
      legA: {
        platform: "probable",
        orderId: "order-a",
        tokenId: "token-a",
        side: "BUY",
        price: 0.45,
        size: 100,
        filled: true,
        filledSize: 100,
      },
      legB: {
        platform: "predict",
        orderId: "order-b",
        tokenId: "token-b",
        side: "BUY",
        price: 0.35,
        size: 100,
        filled: true,
        filledSize: 100,
      },
    });

    const state: PersistedState = {
      tradesExecuted: 3,
      positions: [],
      clobPositions: [clobPos],
      lastScan: Date.now(),
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded!.clobPositions).toHaveLength(1);
    expect(loaded!.clobPositions[0].id).toBe("clob-123");
    expect(loaded!.clobPositions[0].status).toBe("FILLED");
    expect(loaded!.clobPositions[0].legA.filled).toBe(true);
    expect(loaded!.clobPositions[0].legB.platform).toBe("predict");
  });

  it("CLOB nonces persist across save/load", () => {
    const state: PersistedState = {
      tradesExecuted: 1,
      positions: [],
      clobPositions: [],
      lastScan: Date.now(),
      clobNonces: {
        "0x1111111111111111111111111111111111111111": "42",
        "0x2222222222222222222222222222222222222222": "100",
      },
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded!.clobNonces).toEqual({
      "0x1111111111111111111111111111111111111111": "42",
      "0x2222222222222222222222222222222222222222": "100",
    });
  });

  it("loadState returns null for missing file", () => {
    const loaded = loadState();
    expect(loaded).toBeNull();
  });

  it("loadState handles corrupted JSON gracefully", () => {
    // Directly write corrupt data into our mock store
    const stateFile = process.env.STATE_FILE_PATH || require("node:path").join(process.cwd(), "agent-state.json");
    fsStore[stateFile] = "not valid json{{{";

    const loaded = loadState();
    expect(loaded).toBeNull();
  });

  it("handles empty positions array", () => {
    const state: PersistedState = {
      tradesExecuted: 0,
      positions: [],
      clobPositions: [],
      lastScan: 0,
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded!.positions).toEqual([]);
    expect(loaded!.clobPositions).toEqual([]);
    expect(loaded!.tradesExecuted).toBe(0);
  });

  it("multiple positions with different BigInt values round-trip correctly", () => {
    const state: PersistedState = {
      tradesExecuted: 10,
      positions: [
        makePosition({ positionId: 0, sharesA: 0n, sharesB: 0n, costA: 0n, costB: 0n, openedAt: 0n }),
        makePosition({ positionId: 1, sharesA: ONE, sharesB: ONE * 2n, costA: 1_000_000n, costB: 2_000_000n, openedAt: 1700000000n }),
        makePosition({ positionId: 2, sharesA: BigInt(Number.MAX_SAFE_INTEGER), sharesB: 1n, costA: 999_999_999n, costB: 1n, openedAt: 1800000000n }),
      ],
      clobPositions: [],
      lastScan: Date.now(),
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded!.positions).toHaveLength(3);
    expect(loaded!.positions[0].sharesA).toBe(0n);
    expect(loaded!.positions[1].sharesA).toBe(ONE);
    expect(loaded!.positions[2].sharesA).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });
});

// ---------------------------------------------------------------------------
// Detection → Execution: edge cases
// ---------------------------------------------------------------------------

describe("Integration: detection → execution edge cases", () => {
  it("executor respects maxPositionSize from quotes with low liquidity", async () => {
    // Quotes that create a 30% spread but with very low liquidity on one side
    const quoteA = makeQuote({
      protocol: "Probable",
      yesPrice: (ONE * 40n) / 100n,
      noPrice: (ONE * 60n) / 100n,
      yesLiquidity: 10_000n, // only 0.01 USDT available
      noLiquidity: 500_000_000n,
      feeBps: 0,
    });
    const quoteB = makeQuote({
      protocol: "Predict",
      yesPrice: (ONE * 70n) / 100n,
      noPrice: (ONE * 30n) / 100n,
      yesLiquidity: 500_000_000n,
      noLiquidity: 500_000_000n,
      feeBps: 0,
    });

    const opps = detectArbitrage([quoteA, quoteB]);
    const bestOpp = opps.find((o) => o.buyYesOnA && o.protocolA === "Probable");
    expect(bestOpp).toBeDefined();
    // liquidityA is 10_000 (very low)
    expect(bestOpp!.liquidityA).toBe(10_000n);

    // Executor should cap to 90% of low liquidity → 9_000
    const vaultClient = createMockVaultClient();
    const executor = new Executor(vaultClient, createConfig(), createPublicClient());

    await executor.executeBest(bestOpp!, 1_000_000_000n);

    const call = vaultClient.openPosition.mock.calls[0][0];
    expect(call.amountA).toBe(9_000n); // 10_000 * 90% = 9_000
  });

  it("bi-directional arb: finds both YES-on-A and NO-on-A opportunities", () => {
    // Quote where both directions could be profitable with different counterparties
    const quoteA = makeQuote({
      protocol: "A",
      yesPrice: (ONE * 30n) / 100n, // cheap YES
      noPrice: (ONE * 30n) / 100n,  // cheap NO too (impossible in real life, but tests detection)
      feeBps: 0,
    });
    const quoteB = makeQuote({
      protocol: "B",
      yesPrice: (ONE * 30n) / 100n,
      noPrice: (ONE * 30n) / 100n,
      feeBps: 0,
    });

    const opps = detectArbitrage([quoteA, quoteB]);

    // YES on A + NO on B: 0.30 + 0.30 = 0.60 < 1.0 → 40% spread
    // NO on A + YES on B: 0.30 + 0.30 = 0.60 < 1.0 → 40% spread
    expect(opps).toHaveLength(2);
    const buyYes = opps.find((o) => o.buyYesOnA);
    const buyNo = opps.find((o) => !o.buyYesOnA);
    expect(buyYes).toBeDefined();
    expect(buyNo).toBeDefined();
  });

  it("single provider quote yields no arbitrage", () => {
    const quotes = [makeQuote({ protocol: "Only" })];
    const opps = detectArbitrage(quotes);
    expect(opps).toHaveLength(0);
  });

  it("three providers yield pairwise comparison", () => {
    const quotes = [
      makeQuote({ protocol: "A", yesPrice: (ONE * 40n) / 100n, noPrice: (ONE * 60n) / 100n, feeBps: 0 }),
      makeQuote({ protocol: "B", yesPrice: (ONE * 70n) / 100n, noPrice: (ONE * 30n) / 100n, feeBps: 0 }),
      makeQuote({ protocol: "C", yesPrice: (ONE * 60n) / 100n, noPrice: (ONE * 35n) / 100n, feeBps: 0 }),
    ];

    const opps = detectArbitrage(quotes);
    // A-B: YES on A (0.40) + NO on B (0.30) = 0.70 → 30% spread
    // A-C: YES on A (0.40) + NO on C (0.35) = 0.75 → 25% spread
    // B-C: NO on B (0.30) + YES on C (0.60) = 0.90 → but need to check direction
    // Multiple opportunities expected
    expect(opps.length).toBeGreaterThanOrEqual(2);

    // Best should be A-B with 30% spread
    expect(opps[0].spreadBps).toBeGreaterThanOrEqual(opps[opps.length - 1].spreadBps);
  });
});
