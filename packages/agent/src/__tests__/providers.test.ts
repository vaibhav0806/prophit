import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpinionProvider } from "../providers/opinion-provider.js";
import { PredictProvider } from "../providers/predict-provider.js";
import { ProbableProvider } from "../providers/probable-provider.js";
import { MockProvider } from "../providers/mock-provider.js";
import type { PublicClient } from "viem";

vi.mock("../logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Bypass retry delays — just call the function once
vi.mock("../retry.js", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

const ADAPTER = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const MKT_ID = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

let fetchSpy: any;

afterEach(() => {
  fetchSpy?.mockRestore();
});

// ---------------------------------------------------------------------------
// OpinionProvider
// ---------------------------------------------------------------------------

describe("OpinionProvider", () => {
  function createProvider() {
    const tokenMap = new Map([
      [MKT_ID, { yesTokenId: "yes-tok-1", noTokenId: "no-tok-1", topicId: "topic-1" }],
    ]);
    return new OpinionProvider(ADAPTER, "https://api.opinion.test", "test-key", [MKT_ID], tokenMap);
  }

  it("returns quotes from orderbooks", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("yes-tok-1")) {
        return new Response(JSON.stringify({
          asks: [{ price: "0.55", size: "100" }],
          bids: [{ price: "0.50", size: "80" }],
        }));
      }
      if (url.includes("no-tok-1")) {
        return new Response(JSON.stringify({
          asks: [{ price: "0.40", size: "120" }],
          bids: [{ price: "0.35", size: "60" }],
        }));
      }
      return new Response("", { status: 404 });
    });

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();

    expect(quotes).toHaveLength(1);
    expect(quotes[0].protocol).toBe("Opinion");
    expect(quotes[0].marketId).toBe(MKT_ID);
    expect(quotes[0].yesPrice).toBe(550000000000000000n); // 0.55 * 1e18
    expect(quotes[0].noPrice).toBe(400000000000000000n);  // 0.40 * 1e18
    expect(quotes[0].feeBps).toBe(200);
  });

  it("skips quotes with zero price (empty asks)", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ asks: [], bids: [] })),
    );

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();

    expect(quotes).toHaveLength(0);
  });

  it("skips quotes with liquidity below MIN_LIQUIDITY", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("yes-tok-1")) {
        return new Response(JSON.stringify({
          asks: [{ price: "0.55", size: "0.5" }], // 0.5 USDT < 1 USDT minimum
          bids: [],
        }));
      }
      if (url.includes("no-tok-1")) {
        return new Response(JSON.stringify({
          asks: [{ price: "0.40", size: "0.5" }],
          bids: [],
        }));
      }
      return new Response("", { status: 404 });
    });

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("skips markets with no token mapping", async () => {
    const provider = new OpinionProvider(
      ADAPTER, "https://api.opinion.test", "test-key",
      [MKT_ID],
      new Map(), // empty map
    );
    fetchSpy = vi.spyOn(globalThis, "fetch");

    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("catches API errors and returns empty for that market", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PredictProvider
// ---------------------------------------------------------------------------

describe("PredictProvider", () => {
  function createProvider() {
    const marketMap = new Map([
      [MKT_ID, { predictMarketId: "42", yesTokenId: "yes-pred", noTokenId: "no-pred" }],
    ]);
    return new PredictProvider(ADAPTER, "https://api.predict.test", "test-key", [MKT_ID], marketMap);
  }

  function mockOrderbook(asks: [number, number][], bids: [number, number][]) {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { asks, bids } })),
    );
  }

  it("returns quote with correct YES/NO prices from orderbook", async () => {
    // asks: YES sellers. Best ask = 0.55 (yesPrice)
    // bids: YES buyers. Best bid = 0.60, so noPrice = 1 - 0.60 = 0.40
    mockOrderbook([[0.55, 100], [0.60, 50]], [[0.60, 80], [0.50, 40]]);

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();

    expect(quotes).toHaveLength(1);
    expect(quotes[0].yesPrice).toBe(550000000000000000n);
    expect(quotes[0].noPrice).toBe(400000000000000000n);
    expect(quotes[0].protocol).toBe("Predict");
    expect(quotes[0].feeBps).toBe(200);
  });

  it("skips zero-price quotes", async () => {
    // No asks → yesPrice = 0
    mockOrderbook([], [[0.50, 10]]);

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("skips out-of-range prices (>= 1.0)", async () => {
    mockOrderbook([[1.0, 100]], [[0.01, 100]]);

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("skips low-liquidity quotes", async () => {
    // Each side has only 0.5 USDT (500_000 in 6-dec) < MIN_LIQUIDITY (1_000_000)
    mockOrderbook([[0.50, 0.5]], [[0.50, 0.5]]);

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("sorts asks ascending to get best (lowest) ask", async () => {
    // Unsorted asks — should pick 0.45, not 0.70
    mockOrderbook([[0.70, 50], [0.45, 50]], [[0.60, 50]]);

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(1);
    expect(quotes[0].yesPrice).toBe(450000000000000000n); // 0.45
  });

  it("getMarketMeta returns meta for known market", () => {
    const provider = createProvider();
    const meta = provider.getMarketMeta(MKT_ID);
    expect(meta).toEqual({
      conditionId: MKT_ID,
      predictMarketId: "42",
      yesTokenId: "yes-pred",
      noTokenId: "no-pred",
    });
  });

  it("getMarketMeta returns undefined for unknown market", () => {
    const provider = createProvider();
    const meta = provider.getMarketMeta("0xdeadbeef" as `0x${string}`);
    expect(meta).toBeUndefined();
  });

  it("catches API errors gracefully", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ProbableProvider
// ---------------------------------------------------------------------------

describe("ProbableProvider", () => {
  function createProvider() {
    const marketMap = new Map([
      [MKT_ID, { probableMarketId: "prob-1", conditionId: "cond-1", yesTokenId: "yes-prob", noTokenId: "no-prob" }],
    ]);
    return new ProbableProvider(ADAPTER, "https://api.probable.test", [MKT_ID], marketMap);
  }

  it("returns quote from YES and NO orderbooks", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("yes-prob")) {
        return new Response(JSON.stringify({
          asks: [{ price: "0.50", size: "200" }],
          bids: [{ price: "0.45", size: "100" }],
        }));
      }
      if (url.includes("no-prob")) {
        return new Response(JSON.stringify({
          asks: [{ price: "0.40", size: "150" }],
          bids: [{ price: "0.35", size: "80" }],
        }));
      }
      return new Response("", { status: 404 });
    });

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();

    expect(quotes).toHaveLength(1);
    expect(quotes[0].protocol).toBe("Probable");
    expect(quotes[0].yesPrice).toBe(500000000000000000n); // 0.50
    expect(quotes[0].noPrice).toBe(400000000000000000n);  // 0.40
    expect(quotes[0].feeBps).toBe(175);
  });

  it("sorts asks ascending to pick best (lowest) price", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        asks: [{ price: "0.70", size: "50" }, { price: "0.40", size: "50" }],
        bids: [],
      })),
    );

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();

    expect(quotes).toHaveLength(1);
    expect(quotes[0].yesPrice).toBe(400000000000000000n); // picks 0.40 not 0.70
  });

  it("skips zero-price quotes", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ asks: [], bids: [] })),
    );

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("skips low-liquidity quotes", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        asks: [{ price: "0.50", size: "0.5" }], // 0.5 USDT < 1 USDT minimum
        bids: [],
      })),
    );

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("getMarketMeta returns correct meta", () => {
    const provider = createProvider();
    const meta = provider.getMarketMeta(MKT_ID);
    expect(meta).toEqual({
      conditionId: "cond-1",
      yesTokenId: "yes-prob",
      noTokenId: "no-prob",
    });
  });

  it("getMarketMeta returns undefined for unknown market", () => {
    const provider = createProvider();
    expect(provider.getMarketMeta("0xdead" as `0x${string}`)).toBeUndefined();
  });

  it("catches API errors gracefully", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));

    const provider = createProvider();
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("discoverEvents paginates correctly", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `ev-${i}`, title: `Event ${i}`, slug: `ev-${i}`, active: true, tags: [], markets: [],
    }));
    const page2 = [{ id: "ev-100", title: "Event 100", slug: "ev-100", active: true, tags: [], markets: [] }];

    let callCount = 0;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const data = callCount === 0 ? page1 : page2;
      callCount++;
      return new Response(JSON.stringify(data));
    });

    const provider = createProvider();
    const events = await provider.discoverEvents();
    expect(events).toHaveLength(101);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// MockProvider
// ---------------------------------------------------------------------------

describe("MockProvider", () => {
  function createMockClient(result: unknown, shouldThrow = false) {
    return {
      readContract: shouldThrow
        ? vi.fn().mockRejectedValue(new Error("RPC error"))
        : vi.fn().mockResolvedValue(result),
    } as unknown as PublicClient;
  }

  it("returns quote from on-chain readContract", async () => {
    const client = createMockClient({
      marketId: MKT_ID,
      yesPrice: 500000000000000000n,
      noPrice: 500000000000000000n,
      yesLiquidity: 1000000000000000000n,
      noLiquidity: 1000000000000000000n,
      resolved: false,
    });

    const provider = new MockProvider(client, ADAPTER, "MockA", [MKT_ID]);
    const quotes = await provider.fetchQuotes();

    expect(quotes).toHaveLength(1);
    expect(quotes[0].protocol).toBe("MockA");
    expect(quotes[0].yesPrice).toBe(500000000000000000n);
    expect(quotes[0].feeBps).toBe(0);
  });

  it("skips resolved markets", async () => {
    const client = createMockClient({
      marketId: MKT_ID,
      yesPrice: 500000000000000000n,
      noPrice: 500000000000000000n,
      yesLiquidity: 1000000000000000000n,
      noLiquidity: 1000000000000000000n,
      resolved: true,
    });

    const provider = new MockProvider(client, ADAPTER, "MockA", [MKT_ID]);
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });

  it("catches RPC errors gracefully", async () => {
    const client = createMockClient(null, true);

    const provider = new MockProvider(client, ADAPTER, "MockA", [MKT_ID]);
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(0);
  });
});
