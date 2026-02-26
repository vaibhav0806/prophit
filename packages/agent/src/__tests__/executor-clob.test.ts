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
    mockPublicClient.readContract.mockReset();
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

  it("returns void when Probable leg fails", async () => {
    // Default opportunity: protocolA="probable", protocolB="predict"
    // So probableClient = clientA. Mock it to fail.
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: false, error: "crash" });

    const result = await executor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
    // Predict (clientB) should never have been called
    expect(clientB.placeOrder).not.toHaveBeenCalled();
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
    // predictIsA=true, predictClient=clientB, probableClient=clientA
    // Step 1: Place Probable (clientA) → success
    // Step 2: Check Safe balance → dropped (Probable filled)
    // Step 3: Place Predict (clientB) → success
    // Step 4: Check EOA balance → not dropped (Predict didn't fill) → PARTIAL + pause

    // Balance calls:
    // 1. EOA balance pre-check (size cap) — for Predict leg, eoaLegs=1
    // 2. Safe balance pre-check (for Probable leg)
    // 3. pre-trade EOA snapshot
    // 4. pre-trade Safe snapshot
    // 5. post-trade Safe (after Probable) — dropped by 6 USDT = Probable filled
    // 6. post-trade EOA (after Predict) — no change = Predict didn't fill
    mockPublicClient.readContract
      .mockResolvedValueOnce(10n * 10n ** 18n)   // EOA balance pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // Safe balance pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade EOA snapshot
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade Safe snapshot
      .mockResolvedValueOnce(4n * 10n ** 18n)    // post-trade Safe (6 USDT spent → Probable filled!)
      .mockResolvedValueOnce(10n * 10n ** 18n);  // post-trade EOA (no change → Predict didn't fill)

    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "probable-1" })  // Probable leg (first)
      .mockResolvedValue({ success: false, error: "rejected" });         // all 3 unwind attempts fail
    vi.mocked(clientB.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "predict-1" }); // Predict placement (second)

    const opp = createOpportunity({ protocolA: "predict", protocolB: "probable" });
    const partialPromise = executorWithProxy.executeBest(opp, 100_000_000n);
    // Need to advance past two 3s waits (Probable check + Predict check) + unwind poll
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

    // In sequential flow, Probable (clientA) is called first, then Predict (clientB)
    const probableCall = vi.mocked(clientA.placeOrder).mock.calls[0]?.[0] as PlaceOrderParams;
    const predictCall = vi.mocked(clientB.placeOrder).mock.calls[0]?.[0] as PlaceOrderParams;
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
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: true, orderId: "probable-1" });
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: true, orderId: "predict-1" });

    // Sequential balance checks:
    // 1. EOA pre-check (size cap, eoaLegs=1 with proxy)
    // 2. Safe pre-check (for Probable leg)
    // 3. pre-trade EOA snapshot
    // 4. pre-trade Safe snapshot
    // 5. post-trade Safe (after Probable) — dropped by 6 USDT → Probable filled
    // 6. post-trade EOA (after Predict) — dropped by 6 USDT → Predict filled
    mockPublicClient.readContract
      .mockResolvedValueOnce(10n * 10n ** 18n)   // EOA pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // Safe pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade EOA snapshot
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade Safe snapshot
      .mockResolvedValueOnce(4n * 10n ** 18n)    // post-trade Safe (6 USDT spent)
      .mockResolvedValueOnce(4n * 10n ** 18n);   // post-trade EOA (6 USDT spent)

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

  it("skips Predict leg when Probable API returns filledQty=0", async () => {
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

    // Probable returns filledQty=0 — didn't fill, regardless of balance noise
    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "probable-1", filledQty: 0,
    });

    // Balance mocks for pre-checks only (no post-trade balance check needed)
    mockPublicClient.readContract
      .mockResolvedValueOnce(10n * 10n ** 18n)   // EOA pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // Safe pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade EOA snapshot
      .mockResolvedValueOnce(10n * 10n ** 18n);  // pre-trade Safe snapshot

    const opp = createOpportunity();
    const promise = executorWithProxy.executeBest(opp, 100_000_000n);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toBeDefined();
    const pos = result as ClobPosition;
    expect(pos.status).toBe("EXPIRED");
    // Predict leg should never have been called
    expect(clientB.placeOrder).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("proceeds to Predict when Probable API returns filledQty > 0", async () => {
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

    // Probable returns filledQty > 0 — filled via API, no balance check needed
    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "probable-1", filledQty: 4.5,
    });
    vi.mocked(clientB.placeOrder).mockResolvedValue({
      success: true, orderId: "predict-1",
    });

    // Balance mocks:
    // 1. EOA pre-check, 2. Safe pre-check,
    // 3. pre-trade EOA, 4. pre-trade Safe,
    // 5. post-trade EOA (Predict fill check — dropped by 6 USDT)
    mockPublicClient.readContract
      .mockResolvedValueOnce(10n * 10n ** 18n)   // EOA pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // Safe pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade EOA snapshot
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade Safe snapshot
      .mockResolvedValueOnce(4n * 10n ** 18n);   // post-trade EOA (6 USDT spent → Predict filled)

    const opp = createOpportunity();
    const promise = executorWithProxy.executeBest(opp, 100_000_000n);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result).toBeDefined();
    const pos = result as ClobPosition;
    expect(pos.status).toBe("FILLED");
    expect(clientB.placeOrder).toHaveBeenCalledOnce();

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

  it("auto-unpauses when all unwind retries expire (transient — order was live)", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "unwind-order-1",
    });

    // Unwind order: first poll returns OPEN (confirmed on book), then EXPIRED
    let unwindPollCount = 0;
    vi.mocked(clientA.getOrderStatus).mockImplementation(async (orderId: string) => {
      if (orderId === "unwind-order-1") {
        unwindPollCount++;
        if (unwindPollCount === 1) {
          return { orderId, status: "OPEN", filledSize: 0, remainingSize: 50 };
        }
        return { orderId, status: "EXPIRED", filledSize: 0, remainingSize: 50 };
      }
      return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    // Need enough time for 3 retry attempts: each does poll(10s) + sees OPEN then EXPIRED
    await vi.advanceTimersByTimeAsync(60_000);
    await pollPromise;

    expect(executor.isPaused()).toBe(false);
  });

  it("stays paused when unwind orders are immediately cancelled (not transient)", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "unwind-order-1",
    });

    // Unwind order: 404/CANCELLED immediately — never seen as OPEN
    vi.mocked(clientA.getOrderStatus).mockImplementation(async (orderId: string) => {
      if (orderId === "unwind-order-1") {
        return { orderId, status: "CANCELLED", filledSize: 0, remainingSize: 50 };
      }
      return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(60_000);
    await pollPromise;

    // Order was never confirmed on the book — systematic → stays paused
    expect(executor.isPaused()).toBe(true);
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

  it("caps trade size when Safe balance is insufficient including the fee buffer", async () => {
    // maxPositionSize = 6_000_000n → sizeUsdt = 6/2 = 3 USDT
    // Fee-inclusive: 3 * 1.02 = 3.06 USDT, but Safe only has 2.0 USDT
    // requiredWei = BigInt(Math.round(3 * 1.02 * 1e6)) * 10n**12n = 3.06e18
    // Safe balance = 2.0e18 < 3.06e18 → cap to floor(2.0 / 1.02 * 1e8) / 1e8 ≈ 1.96078431
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

    // After capping, executor proceeds with dryRun=false sequential flow.
    // Since probableClient (clientA) will fail, we won't get past Probable placement.
    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: false, error: "FOK rejected" });

    const opp = createOpportunity();
    const result = await executor.executeBest(opp, 6_000_000n);

    // Probable order was attempted (even if rejected), meaning size was capped, not skipped.
    expect(clientA.placeOrder).toHaveBeenCalledOnce();
    const probableCall = vi.mocked(clientA.placeOrder).mock.calls[0]?.[0] as PlaceOrderParams;
    // sizeUsdt = floor(2.0 / 1.02 * 1e8) / 1e8 ≈ 1.96078431
    expect(probableCall.size).toBeCloseTo(1.9608, 3);
    // Predict should NOT have been called since Probable failed
    expect(clientB.placeOrder).not.toHaveBeenCalled();
    // Result is undefined because Probable leg failed
    expect(result).toBeUndefined();
  });

  it("places unwind SELL at correct low-price precision (0.014 → ~0.013)", async () => {
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

    // We need the Probable leg to fill and Predict to fail, triggering unwind of Probable.
    // Using default opp: protocolA="probable", protocolB="predict"
    // predictClient=clientB, probableClient=clientA
    // We'll set yesPriceA (probable price) = 0.014 to test low-price precision in unwind
    const opp = createOpportunity({
      yesPriceA: BigInt(14e15), // 0.014 in 1e18 for Probable side
      noPriceB: BigInt(5e17),   // 0.5 for Predict side
    });

    // Balance calls:
    // 1. EOA pre-check
    // 2. Safe pre-check
    // 3. pre-trade EOA snapshot
    // 4. pre-trade Safe snapshot
    // 5. post-trade Safe (after Probable) — dropped → Probable filled
    // 6. post-trade EOA (after Predict) — no change → Predict didn't fill
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA snapshot
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade Safe snapshot
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade Safe (50 spent → Probable filled)
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade EOA (no change → Predict didn't fill)

    // Probable placement succeeds
    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });
    // Predict placement succeeds (but won't fill per balance check)
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });

    // Now the Probable-filled, Predict-not-filled path triggers attemptUnwind on probableClient (clientA).
    // The unwind will SELL on clientA with leg price = 0.014 (yesPriceA).
    // First unwind attempt: price = round(0.014 * 0.95 * 1000) / 1000 = round(13.3) / 1000 = 0.013
    // Mock the unwind placeOrder on clientA to succeed, then poll to FILLED
    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "unwind-1" }); // unwind attempt 1

    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "unwind-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });

    const promise = executor.executeBest(opp, 100_000_000n);
    // Advance past the two 3s balance-check waits + unwind poll interval (10s)
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;

    expect(result).toBeDefined();
    expect(result!.status).toBe("PARTIAL");

    // Check the unwind placeOrder call args (the second call on clientA — first was the Probable placement)
    const allClientACalls = vi.mocked(clientA.placeOrder).mock.calls;
    // calls[0] = Probable placement, calls[1] = unwind SELL
    expect(allClientACalls.length).toBeGreaterThanOrEqual(2);
    const unwindCall = allClientACalls[1][0] as PlaceOrderParams;
    expect(unwindCall.side).toBe("SELL");
    // price = round(0.014 * 0.95 * 1000) / 1000 = 0.013
    expect(unwindCall.price).toBeCloseTo(0.013, 3);
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

    // Balance calls to trigger: Probable fills, Predict doesn't
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA snapshot
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade Safe snapshot
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade Safe → Probable filled
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade EOA → Predict not filled

    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });

    // Unwind on clientA: will be called after partial fill detection
    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "unwind-1" }); // unwind attempt 1

    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "unwind-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });

    const promise = executor.executeBest(opp, 100_000_000n);
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    // Verify the unwind call has strategy: "LIMIT" and isFillOrKill: false
    const allClientACalls = vi.mocked(clientA.placeOrder).mock.calls;
    expect(allClientACalls.length).toBeGreaterThanOrEqual(2);
    const unwindCall = allClientACalls[1][0] as PlaceOrderParams;
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

    // Balance calls: Probable fills, Predict doesn't
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA snapshot
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade Safe snapshot
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade Safe → Probable filled
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade EOA → Predict not filled

    // Probable placement succeeds
    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });
    // Predict placement succeeds
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });

    // All 3 unwind attempts on clientA fail (success: false)
    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: false, error: "rejected-1" })   // unwind attempt 1
      .mockResolvedValueOnce({ success: false, error: "rejected-2" })   // unwind attempt 2
      .mockResolvedValueOnce({ success: false, error: "rejected-3" });  // unwind attempt 3

    const promise = executor.executeBest(opp, 100_000_000n);
    // Advance past: 3s Probable wait + 3s Predict wait + unwind retries
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result).toBeDefined();
    expect(result!.status).toBe("PARTIAL");
    // All unwind orders rejected (systematic) — executor stays paused
    expect(executor.isPaused()).toBe(true);
    // All 3 unwind attempts should have been made (plus the 2 original orders)
    // clientA calls: [0]=Probable, [1..3]=3 unwind attempts
    expect(vi.mocked(clientA.placeOrder).mock.calls.length).toBe(4); // 1 probable + 3 unwinds
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

  it("unwind SELL size reflects actual shares, not USDT amount (Bug 4 regression)", async () => {
    vi.useFakeTimers();

    // Reproduce incident #2: BUY at $0.32 for $4 USDT → 12.5 shares.
    // Unwind SELL at 5% discount ($0.304) should sell 12.5 shares for $3.80,
    // NOT try to sell $4/$0.304 = 13.16 shares (which exceeds holdings).
    // maxPositionSize = 8M → sizeUsdt = 8M/2/1e6 = 4 USDT per leg
    const config = { ...mockConfig, dryRun: false };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    const buyPrice = 0.32;
    const sizeUsdt = 4;
    const opp = createOpportunity({
      yesPriceA: BigInt(buyPrice * 1e18), // Probable price = 0.32 (unwind target)
      noPriceB: BigInt(5e17), // Predict = 0.5
    });

    // Balance: Probable fills, Predict doesn't
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade EOA (10 USDT)
      .mockResolvedValueOnce(10n * 10n ** 18n)   // pre-trade Safe (10 USDT)
      .mockResolvedValueOnce(6n * 10n ** 18n)    // post-trade Safe (4 USDT spent → Probable filled)
      .mockResolvedValueOnce(10n * 10n ** 18n);  // post-trade EOA (no change → Predict not filled)

    vi.mocked(clientA.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });

    // All 3 unwind attempts on clientA: reject to inspect all sizes
    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: false, error: "rejected-1" })
      .mockResolvedValueOnce({ success: false, error: "rejected-2" })
      .mockResolvedValueOnce({ success: false, error: "rejected-3" });

    const promise = executor.executeBest(opp, 8_000_000n); // 8M → 4 USDT per leg
    await vi.advanceTimersByTimeAsync(15_000);
    await promise;

    // clientA calls: [0]=Probable, [1..3]=3 unwind SELLs
    const calls = vi.mocked(clientA.placeOrder).mock.calls;
    expect(calls.length).toBe(4);

    // Verify the Probable BUY used the expected size
    const probableCall = calls[0][0] as PlaceOrderParams;
    expect(probableCall.side).toBe("BUY");
    expect(probableCall.size).toBe(sizeUsdt);

    // Unwind attempt 1: 5% discount → price = round(0.32 * 0.95 * 1000)/1000 = 0.304
    const unwind1 = calls[1][0] as PlaceOrderParams;
    expect(unwind1.side).toBe("SELL");
    expect(unwind1.price).toBeCloseTo(0.304, 3);
    // size = actualShares * sellPrice = (4/0.32) * 0.304 = 12.5 * 0.304 = 3.80
    const actualShares = sizeUsdt / buyPrice; // 12.5
    expect(unwind1.size).toBeCloseTo(actualShares * 0.304, 4);
    // CRITICAL: size/price should equal actualShares, NOT exceed them
    expect(unwind1.size / unwind1.price).toBeCloseTo(actualShares, 1);

    // Unwind attempt 2: 10% discount → price = 0.288
    const unwind2 = calls[2][0] as PlaceOrderParams;
    expect(unwind2.price).toBeCloseTo(0.288, 3);
    expect(unwind2.size / unwind2.price).toBeCloseTo(actualShares, 1);

    // Unwind attempt 3: 20% discount → price = 0.256
    const unwind3 = calls[3][0] as PlaceOrderParams;
    expect(unwind3.price).toBeCloseTo(0.256, 3);
    expect(unwind3.size / unwind3.price).toBeCloseTo(actualShares, 1);

    vi.useRealTimers();
  });

  it("initial cooldowns prevent execution on cooled markets", async () => {
    const cooldowns = new Map<string, number>();
    const marketId = "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`;
    cooldowns.set(marketId, Date.now() + 30 * 60 * 1000); // 30 min from now

    const config = { ...mockConfig, dryRun: false };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
      undefined,
      cooldowns,
    );

    const opp = createOpportunity();
    const result = await executor.executeBest(opp, 100_000_000n);

    expect(result).toBeUndefined();
    expect(clientA.placeOrder).not.toHaveBeenCalled();
    expect(clientB.placeOrder).not.toHaveBeenCalled();
  });

  it("getAvailableBalance caps shares in unwind", async () => {
    vi.useFakeTimers();

    const proxyAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;
    const walletAccount = { address: "0x1111111111111111111111111111111111111111" as `0x${string}` };

    // Add getAvailableBalance to probable client — returns less than expected
    const probableClient = createMockClobClient("probable");
    (probableClient as any).getAvailableBalance = vi.fn().mockResolvedValue(10); // only 10 shares available

    const config = { ...mockConfig, dryRun: false };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: probableClient, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    const buyPrice = 0.32;
    const opp = createOpportunity({
      yesPriceA: BigInt(buyPrice * 1e18), // Probable price = 0.32 (unwind target)
      noPriceB: BigInt(5e17),
    });

    // Balance: Probable fills, Predict fails
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // Safe pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade Safe
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade Safe → Probable filled
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade EOA → Predict not filled

    vi.mocked(probableClient.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });

    // Unwind on probableClient: reject all to inspect sizes
    vi.mocked(probableClient.placeOrder)
      .mockResolvedValueOnce({ success: false, error: "rejected-1" })
      .mockResolvedValueOnce({ success: false, error: "rejected-2" })
      .mockResolvedValueOnce({ success: false, error: "rejected-3" });

    const promise = executor.executeBest(opp, 8_000_000n);
    await vi.advanceTimersByTimeAsync(15_000);
    await promise;

    // Expected: 4/0.32 = 12.5 shares, but capped to 10 (available)
    const calls = vi.mocked(probableClient.placeOrder).mock.calls;
    // calls[0]=Probable BUY, calls[1..3]=unwind SELLs
    const unwind1 = calls[1][0] as PlaceOrderParams;
    expect(unwind1.side).toBe("SELL");
    // size/price should give ~10 shares (available), not 12.5
    expect(unwind1.size / unwind1.price).toBeCloseTo(10, 1);

    vi.useRealTimers();
  });

  it("getAvailableBalance returning 0 skips unwind entirely", async () => {
    vi.useFakeTimers();

    const proxyAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;
    const walletAccount = { address: "0x1111111111111111111111111111111111111111" as `0x${string}` };

    const probableClient = createMockClobClient("probable");
    (probableClient as any).getAvailableBalance = vi.fn().mockResolvedValue(0); // no available shares

    const config = { ...mockConfig, dryRun: false };
    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { probable: probableClient, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: walletAccount } as any,
    );

    const opp = createOpportunity();

    // Balance: Probable fills, Predict fails
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(50n * 10n ** 18n)   // post-trade Safe → Probable filled
      .mockResolvedValueOnce(100n * 10n ** 18n); // post-trade EOA → Predict not filled

    vi.mocked(probableClient.placeOrder).mockResolvedValueOnce({ success: true, orderId: "probable-1" });
    vi.mocked(clientB.placeOrder).mockResolvedValueOnce({ success: true, orderId: "predict-1" });

    const promise = executor.executeBest(opp, 100_000_000n);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result).toBeDefined();
    expect(result!.status).toBe("PARTIAL");

    // Should NOT have placed any unwind orders — only 1 call (Probable BUY)
    // probableClient calls: [0]=Probable BUY, NO unwind calls
    expect(vi.mocked(probableClient.placeOrder).mock.calls.length).toBe(1); // only the initial Probable order

    vi.useRealTimers();
  });

  it("skips markets on cooldown after Predict failure (Bug 5)", async () => {
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

    // First trade: Probable fills, Predict fails → cooldown set
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(100n * 10n ** 18n)
      .mockResolvedValueOnce(50n * 10n ** 18n)   // Safe spent → Probable filled
      .mockResolvedValueOnce(100n * 10n ** 18n); // EOA unchanged → Predict not filled

    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "probable-1" })  // Probable
      .mockResolvedValueOnce({ success: false, error: "rejected" })     // unwind 1
      .mockResolvedValueOnce({ success: false, error: "rejected" })     // unwind 2
      .mockResolvedValueOnce({ success: false, error: "rejected" });    // unwind 3
    vi.mocked(clientB.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "predict-1" }); // Predict (doesn't fill)

    const opp = createOpportunity();
    const p1 = executor.executeBest(opp, 100_000_000n);
    await vi.advanceTimersByTimeAsync(15_000);
    await p1;

    // Unpause for testing (executor stays paused from systematic failure)
    executor.unpause();

    // Second trade: same market → should be skipped due to cooldown
    const result2 = await executor.executeBest(opp, 100_000_000n);
    expect(result2).toBeUndefined();
    // No new placeOrder calls beyond the first trade
    expect(vi.mocked(clientA.placeOrder).mock.calls.length).toBe(4); // unchanged from first trade

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Opinion + Predict pair (no Safe proxy, both EOA)
// ---------------------------------------------------------------------------

describe("executeClob with Opinion + Predict", () => {
  let opinionClient: ClobClient;
  let predictClient: ClobClient;

  beforeEach(() => {
    mockPublicClient.readContract.mockReset();
    opinionClient = createMockClobClient("opinion");
    predictClient = createMockClobClient("predict");
  });

  function createOpinionMetaResolvers() {
    const resolver = { getMarketMeta: vi.fn().mockReturnValue(mockMeta) };
    return new Map<string, typeof resolver>([
      ["Opinion", resolver],
      ["Predict", resolver],
    ]);
  }

  it("getClobClient resolves opinion client", async () => {
    const dryRunConfig = { ...mockConfig, dryRun: true };
    const executor = new Executor(
      undefined,
      dryRunConfig,
      mockPublicClient,
      { opinion: opinionClient, predict: predictClient },
      createOpinionMetaResolvers(),
      undefined,
    );

    const opp = createOpportunity({
      protocolA: "Opinion",
      protocolB: "Predict",
    });
    const result = await executor.executeBest(opp, 100_000_000n);

    expect(result).toBeDefined();
    const pos = result as ClobPosition;
    expect(pos.status).toBe("FILLED");
    expect(opinionClient.placeOrder).toHaveBeenCalled();
    expect(predictClient.placeOrder).toHaveBeenCalled();
  });

  it("Opinion + Predict pair with no Safe proxy uses EOA for both legs", async () => {
    const walletAccount = { address: "0x1111111111111111111111111111111111111111" as `0x${string}` };
    const config = { ...mockConfig, dryRun: false };

    const executor = new Executor(
      undefined,
      config,
      mockPublicClient,
      { opinion: opinionClient, predict: predictClient },
      createOpinionMetaResolvers(),
      { account: walletAccount } as any,
    );

    // No probableProxyAddress → eoaLegs = 2
    // EOA balance must cover both legs
    mockPublicClient.readContract
      .mockResolvedValueOnce(100n * 10n ** 18n)  // EOA pre-check
      .mockResolvedValueOnce(100n * 10n ** 18n)  // pre-trade EOA
      .mockResolvedValueOnce(50n * 10n ** 18n);  // post-trade EOA (first leg filled)

    vi.mocked(opinionClient.placeOrder).mockResolvedValueOnce({
      success: true, orderId: "opinion-1", filledQty: 10,
    });
    vi.mocked(predictClient.placeOrder).mockResolvedValueOnce({
      success: true, orderId: "predict-1", status: "FILLED",
    });

    const opp = createOpportunity({
      protocolA: "Opinion",
      protocolB: "Predict",
    });

    const result = await executor.executeBest(opp, 100_000_000n);

    expect(result).toBeDefined();
    expect(opinionClient.placeOrder).toHaveBeenCalled();
    expect(predictClient.placeOrder).toHaveBeenCalled();
  });
});
