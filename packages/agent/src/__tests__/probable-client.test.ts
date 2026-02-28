import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProbableClobClient } from "../clob/probable-client.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAccount = {
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
};

const mockWalletClient = {
  account: mockAccount,
  signTypedData: vi.fn().mockResolvedValue("0xmocktypedsig"),
  writeContract: vi.fn().mockResolvedValue("0xmocktxhash" as `0x${string}`),
  chain: { id: 56 },
} as any;

const mockPublicClient = {
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: 100n }),
} as any;

const EXCHANGE = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as `0x${string}`;
const API_BASE = "https://api.probable.test";
const CHAIN_ID = 56;

const AUTH_RESPONSE = {
  apiKey: "pk_test_key",
  secret: "dGVzdF9zZWNyZXQ=", // base64 of "test_secret"
  passphrase: "test_passphrase",
};

function makeClient(opts?: { dryRun?: boolean }) {
  return new ProbableClobClient({
    walletClient: mockWalletClient,
    apiBase: API_BASE,
    exchangeAddress: EXCHANGE,
    chainId: CHAIN_ID,
    dryRun: opts?.dryRun ?? false,
  });
}

function mockFetchResponses(...responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error("No more mocked fetch responses");
      return {
        ok: next.ok,
        status: next.status,
        json: async () => next.body,
        text: async () => JSON.stringify(next.body),
      };
    }),
  );
}

/** Helper: authenticate the client with default mocked responses */
async function authenticateClient(client: ProbableClobClient) {
  mockFetchResponses({ ok: true, status: 200, body: AUTH_RESPONSE });
  await client.authenticate();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe("ProbableClobClient", () => {
  describe("authenticate", () => {
    it("creates API key via POST and stores credentials", async () => {
      const client = makeClient();
      mockFetchResponses({ ok: true, status: 200, body: AUTH_RESPONSE });

      await client.authenticate();

      const fetchFn = vi.mocked(globalThis.fetch);
      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(`${API_BASE}/public/api/v1/auth/api-key/${CHAIN_ID}`);
      expect(init?.method).toBe("POST");
    });

    it("falls back to derive API key when create fails", async () => {
      const client = makeClient();
      mockFetchResponses(
        { ok: false, status: 500, body: {} },
        { ok: true, status: 200, body: AUTH_RESPONSE },
      );

      await client.authenticate();

      const fetchFn = vi.mocked(globalThis.fetch);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      const [deriveUrl, deriveInit] = fetchFn.mock.calls[1];
      expect(deriveUrl).toBe(`${API_BASE}/public/api/v1/auth/derive-api-key/${CHAIN_ID}`);
      expect(deriveInit?.method).toBe("GET");
    });

    it("throws when both create and derive fail", async () => {
      const client = makeClient();
      mockFetchResponses(
        { ok: false, status: 500, body: {} },
        { ok: false, status: 500, body: "server error" },
      );

      await expect(client.authenticate()).rejects.toThrow("Probable deriveApiKey failed");
    });
  });

  // ---------------------------------------------------------------------------
  // placeOrder
  // ---------------------------------------------------------------------------

  describe("placeOrder", () => {
    it("places order successfully (nonce stays at on-chain value)", async () => {
      const client = makeClient();
      await authenticateClient(client);

      const initialNonce = client.getNonce();
      expect(initialNonce).toBe(0n);

      mockFetchResponses({ ok: true, status: 200, body: { orderId: "order-123", status: "SUBMITTED" } });

      const result = await client.placeOrder({
        tokenId: "99999",
        side: "BUY",
        price: 0.5,
        size: 100,
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("order-123");
      expect(result.status).toBe("SUBMITTED");
      // Nonce is on-chain — not incremented locally (salt provides uniqueness)
      expect(client.getNonce()).toBe(0n);
    });

    it("returns dry-run result without calling API", async () => {
      const client = makeClient({ dryRun: true });
      await authenticateClient(client);

      mockFetchResponses(); // no responses — fetch should not be called
      // Stub fetch so we can assert it wasn't called for order placement
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const result = await client.placeOrder({
        tokenId: "99999",
        side: "BUY",
        price: 0.5,
        size: 100,
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("dry-run");
      expect(result.status).toBe("DRY_RUN");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns error on API failure", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({ ok: false, status: 400, body: { error: "Insufficient funds" } });

      const result = await client.placeOrder({
        tokenId: "99999",
        side: "SELL",
        price: 0.5,
        size: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insufficient funds");
    });

    it("does not increment nonce on failure", async () => {
      const client = makeClient();
      await authenticateClient(client);

      const nonceBefore = client.getNonce();

      mockFetchResponses({ ok: false, status: 400, body: { error: "Bad request" } });

      await client.placeOrder({
        tokenId: "99999",
        side: "BUY",
        price: 0.5,
        size: 100,
      });

      expect(client.getNonce()).toBe(nonceBefore);
    });

    it("uses FOK order type", async () => {
      const client = makeClient();
      await authenticateClient(client);

      let capturedBody: string | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          capturedBody = init?.body as string | undefined;
          return {
            ok: true,
            status: 200,
            json: async () => ({ orderId: "order-456" }),
            text: async () => '{"orderId":"order-456"}',
          };
        }),
      );

      await client.placeOrder({
        tokenId: "99999",
        side: "BUY",
        price: 0.5,
        size: 100,
      });

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.orderType).toBe("IOC");
    });
  });

  // ---------------------------------------------------------------------------
  // cancelOrder
  // ---------------------------------------------------------------------------

  describe("cancelOrder", () => {
    it("cancels order successfully", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({ ok: true, status: 200, body: {} });

      const result = await client.cancelOrder("order-123", "token-456");

      expect(result).toBe(true);

      const fetchFn = vi.mocked(globalThis.fetch);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(`${API_BASE}/public/api/v1/order/${CHAIN_ID}/order-123?tokenId=token-456`);
      expect(init?.method).toBe("DELETE");
    });

    it("returns true in dry-run mode", async () => {
      const client = makeClient({ dryRun: true });
      // No need to authenticate for dry-run cancel

      const result = await client.cancelOrder("order-123", "token-456");
      expect(result).toBe(true);
    });

    it("returns false when tokenId missing", async () => {
      const client = makeClient();
      await authenticateClient(client);

      const result = await client.cancelOrder("order-123");
      expect(result).toBe(false);
    });

    it("returns false on API failure", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({ ok: false, status: 404, body: { error: "Not found" } });

      const result = await client.cancelOrder("order-123", "token-456");
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getOrderStatus
  // ---------------------------------------------------------------------------

  describe("getOrderStatus", () => {
    it("returns parsed status", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({
        ok: true,
        status: 200,
        body: { status: "LIVE", filled_size: 10, original_size: 100 },
      });

      const result = await client.getOrderStatus("order-123");

      expect(result.orderId).toBe("order-123");
      expect(result.status).toBe("OPEN");
      expect(result.filledSize).toBe(10);
      expect(result.remainingSize).toBe(90);
    });

    it("maps MATCHED to FILLED", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({
        ok: true,
        status: 200,
        body: { status: "MATCHED", filled_size: 50, original_size: 50 },
      });

      const result = await client.getOrderStatus("order-123");
      expect(result.status).toBe("FILLED");
    });

    it("returns UNKNOWN on failure", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({ ok: false, status: 500, body: {} });

      const result = await client.getOrderStatus("order-123");
      expect(result.status).toBe("UNKNOWN");
      expect(result.filledSize).toBe(0);
      expect(result.remainingSize).toBe(0);
    });

    it("getOrderStatus returns FILLED on 404 (FOK order processed)", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({ ok: false, status: 404, body: {} });

      const result = await client.getOrderStatus("order-fok-123");
      expect(result.status).toBe("FILLED");
      expect(result.orderId).toBe("order-fok-123");
    });
  });

  // ---------------------------------------------------------------------------
  // getOpenOrders
  // ---------------------------------------------------------------------------

  describe("getOpenOrders", () => {
    it("returns parsed orders", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({
        ok: true,
        status: 200,
        body: [
          { orderID: "o1", tokenId: "t1", side: "BUY", price: 0.5, size: 100 },
          { orderID: "o2", tokenId: "t2", side: "SELL", price: 0.8, size: 50 },
        ],
      });

      const orders = await client.getOpenOrders();

      expect(orders).toHaveLength(2);
      expect(orders[0].orderId).toBe("o1");
      expect(orders[0].side).toBe("BUY");
      expect(orders[1].orderId).toBe("o2");
      expect(orders[1].side).toBe("SELL");
    });

    it("returns empty array on failure", async () => {
      const client = makeClient();
      await authenticateClient(client);

      mockFetchResponses({ ok: false, status: 500, body: {} });

      const orders = await client.getOpenOrders();
      expect(orders).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // ensureApprovals (non-Safe)
  // ---------------------------------------------------------------------------

  describe("ensureApprovals (non-Safe)", () => {
    it("waits for CTF setApprovalForAll receipt", async () => {
      mockPublicClient.readContract
        .mockResolvedValueOnce(false) // isApprovedForAll → false
        .mockResolvedValueOnce(BigInt("1000000000000000000")); // allowance → non-zero
      mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({
        status: "success",
        blockNumber: 100n,
      });
      mockWalletClient.writeContract.mockResolvedValueOnce("0xctfhash" as `0x${string}`);

      const client = makeClient();
      await client.ensureApprovals(mockPublicClient);

      expect(mockWalletClient.writeContract).toHaveBeenCalledOnce();
      expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xctfhash" });
    });

    it("waits for USDT approve receipt", async () => {
      mockPublicClient.readContract
        .mockResolvedValueOnce(true) // isApprovedForAll → true (skip CTF)
        .mockResolvedValueOnce(0n); // allowance → 0
      mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({
        status: "success",
        blockNumber: 101n,
      });
      mockWalletClient.writeContract.mockResolvedValueOnce("0xusdthash" as `0x${string}`);

      const client = makeClient();
      await client.ensureApprovals(mockPublicClient);

      expect(mockWalletClient.writeContract).toHaveBeenCalledOnce();
      expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xusdthash" });
    });

    it("skips when already approved", async () => {
      mockPublicClient.readContract
        .mockResolvedValueOnce(true) // isApprovedForAll → true
        .mockResolvedValueOnce(BigInt("1000000000000000000")); // allowance → non-zero

      const client = makeClient();
      await client.ensureApprovals(mockPublicClient);

      expect(mockWalletClient.writeContract).not.toHaveBeenCalled();
      expect(mockPublicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it("logs error on reverted receipt", async () => {
      mockPublicClient.readContract
        .mockResolvedValueOnce(false) // isApprovedForAll → false
        .mockResolvedValueOnce(BigInt("1000000000000000000")); // allowance → non-zero
      mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({
        status: "reverted",
        blockNumber: 102n,
      });
      mockWalletClient.writeContract.mockResolvedValueOnce("0xrevertedhash" as `0x${string}`);

      const client = makeClient();
      // Should not throw, just log the error
      await client.ensureApprovals(mockPublicClient);

      expect(mockWalletClient.writeContract).toHaveBeenCalledOnce();
      expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xrevertedhash" });
    });
  });

  // ---------------------------------------------------------------------------
  // validateSafe + autoFundSafe
  // ---------------------------------------------------------------------------

  describe("validateSafe + autoFundSafe", () => {
    const PROXY = "0x2222222222222222222222222222222222222222" as `0x${string}`

    function makeProxyClient() {
      return new ProbableClobClient({
        walletClient: mockWalletClient,
        apiBase: API_BASE,
        exchangeAddress: EXCHANGE,
        chainId: CHAIN_ID,
        proxyAddress: PROXY,
      })
    }

    it("validateSafe throws when threshold !== 1", async () => {
      const client = makeProxyClient()
      await authenticateClient(client)

      // ensureApprovals checks: CTF approved, USDT allowance (exchange), USDT allowance (CTF), then validateSafe
      mockPublicClient.readContract
        .mockResolvedValueOnce(true)  // isApprovedForAll
        .mockResolvedValueOnce(1n)   // USDT allowance (exchange)
        .mockResolvedValueOnce(1n)   // USDT allowance (CTF)
        .mockResolvedValueOnce(2n)   // getThreshold → 2
        .mockResolvedValueOnce([mockAccount.address]) // getOwners

      await expect(client.ensureApprovals(mockPublicClient)).rejects.toThrow("expected 1 (multi-sig not supported)")
    })

    it("validateSafe throws when EOA not in owners", async () => {
      const client = makeProxyClient()
      await authenticateClient(client)

      mockPublicClient.readContract
        .mockResolvedValueOnce(true)  // isApprovedForAll
        .mockResolvedValueOnce(1n)   // USDT allowance (exchange)
        .mockResolvedValueOnce(1n)   // USDT allowance (CTF)
        .mockResolvedValueOnce(1n)   // getThreshold → 1
        .mockResolvedValueOnce(["0x9999999999999999999999999999999999999999"]) // getOwners — different address

      await expect(client.ensureApprovals(mockPublicClient)).rejects.toThrow("is not an owner of Safe")
    })

    it("autoFundSafe transfers when Safe balance is low", async () => {
      const client = makeProxyClient()
      await authenticateClient(client)

      const fundingThreshold = 500_000_000n // 500 USDT in 6-dec

      mockPublicClient.readContract
        .mockResolvedValueOnce(true)  // isApprovedForAll (CTF check from proxy)
        .mockResolvedValueOnce(1n)   // USDT allowance (exchange)
        .mockResolvedValueOnce(1n)   // USDT allowance (CTF)
        .mockResolvedValueOnce(1n)   // getThreshold → 1
        .mockResolvedValueOnce([mockAccount.address]) // getOwners — includes EOA
        .mockResolvedValueOnce(100n * 10n ** 18n) // Safe USDT balanceOf → 100 USDT (below threshold)
        .mockResolvedValueOnce(1000n * 10n ** 18n) // EOA USDT balanceOf → 1000 USDT

      mockWalletClient.writeContract.mockResolvedValueOnce("0xfundhash" as `0x${string}`)
      mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({
        status: "success",
        blockNumber: 200n,
      })

      await client.ensureApprovals(mockPublicClient, fundingThreshold)

      // Should have called writeContract for transfer
      const transferCall = mockWalletClient.writeContract.mock.calls.find(
        (c: any[]) => c[0]?.functionName === "transfer",
      )
      expect(transferCall).toBeDefined()
    })

    it("autoFundSafe skips when Safe balance is sufficient", async () => {
      const client = makeProxyClient()
      await authenticateClient(client)

      const fundingThreshold = 500_000_000n // 500 USDT in 6-dec

      mockPublicClient.readContract
        .mockResolvedValueOnce(true)  // isApprovedForAll
        .mockResolvedValueOnce(1n)   // USDT allowance (exchange)
        .mockResolvedValueOnce(1n)   // USDT allowance (CTF)
        .mockResolvedValueOnce(1n)   // getThreshold → 1
        .mockResolvedValueOnce([mockAccount.address]) // getOwners
        .mockResolvedValueOnce(600n * 10n ** 18n) // Safe USDT balanceOf → 600 USDT (above threshold)

      await client.ensureApprovals(mockPublicClient, fundingThreshold)

      // writeContract should NOT have been called (no approvals needed, no funding needed)
      expect(mockWalletClient.writeContract).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // nonce management
  // ---------------------------------------------------------------------------

  describe("nonce management", () => {
    it("getNonce returns current nonce", () => {
      const client = makeClient();
      expect(client.getNonce()).toBe(0n);
    });

    it("setNonce updates nonce", () => {
      const client = makeClient();
      client.setNonce(42n);
      expect(client.getNonce()).toBe(42n);
    });

    it("nonce stays constant across multiple orders", async () => {
      const client = makeClient();
      await authenticateClient(client);

      client.setNonce(10n);

      mockFetchResponses({ ok: true, status: 200, body: { orderId: "order-1" } });
      await client.placeOrder({ tokenId: "1", side: "BUY", price: 0.5, size: 100 });
      // Nonce is on-chain — not incremented locally
      expect(client.getNonce()).toBe(10n);

      mockFetchResponses({ ok: true, status: 200, body: { orderId: "order-2" } });
      await client.placeOrder({ tokenId: "2", side: "BUY", price: 0.6, size: 50 });
      expect(client.getNonce()).toBe(10n);
    });
  });
});
