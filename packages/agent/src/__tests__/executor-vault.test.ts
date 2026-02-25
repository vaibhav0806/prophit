import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../execution/executor.js";
import type { ArbitOpportunity, Position } from "../types.js";

vi.mock("../logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../retry.js", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE = 10n ** 18n;

function createOpportunity(overrides?: Partial<ArbitOpportunity>): ArbitOpportunity {
  return {
    marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    protocolA: "probable",
    protocolB: "predict",
    buyYesOnA: true,
    yesPriceA: (ONE * 40n) / 100n, // 0.40
    noPriceB: (ONE * 30n) / 100n,  // 0.30
    totalCost: (ONE * 70n) / 100n,
    guaranteedPayout: ONE,
    spreadBps: 3000,
    grossSpreadBps: 3000,
    feesDeducted: 0n,
    estProfit: 30_000_000n, // 30 USDT
    liquidityA: 500_000_000n, // 500 USDT
    liquidityB: 500_000_000n,
    ...overrides,
  };
}

function createMockVaultClient() {
  return {
    openPosition: vi.fn().mockResolvedValue(1n),
    closePosition: vi.fn().mockResolvedValue(1_000_000n),
    getVaultBalance: vi.fn().mockResolvedValue(10_000_000_000n), // 10k USDT
    getPosition: vi.fn(),
    getPositionCount: vi.fn(),
    getAllPositions: vi.fn(),
    publicClient: {
      getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n), // 5 gwei
    },
  } as any;
}

function createConfig(overrides?: Record<string, any>) {
  return {
    executionMode: "vault" as const,
    adapterAAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
    adapterBAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`,
    marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    gasToUsdtRate: 3_000_000_000n, // $3000
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
// Tests
// ---------------------------------------------------------------------------

describe("Executor — vault mode", () => {
  let vaultClient: ReturnType<typeof createMockVaultClient>;
  let config: ReturnType<typeof createConfig>;
  let publicClient: ReturnType<typeof createPublicClient>;

  beforeEach(() => {
    vaultClient = createMockVaultClient();
    config = createConfig();
    publicClient = createPublicClient();
  });

  it("routes to vault mode when executionMode is vault", async () => {
    const executor = new Executor(vaultClient, config, publicClient);
    const opp = createOpportunity();

    await executor.executeBest(opp, 1_000_000_000n);
    expect(vaultClient.openPosition).toHaveBeenCalled();
  });

  it("skips when executor is paused", async () => {
    const executor = new Executor(vaultClient, config, publicClient);
    // Force pause by accessing private field
    (executor as any).paused = true;

    await executor.executeBest(createOpportunity(), 1_000_000_000n);
    expect(vaultClient.openPosition).not.toHaveBeenCalled();
  });

  it("logs error when vault mode but no vaultClient", async () => {
    const executor = new Executor(undefined, config, publicClient);
    await executor.executeBest(createOpportunity(), 1_000_000_000n);
    // Should not throw, just log error
  });

  it("caps position size to liquidity on A (90%)", async () => {
    const opp = createOpportunity({ liquidityA: 100_000n }); // 0.1 USDT
    const executor = new Executor(vaultClient, config, publicClient);

    await executor.executeBest(opp, 1_000_000_000n); // 1000 USDT max

    const call = vaultClient.openPosition.mock.calls[0][0];
    // amountPerSide should be capped: 100_000 * 90 / 100 = 90_000
    expect(call.amountA).toBe(90_000n);
    expect(call.amountB).toBe(90_000n);
  });

  it("caps position size to liquidity on B (90%)", async () => {
    const opp = createOpportunity({ liquidityB: 200_000n }); // 0.2 USDT
    const executor = new Executor(vaultClient, config, publicClient);

    await executor.executeBest(opp, 1_000_000_000n);

    const call = vaultClient.openPosition.mock.calls[0][0];
    expect(call.amountA).toBe(180_000n); // 200_000 * 90% = 180_000
  });

  it("skips when liquidity is too low (0 after 90% cap)", async () => {
    const opp = createOpportunity({ liquidityA: 1n }); // nearly 0
    const executor = new Executor(vaultClient, config, publicClient);

    await executor.executeBest(opp, 1_000_000_000n);
    expect(vaultClient.openPosition).not.toHaveBeenCalled();
  });

  it("skips when vault balance is insufficient", async () => {
    vaultClient.getVaultBalance.mockResolvedValue(100n); // almost nothing
    const executor = new Executor(vaultClient, config, publicClient);

    await executor.executeBest(createOpportunity(), 1_000_000_000n);
    expect(vaultClient.openPosition).not.toHaveBeenCalled();
  });

  it("skips when trade is unprofitable after gas", async () => {
    // estProfit = 30 USDT, gas cost: 5gwei * 400k = 2e15 wei
    // gasToUsdtRate = $3000/1e18 => gasCostUsdt = 2e15 * 3e9 / 1e18 = 6e6 = 6 USDT
    // 30 > 6 so normally profitable. Set estProfit low to trigger skip.
    const opp = createOpportunity({ estProfit: 1_000n }); // 0.001 USDT
    const executor = new Executor(vaultClient, config, publicClient);

    await executor.executeBest(opp, 1_000_000_000n);
    expect(vaultClient.openPosition).not.toHaveBeenCalled();
  });

  it("proceeds when gas estimation fails", async () => {
    vaultClient.publicClient.getGasPrice.mockRejectedValue(new Error("RPC down"));
    const executor = new Executor(vaultClient, config, publicClient);

    await executor.executeBest(createOpportunity(), 1_000_000_000n);
    expect(vaultClient.openPosition).toHaveBeenCalled();
  });

  it("calculates slippage-protected minShares (95%)", async () => {
    const executor = new Executor(vaultClient, config, publicClient);
    const opp = createOpportunity();

    await executor.executeBest(opp, 1_000_000_000n);

    const call = vaultClient.openPosition.mock.calls[0][0];
    // amountPerSide = 500_000_000
    // minSharesA = (500_000_000 * 1e18 / 0.4e18) * 95/100 = 1_250_000_000 * 95/100 = 1_187_500_000
    expect(call.minSharesA).toBe(1_187_500_000n);
  });

  it("passes correct params to vaultClient.openPosition", async () => {
    const executor = new Executor(vaultClient, config, publicClient);
    const opp = createOpportunity();

    await executor.executeBest(opp, 1_000_000_000n);

    const call = vaultClient.openPosition.mock.calls[0][0];
    expect(call.adapterA).toBe(config.adapterAAddress);
    expect(call.adapterB).toBe(config.adapterBAddress);
    expect(call.marketIdA).toBe(config.marketId);
    expect(call.buyYesOnA).toBe(true);
  });

  it("re-throws openPosition errors", async () => {
    vaultClient.openPosition.mockRejectedValue(new Error("Contract reverted"));
    const executor = new Executor(vaultClient, config, publicClient);

    await expect(executor.executeBest(createOpportunity(), 1_000_000_000n))
      .rejects.toThrow("Contract reverted");
  });
});

// ---------------------------------------------------------------------------
// closeResolved (vault mode)
// ---------------------------------------------------------------------------

describe("Executor.closeResolved", () => {
  it("closes positions when both sides are resolved", async () => {
    const vaultClient = createMockVaultClient();
    const publicClient = createPublicClient();
    publicClient.readContract.mockResolvedValue(true); // isResolved = true for both

    const executor = new Executor(vaultClient, createConfig(), publicClient);
    const positions: Position[] = [{
      positionId: 0,
      adapterA: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      adapterB: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      marketIdA: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      marketIdB: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      boughtYesOnA: true,
      sharesA: ONE,
      sharesB: ONE,
      costA: 500_000n,
      costB: 500_000n,
      openedAt: BigInt(Math.floor(Date.now() / 1000)),
      closed: false,
    }];

    const closed = await executor.closeResolved(positions);
    expect(closed).toBe(1);
    expect(vaultClient.closePosition).toHaveBeenCalledWith(0, 0n);
  });

  it("skips when only one side is resolved", async () => {
    const vaultClient = createMockVaultClient();
    const publicClient = createPublicClient();
    let callIdx = 0;
    publicClient.readContract.mockImplementation(async () => {
      callIdx++;
      return callIdx === 1; // first call true, second false
    });

    const executor = new Executor(vaultClient, createConfig(), publicClient);
    const positions: Position[] = [{
      positionId: 0,
      adapterA: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      adapterB: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      marketIdA: "0x01" as `0x${string}`,
      marketIdB: "0x01" as `0x${string}`,
      boughtYesOnA: true,
      sharesA: ONE, sharesB: ONE, costA: 500_000n, costB: 500_000n,
      openedAt: 1700000000n, closed: false,
    }];

    const closed = await executor.closeResolved(positions);
    expect(closed).toBe(0);
    expect(vaultClient.closePosition).not.toHaveBeenCalled();
  });

  it("skips already closed positions", async () => {
    const vaultClient = createMockVaultClient();
    const publicClient = createPublicClient();

    const executor = new Executor(vaultClient, createConfig(), publicClient);
    const positions: Position[] = [{
      positionId: 0,
      adapterA: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      adapterB: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      marketIdA: "0x01" as `0x${string}`,
      marketIdB: "0x01" as `0x${string}`,
      boughtYesOnA: true,
      sharesA: ONE, sharesB: ONE, costA: 500_000n, costB: 500_000n,
      openedAt: 1700000000n, closed: true,
    }];

    const closed = await executor.closeResolved(positions);
    expect(closed).toBe(0);
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it("handles errors per position without crashing", async () => {
    const vaultClient = createMockVaultClient();
    const publicClient = createPublicClient();
    publicClient.readContract.mockRejectedValue(new Error("RPC error"));

    const executor = new Executor(vaultClient, createConfig(), publicClient);
    const positions: Position[] = [{
      positionId: 0,
      adapterA: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      adapterB: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      marketIdA: "0x01" as `0x${string}`,
      marketIdB: "0x01" as `0x${string}`,
      boughtYesOnA: true,
      sharesA: ONE, sharesB: ONE, costA: 500_000n, costB: 500_000n,
      openedAt: 1700000000n, closed: false,
    }];

    const closed = await executor.closeResolved(positions);
    expect(closed).toBe(0); // error caught, not thrown
  });
});

// ---------------------------------------------------------------------------
// Pause / unpause
// ---------------------------------------------------------------------------

describe("Executor pause/unpause", () => {
  it("isPaused returns false initially", () => {
    const executor = new Executor(undefined, createConfig(), createPublicClient());
    expect(executor.isPaused()).toBe(false);
  });

  it("unpause clears paused state", () => {
    const executor = new Executor(undefined, createConfig(), createPublicClient());
    (executor as any).paused = true;
    expect(executor.isPaused()).toBe(true);
    executor.unpause();
    expect(executor.isPaused()).toBe(false);
  });
});
