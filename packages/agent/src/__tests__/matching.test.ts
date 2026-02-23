import { describe, it, expect, vi } from "vitest";
import { cosineSimilarity, clusterByEvent } from "../matching/cluster.js";
import { Embedder } from "../matching/embedder.js";
import { Verifier } from "../matching/verifier.js";
import { RiskAssessor } from "../matching/risk-assessor.js";
import { MatchingPipeline } from "../matching/index.js";
import type { MarketQuote } from "../types.js";
import type { EmbeddedQuote } from "../matching/embedder.js";

// Silence logger output during tests
vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Shared mock function references so tests can override behavior
const mockEmbeddingsCreate = vi.fn().mockResolvedValue({
  data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
});

const mockChatCreate = vi.fn().mockResolvedValue({
  choices: [{
    message: {
      content: JSON.stringify({
        match: true,
        confidence: 0.95,
        reasoning: "Both markets resolve on the same event.",
      }),
    },
  }],
});

// Mock OpenAI
vi.mock("openai", () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    embeddings: { create: (...args: unknown[]) => mockEmbeddingsCreate(...args) },
    chat: { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } },
  }));
  return { default: MockOpenAI };
});

const ONE = 10n ** 18n;

function makeQuote(overrides: Partial<MarketQuote> & { protocol: string }): MarketQuote {
  return {
    marketId: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    yesPrice: ONE / 2n,
    noPrice: ONE / 2n,
    yesLiquidity: ONE,
    noLiquidity: ONE,
    feeBps: 0,
    ...overrides,
  };
}

// --- cosineSimilarity ---
describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("computes correct similarity for known vectors", () => {
    // cos(45deg) ~ 0.7071
    const a = [1, 0];
    const b = [1, 1];
    const expected = 1 / Math.sqrt(2);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 4);
  });
});

// --- clusterByEvent ---
describe("clusterByEvent", () => {
  it("returns empty array when fewer than 2 embedded quotes", () => {
    const embedded: EmbeddedQuote[] = [
      { quote: makeQuote({ protocol: "A" }), embedding: [1, 0, 0] },
    ];
    expect(clusterByEvent(embedded, 0.85)).toEqual([]);
  });

  it("does not cluster quotes from the same protocol", () => {
    const embedded: EmbeddedQuote[] = [
      { quote: makeQuote({ protocol: "A", eventDescription: "BTC > 100k" }), embedding: [1, 0, 0] },
      { quote: makeQuote({ protocol: "A", eventDescription: "BTC > 100k" }), embedding: [1, 0, 0] },
    ];
    expect(clusterByEvent(embedded, 0.85)).toEqual([]);
  });

  it("clusters quotes from different protocols above threshold", () => {
    const embedded: EmbeddedQuote[] = [
      { quote: makeQuote({ protocol: "A", eventDescription: "BTC > 100k" }), embedding: [1, 0, 0] },
      { quote: makeQuote({ protocol: "B", eventDescription: "Bitcoin above 100k" }), embedding: [0.99, 0.1, 0] },
    ];
    const clusters = clusterByEvent(embedded, 0.85);
    expect(clusters.length).toBe(1);
    expect(clusters[0].quotes.length).toBe(2);
    expect(clusters[0].quotes[0].protocol).toBe("A");
    expect(clusters[0].quotes[1].protocol).toBe("B");
  });

  it("rejects clusters below similarity threshold", () => {
    const embedded: EmbeddedQuote[] = [
      { quote: makeQuote({ protocol: "A" }), embedding: [1, 0, 0] },
      { quote: makeQuote({ protocol: "B" }), embedding: [0, 1, 0] },
    ];
    expect(clusterByEvent(embedded, 0.85)).toEqual([]);
  });

  it("reports similarity in cluster result", () => {
    const embedded: EmbeddedQuote[] = [
      { quote: makeQuote({ protocol: "A" }), embedding: [1, 0] },
      { quote: makeQuote({ protocol: "B" }), embedding: [1, 0] },
    ];
    const clusters = clusterByEvent(embedded, 0.85);
    expect(clusters[0].similarity).toBeCloseTo(1, 5);
  });
});

// --- Embedder ---
describe("Embedder", () => {
  it("skips quotes without eventDescription", async () => {
    const embedder = new Embedder("test-key");
    const quotes = [makeQuote({ protocol: "A" })]; // no eventDescription
    const result = await embedder.embedQuotes(quotes);
    expect(result).toEqual([]);
  });

  it("embeds quotes with eventDescription", async () => {
    const embedder = new Embedder("test-key");
    const quotes = [
      makeQuote({ protocol: "A", eventDescription: "Will BTC hit 100k?" }),
    ];
    const result = await embedder.embedQuotes(quotes);
    expect(result.length).toBe(1);
    expect(result[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result[0].quote.protocol).toBe("A");
  });

  it("caches embeddings for repeated descriptions", async () => {
    const embedder = new Embedder("test-key");
    const quotes = [
      makeQuote({ protocol: "A", eventDescription: "Will BTC hit 100k?" }),
    ];
    await embedder.embedQuotes(quotes);
    expect(embedder.getCacheSize()).toBe(1);

    // Second call should use cache
    const result = await embedder.embedQuotes(quotes);
    expect(result.length).toBe(1);
    expect(embedder.getCacheSize()).toBe(1);
  });

  it("clearCache empties the cache", async () => {
    const embedder = new Embedder("test-key");
    const quotes = [
      makeQuote({ protocol: "A", eventDescription: "Test" }),
    ];
    await embedder.embedQuotes(quotes);
    expect(embedder.getCacheSize()).toBe(1);
    embedder.clearCache();
    expect(embedder.getCacheSize()).toBe(0);
  });
});

// --- Verifier ---
describe("Verifier", () => {
  it("returns match verification result", async () => {
    const verifier = new Verifier("test-key");
    const quoteA = makeQuote({ protocol: "A", eventDescription: "BTC > 100k by EOY" });
    const quoteB = makeQuote({ protocol: "B", eventDescription: "Bitcoin above 100k by end of year" });
    const result = await verifier.verify(quoteA, quoteB);
    expect(result.match).toBe(true);
    expect(result.confidence).toBe(0.95);
    expect(result.reasoning).toBeDefined();
  });
});

// --- RiskAssessor ---
describe("RiskAssessor", () => {
  it("returns risk assessment", async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            riskScore: 0.3,
            recommendedSizeMultiplier: 0.8,
            concerns: ["Oracle divergence possible"],
          }),
        },
      }],
    });

    const assessor = new RiskAssessor("test-key");
    const opportunity = {
      marketId: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      protocolA: "A",
      protocolB: "B",
      buyYesOnA: true,
      yesPriceA: ONE * 40n / 100n,
      noPriceB: ONE * 30n / 100n,
      totalCost: ONE * 70n / 100n,
      guaranteedPayout: ONE,
      spreadBps: 3000,
      grossSpreadBps: 3000,
      feesDeducted: 0n,
      estProfit: 30_000_000n,
      liquidityA: ONE,
      liquidityB: ONE,
    };
    const quotes = [
      makeQuote({ protocol: "A", eventDescription: "BTC > 100k" }),
      makeQuote({ protocol: "B", eventDescription: "Bitcoin above 100k" }),
    ];
    const result = await assessor.assess(opportunity, quotes);
    expect(result.riskScore).toBe(0.3);
    expect(result.recommendedSizeMultiplier).toBe(0.8);
    expect(result.concerns).toEqual(["Oracle divergence possible"]);
  });

  it("clamps riskScore and multiplier to valid ranges", async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            riskScore: 1.5,
            recommendedSizeMultiplier: -0.2,
            concerns: [],
          }),
        },
      }],
    });

    const assessor = new RiskAssessor("test-key");
    const opportunity = {
      marketId: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      protocolA: "A",
      protocolB: "B",
      buyYesOnA: true,
      yesPriceA: ONE / 2n,
      noPriceB: ONE / 2n,
      totalCost: ONE,
      guaranteedPayout: ONE,
      spreadBps: 0,
      grossSpreadBps: 0,
      feesDeducted: 0n,
      estProfit: 0n,
      liquidityA: ONE,
      liquidityB: ONE,
    };
    const result = await assessor.assess(opportunity, []);
    expect(result.riskScore).toBe(1);
    expect(result.recommendedSizeMultiplier).toBe(0);
  });
});

// --- MatchingPipeline ---
describe("MatchingPipeline", () => {
  it("returns empty when no quotes have descriptions", async () => {
    const pipeline = new MatchingPipeline("test-key");
    const quotes = [
      makeQuote({ protocol: "A" }),
      makeQuote({ protocol: "B" }),
    ];
    const result = await pipeline.matchQuotes(quotes);
    expect(result).toEqual([]);
  });

  it("returns empty when only one described quote exists", async () => {
    const pipeline = new MatchingPipeline("test-key");
    const quotes = [
      makeQuote({ protocol: "A", eventDescription: "BTC > 100k" }),
    ];
    const result = await pipeline.matchQuotes(quotes);
    expect(result).toEqual([]);
  });
});
