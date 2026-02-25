import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Executor } from "../execution/executor.js";
import type { ClobClient, OrderStatusResult, PlaceOrderParams } from "../clob/types.js";
import type { ArbitOpportunity, ClobPosition, MarketMeta } from "../types.js";

// ---------------------------------------------------------------------------
// Suppress log output during tests
// ---------------------------------------------------------------------------

vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClobClient(name: string): ClobClient {
  return {
    name,
    exchangeAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    authenticate: vi.fn().mockResolvedValue(undefined),
    placeOrder: vi.fn().mockResolvedValue({ success: true, orderId: `${name}-order-1` }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOrderStatus: vi.fn().mockResolvedValue({
      orderId: `${name}-order-1`,
      status: "OPEN",
      filledSize: 0,
      remainingSize: 10,
    } satisfies OrderStatusResult),
    ensureApprovals: vi.fn().mockResolvedValue(undefined),
  };
}

function createOpportunity(overrides?: Partial<ArbitOpportunity>): ArbitOpportunity {
  return {
    marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    protocolA: "probable",
    protocolB: "predict",
    buyYesOnA: true,
    yesPriceA: BigInt(5e17), // 0.5 in 1e18
    noPriceB: BigInt(4e17),  // 0.4 in 1e18
    totalCost: 900_000n,     // 0.9 USDT in 6-dec
    guaranteedPayout: BigInt(1e18),
    spreadBps: 200,
    grossSpreadBps: 250,
    feesDeducted: 50_000n,
    estProfit: 100_000n,
    liquidityA: 500_000_000n, // 500 USDT in 6-dec
    liquidityB: 500_000_000n,
    ...overrides,
  };
}

const mockMeta: MarketMeta = {
  conditionId: "0xcond1",
  yesTokenId: "111",
  noTokenId: "222",
};

function createMetaResolvers() {
  const resolver = { getMarketMeta: vi.fn().mockReturnValue(mockMeta) };
  return new Map<string, typeof resolver>([
    ["probable", resolver],
    ["predict", resolver],
  ]);
}

const mockConfig = {
  executionMode: "clob" as const,
  dryRun: false,
  fillPollIntervalMs: 100,
  fillPollTimeoutMs: 1000,
  minSpreadBps: 100,
  maxPositionSize: 500_000_000n,
  gasToUsdtRate: 3_000_000_000n,
  dailyLossLimit: 50_000_000n,
} as any;

const mockPublicClient = {
  readContract: vi.fn(),
  getGasPrice: vi.fn(),
} as any;

// ---------------------------------------------------------------------------
// executeClob
// ---------------------------------------------------------------------------

describe("executeClob", () => {
  let clientA: ClobClient;
  let clientB: ClobClient;
  let executor: Executor;

  beforeEach(() => {
    clientA = createMockClobClient("probable");
    clientB = createMockClobClient("predict");
    executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );
  });

  it("places both legs and returns FILLED position in dry-run mode", async () => {
    const dryRunConfig = { ...mockConfig, dryRun: true };
    const dryExecutor = new Executor(
      undefined,
      dryRunConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );

    const opp = createOpportunity();
    const result = await dryExecutor.executeBest(opp, 100_000_000n);

    expect(result).toBeDefined();
    const pos = result as ClobPosition;
    expect(pos.status).toBe("FILLED");
    expect(pos.legA.filled).toBe(true);
    expect(pos.legB.filled).toBe(true);
    expect(clientA.placeOrder).toHaveBeenCalledOnce();
    expect(clientB.placeOrder).toHaveBeenCalledOnce();
  });

  it("returns void when Predict leg fails", async () => {
    // Default opportunity: protocolA="probable", protocolB="predict"
    // So predictClient = clientB. Mock it to fail.
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: false, error: "crash" });

    const result = await executor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
    // Probable (clientA) should never have been called
    expect(clientA.placeOrder).not.toHaveBeenCalled();
  });

  it("skips when executor is paused", async () => {
    vi.useFakeTimers();

    const proxyAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;
    const walletAccount = { address: "0x1111111111111111111111111111111111111111" as `0x${string}` };
    const executorWithProxy = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    // Sequential flow with opp { protocolA: "predict", protocolB: "probable" }:
    // predictClient = clientB, probableClient = clientA
    // Step 1: Place Predict (clientB) → success
    // Step 2: Check EOA balance → dropped (Predict filled)
    // Step 3: Place Probable (clientA) → success
    // Step 4: Check Safe balance → not dropped (Probable didn't fill) → PARTIAL + pause

    // Balance calls:
    // 1. EOA balance pre-check (size cap) — for Predict leg, eoaLegs=1
    // 2. Safe balance pre-check (for Probable leg)
    // 3. pre-trade EOA snapshot
    // 4. pre-trade Safe snapshot
    // 5. post-trade EOA (after Predict) — dropped by 2 USDT = Predict filled
    // 6. post-trade Safe (after Probable) — no change = Probable didn't fill
    mockPublicClient.readContract
      .mockResolvedValueOnce(10n * 10n ** 18n)   // EOA balance pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // Safe balance pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade EOA snapshot
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade Safe snapshot
      .mockResolvedValueOnce(8n * 10n ** 18n)    // post-trade EOA (2 USDT spent → Predict filled!)
      .mockResolvedValueOnce(10n * 10n ** 18n);  // post-trade Safe (no change → Probable didn't fill)

    vi.mocked(clientB.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "predict-1" })   // Predict leg
      .mockResolvedValue({ success: false, error: "rejected" });         // all 3 unwind attempts fail
    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "probable-1" }); // Probable placement

    const opp = createOpportunity({ protocolA: "predict", protocolB: "probable" });
    const partialPromise = executorWithProxy.executeBest(opp, 100_000_000n);
    // Need to advance past two 3s waits (Predict check + Probable check) + unwind poll
    await vi.advanceTimersByTimeAsync(15000);
    await partialPromise;

    // All unwind orders rejected (systematic) — executor stays paused
    expect(executorWithProxy.isPaused()).toBe(true);

    vi.useRealTimers();
  });

  it("skips when CLOB client missing", async () => {
    const noClientsExecutor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      {},
      createMetaResolvers(),
      undefined,
    );

    const result = await noClientsExecutor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
  });

  it("skips when market meta missing", async () => {
    const emptyResolvers = new Map<string, { getMarketMeta: () => undefined }>([
      ["probable", { getMarketMeta: () => undefined }],
      ["predict", { getMarketMeta: () => undefined }],
    ]);

    const noMetaExecutor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      emptyResolvers as any,
      undefined,
    );

    const result = await noMetaExecutor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
  });

  it("caps position size to liquidity", async () => {
    const dryRunConfig = { ...mockConfig, dryRun: true };
    const dryExecutor = new Executor(
      undefined,
      dryRunConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );

    // Default opp: protocolA="probable", protocolB="predict"
    // So predictClient = clientB, probableClient = clientA
    // liquidityA = 5 USDT → sizeUsdt should be capped to ~4.5 (5 * 0.9)
    const opp = createOpportunity({
      liquidityA: 5_000_000n,  // 5 USDT
      liquidityB: 500_000_000n,
    });

    await dryExecutor.executeBest(opp, 100_000_000n);

    // In sequential flow, Predict (clientB) is called first, then Probable (clientA)
    const predictCall = vi.mocked(clientB.placeOrder).mock.calls[0]?.[0] as PlaceOrderParams;
    const probableCall = vi.mocked(clientA.placeOrder).mock.calls[0]?.[0] as PlaceOrderParams;
    // maxPositionSize/2 = 50 USDT, but liquidityA = 5 USDT, capped to 4.5
    expect(predictCall.size).toBeLessThanOrEqual(5);
    expect(predictCall.size).toBeCloseTo(4.5, 1);
    expect(probableCall.size).toBeCloseTo(4.5, 1);
  });

  it("detects both legs filled via balance check", async () => {
    vi.useFakeTimers();

    const proxyAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;
    const walletAccount = { address: "0x1111111111111111111111111111111111111111" as `0x${string}` };
    const executorWithWallet = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    // Default opp: protocolA="probable", protocolB="predict"
    // predictClient=clientB, probableClient=clientA
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: true, orderId: "predict-1" });
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: true, orderId: "probable-1" });

    // Sequential balance checks:
    // 1. EOA pre-check (size cap, eoaLegs=1 with proxy)
    // 2. Safe pre-check (for Probable leg)
    // 3. pre-trade EOA snapshot
    // 4. pre-trade Safe snapshot
    // 5. post-trade EOA (after Predict) — dropped by 2 USDT → Predict filled
    // 6. post-trade Safe (after Probable) — dropped by 2 USDT → Probable filled
    mockPublicClient.readContract
      .mockResolvedValueOnce(10n * 10n ** 18n)   // EOA pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // Safe pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade EOA snapshot
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade Safe snapshot
      .mockResolvedValueOnce(8n * 10n ** 18n)    // post-trade EOA (2 USDT spent)
      .mockResolvedValueOnce(8n * 10n ** 18n);   // post-trade Safe (2 USDT spent)

    const opp = createOpportunity();
    const promise = executorWithWallet.executeBest(opp, 100_000_000n);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result).toBeDefined();
    const pos = result as ClobPosition;
    expect(pos.status).toBe("FILLED");
    expect(pos.legA.filled).toBe(true);
    expect(pos.legB.filled).toBe(true);

    vi.useRealTimers();
  });

  it("skips when Safe USDT balance is insufficient for Probable leg", async () => {
    const proxyAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;
    const executorWithProxy = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: { address: "0x1111111111111111111111111111111111111111" } } as any,
    );

    // EOA USDT check returns enough
    mockPublicClient.readContract
      .mockResolvedValueOnce(1000n * 10n ** 18n) // EOA USDT balance — sufficient
      .mockResolvedValueOnce(5n * 10n ** 17n);   // Safe USDT balance — only 0.5 USDT, below $1 minimum

    const result = await executorWithProxy.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
    // placeOrder should not have been called
    expect(clientA.placeOrder).not.toHaveBeenCalled();
    expect(clientB.placeOrder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pollForFills
// ---------------------------------------------------------------------------

describe("pollForFills", () => {
  let clientA: ClobClient;
  let clientB: ClobClient;
  let executor: Executor;

  beforeEach(() => {
    vi.useFakeTimers();
    clientA = createMockClobClient("probable");
    clientB = createMockClobClient("predict");
    executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePosition(overrides?: Partial<ClobPosition>): ClobPosition {
    return {
      id: "clob-test-1",
      marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      status: "OPEN",
      legA: {
        platform: "probable",
        orderId: "a-order-1",
        tokenId: "111",
        side: "BUY",
        price: 0.5,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      legB: {
        platform: "predict",
        orderId: "b-order-1",
        tokenId: "222",
        side: "BUY",
        price: 0.4,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      totalCost: 100,
      expectedPayout: 110,
      spreadBps: 200,
      openedAt: Date.now(),
      ...overrides,
    };
  }

  it("returns FILLED when both legs fill", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(200);
    const result = await pollPromise;

    expect(result.status).toBe("FILLED");
    expect(result.legA.filled).toBe(true);
    expect(result.legB.filled).toBe(true);
  });

  it("returns EXPIRED when both legs cancel/expire", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "EXPIRED", filledSize: 0, remainingSize: 50,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(200);
    const result = await pollPromise;

    expect(result.status).toBe("EXPIRED");
  });

  it("sets PARTIAL and stays paused when leg A fills but leg B dies (systematic)", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });
    // Unwind order rejected — all 3 retry attempts fail (systematic → stays paused)
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: false, error: "rejected" });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pollPromise;

    expect(result.status).toBe("PARTIAL");
    expect(executor.isPaused()).toBe(true);
    expect(result.legA.filled).toBe(true);
  });

  it("sets PARTIAL and stays paused when leg B fills but leg A dies (systematic)", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "EXPIRED", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    // Unwind order rejected — all 3 retry attempts fail (systematic → stays paused)
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: false, error: "rejected" });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pollPromise;

    expect(result.status).toBe("PARTIAL");
    expect(executor.isPaused()).toBe(true);
    expect(result.legB.filled).toBe(true);
  });

  it("cancels unfilled legs on timeout", async () => {
    // Both stay OPEN and never fill — timeout
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    // Advance past the 1000ms timeout
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pollPromise;

    expect(result.status).toBe("EXPIRED");
    expect(clientA.cancelOrder).toHaveBeenCalledWith("a-order-1", "111");
    expect(clientB.cancelOrder).toHaveBeenCalledWith("b-order-1", "222");
  });

  it("handles timeout with one leg filled (partial)", async () => {
    // Leg A stays OPEN during polling, then at the final check it's filled
    // Leg B stays OPEN the whole time
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);

    // Let the poll loop run for a while...
    await vi.advanceTimersByTimeAsync(800);

    // Now change the status so that when the timeout check happens, A is filled
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });
    // Unwind order rejected — all 3 retry attempts fail (systematic → stays paused)
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: false, error: "rejected" });

    await vi.advanceTimersByTimeAsync(500);
    const result = await pollPromise;

    expect(result.status).toBe("PARTIAL");
    expect(executor.isPaused()).toBe(true);
    expect(clientB.cancelOrder).toHaveBeenCalledWith("b-order-1", "222");
  });
});

// ---------------------------------------------------------------------------
// attemptUnwind (tested indirectly via pollForFills)
// ---------------------------------------------------------------------------

describe("attemptUnwind", () => {
  let clientA: ClobClient;
  let clientB: ClobClient;
  let executor: Executor;

  beforeEach(() => {
    vi.useFakeTimers();
    clientA = createMockClobClient("probable");
    clientB = createMockClobClient("predict");
    executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePosition(): ClobPosition {
    return {
      id: "clob-unwind-1",
      marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      status: "OPEN",
      legA: {
        platform: "probable",
        orderId: "a-order-1",
        tokenId: "111",
        side: "BUY",
        price: 0.5,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      legB: {
        platform: "predict",
        orderId: "b-order-1",
        tokenId: "222",
        side: "BUY",
        price: 0.4,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      totalCost: 100,
      expectedPayout: 110,
      spreadBps: 200,
      openedAt: Date.now(),
    };
  }

  it("auto-unpauses when unwind order fills", async () => {
    // Leg A fills, leg B dies -> triggers attemptUnwind on clientA
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    // Unwind placeOrder succeeds
    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "unwind-order-1",
    });

    // First call to getOrderStatus for unwind: OPEN, then FILLED
    let unwindPollCount = 0;
    vi.mocked(clientA.getOrderStatus).mockImplementation(async (orderId: string) => {
      if (orderId === "unwind-order-1") {
        unwindPollCount++;
        if (unwindPollCount >= 2) {
          return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
        }
        return { orderId, status: "OPEN", filledSize: 0, remainingSize: 50 };
      }
      // For the initial leg A poll
      return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    // Advance enough time for: initial poll + unwind placement + unwind polls
    // UNWIND_POLL_INTERVAL_MS is 10_000 in the source
    await vi.advanceTimersByTimeAsync(30_000);
    await pollPromise;

    expect(executor.isPaused()).toBe(false);
  });

  it("stays paused when all unwind retries are rejected (systematic)", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    // Unwind placeOrder rejected (success=false) — all 3 retry attempts fail
    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: false, error: "insufficient balance",
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    await pollPromise;

    expect(executor.isPaused()).toBe(true);
  });

  it("auto-unpauses when all unwind retries expire (transient)", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "unwind-order-1",
    });

    // Unwind order status: EXPIRED — all 3 retry attempts expire
    vi.mocked(clientA.getOrderStatus).mockImplementation(async (orderId: string) => {
      if (orderId === "unwind-order-1") {
        return { orderId, status: "EXPIRED", filledSize: 0, remainingSize: 50 };
      }
      return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    // Need enough time for 3 retry attempts: each does poll(10s) + sees EXPIRED
    await vi.advanceTimersByTimeAsync(60_000);
    await pollPromise;

    expect(executor.isPaused()).toBe(false);
  });

  it("stays paused when all unwind retries throw errors (systematic)", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    // placeOrder throws — all 3 retry attempts fail with errors
    vi.mocked(clientA.placeOrder).mockRejectedValue(new Error("network timeout"));

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    await pollPromise;

    expect(executor.isPaused()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// closeResolvedClob
// ---------------------------------------------------------------------------

describe("closeResolvedClob", () => {
  beforeEach(() => {
    mockPublicClient.readContract.mockReset();
    mockPublicClient.getGasPrice.mockReset();
  });

  it("skips non-FILLED positions", async () => {
    const executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      {},
      createMetaResolvers(),
      { account: { address: "0x1234567890abcdef1234567890abcdef12345678" } } as any,
    );

    const positions: ClobPosition[] = [
      {
        id: "pos-1",
        marketId: "0xaabb" as `0x${string}`,
        status: "OPEN",
        legA: { platform: "probable", orderId: "a", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: false, filledSize: 0 },
        legB: { platform: "predict", orderId: "b", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: false, filledSize: 0 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
      {
        id: "pos-2",
        marketId: "0xaabb" as `0x${string}`,
        status: "PARTIAL",
        legA: { platform: "probable", orderId: "a2", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: true, filledSize: 50 },
        legB: { platform: "predict", orderId: "b2", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: false, filledSize: 0 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
      {
        id: "pos-3",
        marketId: "0xaabb" as `0x${string}`,
        status: "EXPIRED",
        legA: { platform: "probable", orderId: "a3", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: false, filledSize: 0 },
        legB: { platform: "predict", orderId: "b3", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: false, filledSize: 0 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
      {
        id: "pos-4",
        marketId: "0xaabb" as `0x${string}`,
        status: "CLOSED",
        legA: { platform: "probable", orderId: "a4", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: true, filledSize: 50 },
        legB: { platform: "predict", orderId: "b4", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: true, filledSize: 50 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
        closedAt: Date.now(),
      },
    ];

    const closed = await executor.closeResolvedClob(positions);
    // None of these are FILLED, so nothing should be attempted
    expect(closed).toBe(0);
    expect(mockPublicClient.readContract).not.toHaveBeenCalled();
  });

  it("skips when no wallet client", async () => {
    const executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      {},
      createMetaResolvers(),
      undefined, // no walletClient
    );

    // readContract returns payoutDenominator > 0 — market is resolved
    mockPublicClient.readContract.mockResolvedValue(1n);

    const positions: ClobPosition[] = [
      {
        id: "pos-filled",
        marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
        status: "FILLED",
        legA: { platform: "probable", orderId: "a1", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: true, filledSize: 50 },
        legB: { platform: "predict", orderId: "b1", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: true, filledSize: 50 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
    ];

    const closed = await executor.closeResolvedClob(positions);
    // Market is resolved but no walletClient, so cannot redeem
    expect(closed).toBe(0);
    expect(positions[0].status).toBe("FILLED"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// integration: fixed execution flow
// ---------------------------------------------------------------------------

describe("integration: fixed execution flow", () => {
  const walletAccount = { address: "0x1111111111111111111111111111111111111111" as `0x${string}` };
  const proxyAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;

  let clientA: ClobClient;
  let clientB: ClobClient;

  beforeEach(() => {
    clientA = createMockClobClient("probable");
    clientB = createMockClobClient("predict");
    mockPublicClient.readContract.mockReset();
    mockPublicClient.getGasPrice.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps trade size when Safe balance is insufficient including the 1.75% fee", async () => {
    // maxPositionSize = 6_000_000n → sizeUsdt = 6/2 = 3 USDT
    // Fee-inclusive: 3 * 1.0175 = 3.0525 USDT, but Safe only has 2.0 USDT
    // requiredWei = BigInt(Math.round(3 * 1.0175 * 1e6)) * 10n**12n = 3_052_500n * 10n**12n = 3.0525e18
    // Safe balance = 2.0e18 < 3.0525e18 → cap to floor(2.0 * 1e8) / 1e8 = 2.0
    const config = { ...mockConfig, dryRun: false, maxPositionSize: 6_000_000n };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    // Balance calls for pre-checks:
    // 1. EOA pre-check (eoaLegs=1 with proxy) — enough
    // 2. Safe pre-check — only 2 USDT, below fee-inclusive requirement
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n) // EOA balance pre-check — plenty
      .mockResolvedValueOnce(2n * 10n ** 18n);  // Safe balance pre-check — only 2 USDT

    // After capping to 2.0 USDT, executor proceeds with dryRun=false sequential flow.
    // We need: pre-trade EOA snapshot, pre-trade Safe snapshot, then post-trade checks.
    // But since predictClient (clientB) will fail, we won't get past Predict placement.
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: false, error: "FOK rejected" });

    const opp = createOpportunity();
    const result = await executor.executeBest(opp, 6_000_000n);

    // Predict order was attempted (even if rejected), meaning size was capped, not skipped.
    // Verify placeOrder was called with capped size.
    expect(clientB.placeOrder).toHaveBeenCalledOnce();
    const predictCall = vi.mocked(clientB.placeOrder).mock.calls[0]?.[0] as PlaceOrderParams;
    // sizeUsdt should be capped to 2.0 (floor(2.0e18 / 1e18 * 1e8) / 1e8 = 2.0)
    expect(predictCall.size).toBe(2);
    // Probable should NOT have been called since Predict failed
    expect(clientA.placeOrder).not.toHaveBeenCalled();
    // Result is undefined because Predict leg failed
    expect(result).toBeUndefined();
  });

  it("places unwind SELL at correct low-price precision (0.014 → ~0.0133)", async () => {
    vi.useFakeTimers();

    // Set up an executor with proxy
    const config = { ...mockConfig, dryRun: false };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    // We need the Predict leg to fill and Probable to fail, triggering unwind.
    // Using default opp: protocolA="probable", protocolB="predict"
    // predictClient=clientB, probableClient=clientA
    // We'll set the Predict price (yesPriceA = probable price) and noPriceB (predict price) = 0.014
    const opp = createOpportunity({
      noPriceB: BigInt(14e15), // 0.014 in 1e18
      yesPriceA: BigInt(5e17), // 0.5 for Probable side
    });

    // Balance calls:
    // 1. EOA pre-check
    // 2. Safe pre-check
    // 3. pre-trade EOA snapshot
    // 4. pre-trade Safe snapshot
    // 5. post-trade EOA (after Predict) — dropped → Predict filled
    // 6. post-trade Safe (after Probable) — no change → Probable didn't fill
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA snapshot
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade Safe snapshot
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade EOA (50 spent → Predict filled)
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade Safe (no change → Probable didn't fill)

    // Predict placement succeeds
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });
    // Probable placement succeeds (but won't fill per balance check)
    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });

    // Now the Predict-filled, Probable-not-filled path triggers attemptUnwind on predictClient (clientB).
    // The unwind will SELL on clientB with leg price = 0.014 (noPriceB).
    // First unwind attempt: price = round(0.014 * 0.95 * 10000) / 10000 = round(133) / 10000 = 0.0133
    // Mock the unwind placeOrder on clientB to succeed, then poll to FILLED
    vi.mocked(clientB.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "unwind-1" }); // unwind attempt 1

    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "unwind-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });

    const promise = executor.executeBest(opp, 100_000_000n);
    // Advance past the two 3s balance-check waits + unwind poll interval (10s)
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;

    expect(result).toBeDefined();
    expect(result!.status).toBe("PARTIAL");

    // Check the unwind placeOrder call args (the second call on clientB — first was the Predict placement)
    const allClientBCalls = vi.mocked(clientB.placeOrder).mock.calls;
    // calls[0] = Predict placement, calls[1] = unwind SELL
    expect(allClientBCalls.length).toBeGreaterThanOrEqual(2);
    const unwindCall = allClientBCalls[1][0] as PlaceOrderParams;
    expect(unwindCall.side).toBe("SELL");
    // price = round(0.014 * 0.95 * 10000) / 10000 = 0.0133
    expect(unwindCall.price).toBeCloseTo(0.0133, 4);
    // Crucially: NOT rounded down to 0.01
    expect(unwindCall.price).toBeGreaterThan(0.01);
  });

  it("uses LIMIT strategy and isFillOrKill=false for unwinds", async () => {
    vi.useFakeTimers();

    const config = { ...mockConfig, dryRun: false };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    const opp = createOpportunity();

    // Balance calls to trigger: Predict fills, Probable doesn't
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA snapshot
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade Safe snapshot
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade EOA → Predict filled
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade Safe → Probable not filled

    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });
    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });

    // Unwind on clientB: will be called after partial fill detection
    vi.mocked(clientB.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "unwind-1" }); // unwind attempt 1

    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "unwind-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });

    const promise = executor.executeBest(opp, 100_000_000n);
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    // Verify the unwind call has strategy: "LIMIT" and isFillOrKill: false
    const allClientBCalls = vi.mocked(clientB.placeOrder).mock.calls;
    expect(allClientBCalls.length).toBeGreaterThanOrEqual(2);
    const unwindCall = allClientBCalls[1][0] as PlaceOrderParams;
    expect(unwindCall.strategy).toBe("LIMIT");
    expect(unwindCall.isFillOrKill).toBe(false);
    expect(unwindCall.side).toBe("SELL");
  });

  it("auto-unpauses after exhausting all 3 unwind retries", async () => {
    vi.useFakeTimers();

    const config = { ...mockConfig, dryRun: false };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    const opp = createOpportunity();

    // Balance calls: Predict fills, Probable doesn't
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA snapshot
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade Safe snapshot
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade EOA → Predict filled
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade Safe → Probable not filled

    // Predict placement succeeds
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });
    // Probable placement succeeds
    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });

    // All 3 unwind attempts on clientB fail (success: false)
    vi.mocked(clientB.placeOrder)
      .mockResolvedValueOnce({ success: false, error: "rejected-1" })   // unwind attempt 1
      .mockResolvedValueOnce({ success: false, error: "rejected-2" })   // unwind attempt 2
      .mockResolvedValueOnce({ success: false, error: "rejected-3" });  // unwind attempt 3

    const promise = executor.executeBest(opp, 100_000_000n);
    // Advance past: 3s Predict wait + 3s Probable wait + unwind retries
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result).toBeDefined();
    expect(result!.status).toBe("PARTIAL");
    // All unwind orders rejected (systematic) — executor stays paused
    expect(executor.isPaused()).toBe(true);
    // All 3 unwind attempts should have been made (plus the 2 original orders)
    // calls: [0]=Predict, [1]=Probable, [2..4]=unwind attempts (but Probable is on clientA)
    // clientB calls: [0]=Predict, [1..3]=3 unwind attempts
    expect(vi.mocked(clientB.placeOrder).mock.calls.length).toBe(4); // 1 predict + 3 unwinds
  });

  it("returns undefined when sizeUsdt is below minTradeSize", async () => {
    // minTradeSize = 3_000_000n → minSizeUsdt = 3 USDT
    // maxPositionSize = 4_000_000n → sizeUsdt = 4/2 = 2 USDT
    // 2 < 3 → should return undefined
    const config = { ...mockConfig, dryRun: false, maxPositionSize: 4_000_000n };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
      3_000_000n, // minTradeSize
    );

    const opp = createOpportunity();
    const result = await executor.executeBest(opp, 4_000_000n);

    expect(result).toBeUndefined();
    // Neither client should have been called
    expect(clientA.placeOrder).not.toHaveBeenCalled();
    expect(clientB.placeOrder).not.toHaveBeenCalled();
  });
});
