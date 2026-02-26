import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpinionClobClient } from "../clob/opinion-client.js";

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
// Mock signing module
// ---------------------------------------------------------------------------

vi.mock("../clob/signing.js", () => ({
  buildOrder: vi.fn().mockReturnValue({
    salt: 12345n,
    maker: "0x1111111111111111111111111111111111111111",
    signer: "0x1111111111111111111111111111111111111111",
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: 999n,
    makerAmount: 100000000000000000n,
    takerAmount: 200000000000000000n,
    expiration: 9999999999n,
    nonce: 0n,
    feeRateBps: 200n,
    side: 0,
    signatureType: 0,
  }),
  signOrder: vi.fn().mockResolvedValue({
    order: {},
    signature: "0xdeadbeef" as `0x${string}`,
  }),
  serializeOrder: vi.fn().mockReturnValue({
    salt: "12345",
    maker: "0x1111111111111111111111111111111111111111",
    signer: "0x1111111111111111111111111111111111111111",
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: "999",
    makerAmount: "100000000000000000",
    takerAmount: "200000000000000000",
    expiration: "9999999999",
    nonce: "0",
    feeRateBps: "200",
    side: "BUY",
    signatureType: 0,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXCHANGE_ADDR = "0x0000000000000000000000000000000000000abc" as `0x${string}`;

function createClient(overrides?: { dryRun?: boolean }): OpinionClobClient {
  const mockWalletClient = {
    account: {
      address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    },
    chain: { id: 56 },
    signTypedData: vi.fn().mockResolvedValue("0xdeadbeef" as `0x${string}`),
    writeContract: vi.fn().mockResolvedValue("0xtxhash" as `0x${string}`),
  } as any;

  return new OpinionClobClient({
    walletClient: mockWalletClient,
    apiBase: "https://openapi.opinion.trade/openapi",
    apiKey: "test-api-key",
    exchangeAddress: EXCHANGE_ADDR,
    chainId: 56,
    expirationSec: 300,
    dryRun: overrides?.dryRun ?? false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpinionClobClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("authenticate", () => {
    it("logs exchange address when already set", async () => {
      const client = createClient();
      await client.authenticate();
      // Should not throw — exchange address was already provided
      expect(client.exchangeAddress).toBe(EXCHANGE_ADDR);
    });
  });

  describe("placeOrder MARKET", () => {
    it("returns success with filledQty from API response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errno: 0,
          result: {
            order_data: {
              trans_no: "order-123",
              filled: "5.0/5.0",
              status: 2, // FILLED
            },
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 10,
        marketId: "42",
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("order-123");
      expect(result.status).toBe("FILLED");
      expect(result.filledQty).toBe(10); // Full size when status=FILLED
    });

    it("returns partial filledQty when not fully filled", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errno: 0,
          result: {
            order_data: {
              trans_no: "order-456",
              filled: "3.0/5.0",
              status: 1, // OPEN
            },
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 10,
        marketId: "42",
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("order-456");
      expect(result.filledQty).toBe(3.0);
    });
  });

  describe("placeOrder LIMIT", () => {
    it("sends tradingMethod=2 for LIMIT orders", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errno: 0,
          result: {
            order_data: {
              trans_no: "limit-1",
              filled: "0/10.0",
              status: 1,
            },
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.placeOrder({
        tokenId: "999",
        side: "SELL",
        price: 0.6,
        size: 10,
        strategy: "LIMIT",
        marketId: "42",
      });

      expect(result.success).toBe(true);
      // Verify tradingMethod=2 was sent
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string);
      expect(body.tradingMethod).toBe(2);
      expect(body.price).toBe("0.6");
    });
  });

  describe("placeOrder dry-run", () => {
    it("returns success without calling API", async () => {
      const client = createClient({ dryRun: true });
      const result = await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 10,
        marketId: "42",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("DRY_RUN");
      expect(result.filledQty).toBe(10);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("placeOrder error", () => {
    it("returns error on API failure", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ errno: 1, errmsg: "Invalid order" }),
      } as any);

      const client = createClient();
      const result = await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 10,
        marketId: "42",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid order");
    });
  });

  describe("cancelOrder", () => {
    it("returns true on success", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errno: 0 }),
      } as any);

      const client = createClient();
      const result = await client.cancelOrder("order-123");

      expect(result).toBe(true);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string);
      expect(body.orderId).toBe("order-123");
    });

    it("returns false on failure", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errno: 1, errmsg: "Order not found" }),
      } as any);

      const client = createClient();
      const result = await client.cancelOrder("bad-order");

      expect(result).toBe(false);
    });
  });

  describe("getOrderStatus", () => {
    it("maps status 1 to OPEN", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            list: [{ status: 1, filled: "0/5.0" }],
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.getOrderStatus("order-1");
      expect(result.status).toBe("OPEN");
      expect(result.filledSize).toBe(0);
      expect(result.remainingSize).toBe(5);
    });

    it("maps status 2 to FILLED", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            list: [{ status: 2, filled: "5.0/5.0" }],
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.getOrderStatus("order-1");
      expect(result.status).toBe("FILLED");
      expect(result.filledSize).toBe(5);
      expect(result.remainingSize).toBe(0);
    });

    it("maps status 3 to CANCELLED", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            list: [{ status: 3, filled: "2.0/5.0" }],
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.getOrderStatus("order-1");
      expect(result.status).toBe("CANCELLED");
    });

    it("maps status 4 to EXPIRED", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            list: [{ status: 4, filled: "0/5.0" }],
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.getOrderStatus("order-1");
      expect(result.status).toBe("EXPIRED");
    });

    it("maps status 5 (FAILED) to CANCELLED", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            list: [{ status: 5, filled: "0/5.0" }],
          },
        }),
      } as any);

      const client = createClient();
      const result = await client.getOrderStatus("order-1");
      expect(result.status).toBe("CANCELLED");
    });

    it("returns UNKNOWN on API error", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as any);

      const client = createClient();
      const result = await client.getOrderStatus("order-1");
      expect(result.status).toBe("UNKNOWN");
    });
  });

  describe("nonce management", () => {
    it("increments nonce after successful order", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errno: 0,
          result: { order_data: { trans_no: "o1", filled: "0/5.0", status: 1 } },
        }),
      } as any);

      const client = createClient();
      expect(client.getNonce()).toBe(0n);

      await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 10,
        marketId: "42",
      });

      expect(client.getNonce()).toBe(1n);
    });

    it("setNonce restores nonce from persistence", () => {
      const client = createClient();
      client.setNonce(42n);
      expect(client.getNonce()).toBe(42n);
    });
  });
});
