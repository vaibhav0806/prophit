import { describe, it, expect, vi } from "vitest";
import { VaultClient } from "../execution/vault-client.js";

vi.mock("../logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../retry.js", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

const VAULT = "0x0000000000000000000000000000000000000099" as `0x${string}`;
const ADAPTER_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const ADAPTER_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
const MKT_ID = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

function createMocks(opts?: { simulateError?: boolean; receiptStatus?: string; noEvent?: boolean }) {
  const publicClient = {
    simulateContract: opts?.simulateError
      ? vi.fn().mockRejectedValue(new Error("Simulation failed"))
      : vi.fn().mockResolvedValue({ request: { mock: true } }),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      status: opts?.receiptStatus ?? "success",
      transactionHash: "0xtxhash",
      logs: opts?.noEvent ? [] : [{
        // Simulate a PositionOpened/PositionClosed event log
        topics: [
          "0x0000000000000000000000000000000000000000000000000000000000000000", // event sig (fake)
          "0x0000000000000000000000000000000000000000000000000000000000000042", // positionId = 66
        ],
        data: "0x",
        address: VAULT,
      }],
    }),
    readContract: vi.fn(),
    getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n),
  } as any;

  const walletClient = {
    account: { address: "0x1111111111111111111111111111111111111111" as `0x${string}` },
    writeContract: vi.fn().mockResolvedValue("0xtxhash"),
  } as any;

  return { publicClient, walletClient };
}

describe("VaultClient", () => {
  describe("getVaultBalance", () => {
    it("returns vault balance from readContract", async () => {
      const { publicClient, walletClient } = createMocks();
      publicClient.readContract.mockResolvedValue(1_000_000_000n);

      const client = new VaultClient(walletClient, publicClient, VAULT);
      const balance = await client.getVaultBalance();
      expect(balance).toBe(1_000_000_000n);
    });
  });

  describe("getPositionCount", () => {
    it("returns position count", async () => {
      const { publicClient, walletClient } = createMocks();
      publicClient.readContract.mockResolvedValue(5n);

      const client = new VaultClient(walletClient, publicClient, VAULT);
      const count = await client.getPositionCount();
      expect(count).toBe(5n);
    });
  });

  describe("getPosition", () => {
    it("returns parsed position", async () => {
      const { publicClient, walletClient } = createMocks();
      publicClient.readContract.mockResolvedValue({
        adapterA: ADAPTER_A,
        adapterB: ADAPTER_B,
        marketIdA: MKT_ID,
        marketIdB: MKT_ID,
        boughtYesOnA: true,
        sharesA: 1000n,
        sharesB: 1000n,
        costA: 500n,
        costB: 500n,
        openedAt: 1700000000n,
        closed: false,
      });

      const client = new VaultClient(walletClient, publicClient, VAULT);
      const pos = await client.getPosition(0);

      expect(pos.positionId).toBe(0);
      expect(pos.adapterA).toBe(ADAPTER_A);
      expect(pos.boughtYesOnA).toBe(true);
      expect(pos.closed).toBe(false);
    });
  });

  describe("getAllPositions", () => {
    it("returns empty array when count is 0", async () => {
      const { publicClient, walletClient } = createMocks();
      publicClient.readContract.mockResolvedValue(0n);

      const client = new VaultClient(walletClient, publicClient, VAULT);
      const positions = await client.getAllPositions();
      expect(positions).toEqual([]);
    });

    it("fetches all positions up to count", async () => {
      const { publicClient, walletClient } = createMocks();
      let callCount = 0;
      publicClient.readContract.mockImplementation(async (args: any) => {
        if (args.functionName === "positionCount") return 2n;
        callCount++;
        return {
          adapterA: ADAPTER_A, adapterB: ADAPTER_B,
          marketIdA: MKT_ID, marketIdB: MKT_ID,
          boughtYesOnA: true, sharesA: 1000n, sharesB: 1000n,
          costA: 500n, costB: 500n, openedAt: 1700000000n, closed: false,
        };
      });

      const client = new VaultClient(walletClient, publicClient, VAULT);
      const positions = await client.getAllPositions();
      expect(positions).toHaveLength(2);
    });
  });

  describe("openPosition", () => {
    it("simulates, writes, and waits for receipt", async () => {
      const { publicClient, walletClient } = createMocks();

      const client = new VaultClient(walletClient, publicClient, VAULT);

      // The real openPosition uses parseEventLogs which needs real ABI event decoding.
      // We test the contract interaction flow — simulate → write → waitForReceipt.
      // The actual event parsing would need properly encoded logs, so we test the
      // error path when no event is found.
      await expect(client.openPosition({
        adapterA: ADAPTER_A,
        adapterB: ADAPTER_B,
        marketIdA: MKT_ID,
        marketIdB: MKT_ID,
        buyYesOnA: true,
        amountA: 500n,
        amountB: 500n,
        minSharesA: 400n,
        minSharesB: 400n,
      })).rejects.toThrow("PositionOpened event not found");

      expect(publicClient.simulateContract).toHaveBeenCalled();
      expect(walletClient.writeContract).toHaveBeenCalled();
      expect(publicClient.waitForTransactionReceipt).toHaveBeenCalled();
    });

    it("throws on simulation failure", async () => {
      const { publicClient, walletClient } = createMocks({ simulateError: true });

      const client = new VaultClient(walletClient, publicClient, VAULT);
      await expect(client.openPosition({
        adapterA: ADAPTER_A, adapterB: ADAPTER_B,
        marketIdA: MKT_ID, marketIdB: MKT_ID,
        buyYesOnA: true,
        amountA: 500n, amountB: 500n, minSharesA: 0n, minSharesB: 0n,
      })).rejects.toThrow("Simulation failed");
    });

    it("throws on reverted receipt", async () => {
      const { publicClient, walletClient } = createMocks({ receiptStatus: "reverted" });

      const client = new VaultClient(walletClient, publicClient, VAULT);
      await expect(client.openPosition({
        adapterA: ADAPTER_A, adapterB: ADAPTER_B,
        marketIdA: MKT_ID, marketIdB: MKT_ID,
        buyYesOnA: true,
        amountA: 500n, amountB: 500n, minSharesA: 0n, minSharesB: 0n,
      })).rejects.toThrow("Transaction reverted");
    });
  });

  describe("closePosition", () => {
    it("simulates, writes, and waits for receipt", async () => {
      const { publicClient, walletClient } = createMocks();

      const client = new VaultClient(walletClient, publicClient, VAULT);
      // Same as openPosition — event parsing needs real encoded logs
      await expect(client.closePosition(1, 0n))
        .rejects.toThrow("PositionClosed event not found");

      expect(publicClient.simulateContract).toHaveBeenCalled();
      expect(walletClient.writeContract).toHaveBeenCalled();
    });

    it("throws on reverted receipt", async () => {
      const { publicClient, walletClient } = createMocks({ receiptStatus: "reverted" });

      const client = new VaultClient(walletClient, publicClient, VAULT);
      await expect(client.closePosition(1, 0n)).rejects.toThrow("Transaction reverted");
    });
  });
});
