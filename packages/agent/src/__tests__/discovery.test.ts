import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runDiscovery } from "../discovery/pipeline.js";
import type { DiscoveryResult } from "../discovery/pipeline.js";

vi.mock("../logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers — build Probable / Predict API responses
// ---------------------------------------------------------------------------

function probableEvent(id: string, title: string, opts?: {
  conditionId?: string;
  yesTokenId?: string;
  noTokenId?: string;
}) {
  return {
    id,
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    active: true,
    tags: [{ id: 1, label: "Crypto", slug: "crypto" }],
    markets: [{
      id: `prob-mkt-${id}`,
      question: title,
      conditionId: opts?.conditionId ?? `cond-${id}`,
      clobTokenIds: JSON.stringify([
        opts?.yesTokenId ?? `yes-prob-${id}`,
        opts?.noTokenId ?? `no-prob-${id}`,
      ]),
      outcomes: JSON.stringify(["Yes", "No"]),
      tokens: [
        { token_id: opts?.yesTokenId ?? `yes-prob-${id}`, outcome: "Yes" },
        { token_id: opts?.noTokenId ?? `no-prob-${id}`, outcome: "No" },
      ],
    }],
  };
}

function predictMarket(id: number, title: string, opts?: {
  conditionId?: string;
  yesTokenId?: string;
  noTokenId?: string;
}) {
  return {
    id,
    title,
    question: title,
    conditionId: opts?.conditionId ?? `cond-pred-${id}`,
    outcomes: [
      { name: "Yes", indexSet: 1, onChainId: opts?.yesTokenId ?? `yes-pred-${id}` },
      { name: "No", indexSet: 2, onChainId: opts?.noTokenId ?? `no-pred-${id}` },
    ],
    tradingStatus: "OPEN",
    status: "OPEN",
    categorySlug: "crypto",
  };
}

function opinionMarket(id: number, title: string, opts?: {
  statusEnum?: string;
  yesTokenId?: string;
  noTokenId?: string;
  conditionId?: string;
  cutoffAt?: number;
  labels?: string[];
}) {
  return {
    marketId: id,
    marketTitle: title,
    statusEnum: opts?.statusEnum ?? "Activated",
    yesTokenId: opts?.yesTokenId ?? `yes-op-${id}`,
    noTokenId: opts?.noTokenId ?? `no-op-${id}`,
    conditionId: opts?.conditionId ?? "",
    cutoffAt: opts?.cutoffAt ?? Math.floor(Date.now() / 1000) + 86400,
    labels: opts?.labels ?? ["Crypto"],
  };
}

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

let fetchSpy: any;

function setupFetch(opts: {
  probableEvents?: unknown[][];  // array of pages
  predictMarkets?: unknown[];
  predictCategories?: unknown[];
  opinionMarkets?: unknown[];
  probableFail?: boolean;
  predictFail?: boolean;
  opinionFail?: boolean;
}) {
  const probablePages = opts.probableEvents ?? [[]];
  let probablePageIdx = 0;

  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    // Probable events endpoint
    if (url.includes("/public/api/v1/events")) {
      if (opts.probableFail) {
        return new Response("Internal Server Error", { status: 500 });
      }
      const page = probablePages[probablePageIdx] ?? [];
      probablePageIdx++;
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Opinion markets endpoint
    if (url.includes("/market?page=")) {
      if (opts.opinionFail) {
        return new Response("Internal Server Error", { status: 500 });
      }
      const allOpinion = opts.opinionMarkets ?? [];
      const urlObj = new URL(url);
      const page = parseInt(urlObj.searchParams.get("page") ?? "1", 10);
      const pageSize = parseInt(urlObj.searchParams.get("pageSize") ?? "10", 10);
      const start = (page - 1) * pageSize;
      const slice = allOpinion.slice(start, start + pageSize);
      return new Response(JSON.stringify({
        errno: 0,
        result: { total: allOpinion.length, list: slice },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Predict markets endpoint
    if (url.includes("/v1/markets")) {
      if (opts.predictFail) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: opts.predictMarkets ?? [],
        cursor: undefined,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Predict categories endpoint
    if (url.includes("/v1/categories")) {
      if (opts.predictFail) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: opts.predictCategories ?? [],
        cursor: undefined,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const params = {
  probableEventsApiBase: "https://market-api.probable.markets",
  predictApiBase: "https://api.predict.fun",
  predictApiKey: "test-key",
};

describe("runDiscovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("returns empty result when no markets on either platform", async () => {
    setupFetch({ probableEvents: [[]], predictMarkets: [] });
    const result = await runDiscovery(params);
    expect(result.probableMarkets).toBe(0);
    expect(result.predictMarkets).toBe(0);
    expect(result.matches).toEqual([]);
  });

  it("matches by conditionId", async () => {
    const sharedConditionId = "shared-cond-123";
    setupFetch({
      probableEvents: [[probableEvent("1", "Will BTC hit 100k?", { conditionId: sharedConditionId })]],
      predictMarkets: [predictMarket(1, "Bitcoin to 100k?", { conditionId: sharedConditionId })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchType).toBe("conditionId");
    expect(result.matches[0].similarity).toBe(1);
  });

  it("matches by template extraction (fdv-above)", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Will Solana FDV be above $100B?", { conditionId: "cond-a" })]],
      predictMarkets: [predictMarket(1, "Will Solana FDV be above $100B?", { conditionId: "cond-b" })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchType).toBe("templateMatch");
  });

  it("matches by template extraction (token-launch)", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Will Apple launch a token by 2025?", { conditionId: "cond-a" })]],
      predictMarkets: [predictMarket(1, "Will Apple launch a token by 2025?", { conditionId: "cond-b" })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchType).toBe("templateMatch");
  });

  it("matches by Jaccard title similarity as fallback", async () => {
    // Titles that don't match any template but are very similar
    setupFetch({
      probableEvents: [[probableEvent("1", "Lakers vs Celtics NBA Finals 2025", { conditionId: "cond-a" })]],
      predictMarkets: [predictMarket(1, "Lakers vs Celtics NBA Finals 2025", { conditionId: "cond-b" })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchType).toBe("titleSimilarity");
    expect(result.matches[0].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("does not false-positive on similar templates with different entities", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Will Solana FDV be above $100B?", { conditionId: "cond-a" })]],
      predictMarkets: [predictMarket(1, "Will Ethereum FDV be above $100B?", { conditionId: "cond-b" })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(0);
  });

  it("does not false-positive on similar templates with different params", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Will Solana FDV be above $50B?", { conditionId: "cond-a" })]],
      predictMarkets: [predictMarket(1, "Will Solana FDV be above $100B?", { conditionId: "cond-b" })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(0);
  });

  it("does not match titles below Jaccard threshold", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Will BTC hit 100k by end of 2025?", { conditionId: "cond-a" })]],
      predictMarkets: [predictMarket(1, "Will Ethereum reach $5000 next month?", { conditionId: "cond-b" })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(0);
  });

  it("handles Probable pagination across multiple pages", async () => {
    // Page 1: 100 events (PAGE_SIZE = 100, so it fetches another page)
    const page1 = Array.from({ length: 100 }, (_, i) =>
      probableEvent(`p${i}`, `Event ${i}`),
    );
    const page2 = [probableEvent("extra", "Extra event")];

    setupFetch({
      probableEvents: [page1, page2],
      predictMarkets: [],
    });

    const result = await runDiscovery(params);
    expect(result.probableMarkets).toBe(101);
  });

  it("continues when Probable API fails", async () => {
    setupFetch({
      probableFail: true,
      predictMarkets: [predictMarket(1, "Some market")],
    });

    const result = await runDiscovery(params);
    expect(result.probableMarkets).toBe(0);
    expect(result.predictMarkets).toBe(1);
  });

  it("continues when Predict API fails", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Some market")]],
      predictFail: true,
    });

    const result = await runDiscovery(params);
    expect(result.probableMarkets).toBe(1);
    expect(result.predictMarkets).toBe(0);
  });

  it("filters out markets missing YES/NO token IDs", async () => {
    const badEvent = {
      id: "bad",
      title: "Bad market",
      slug: "bad",
      active: true,
      tags: [],
      markets: [{
        id: "bad-mkt",
        question: "Bad market?",
        conditionId: "bad-cond",
        clobTokenIds: JSON.stringify([]),
        outcomes: JSON.stringify(["Yes", "No"]),
        tokens: [],
      }],
    };

    setupFetch({
      probableEvents: [[badEvent]],
      predictMarkets: [],
    });

    const result = await runDiscovery(params);
    expect(result.probableMarkets).toBe(0);
  });

  it("builds correct output maps from matches", async () => {
    const sharedCond = "shared-123";
    setupFetch({
      probableEvents: [[probableEvent("1", "Test market", {
        conditionId: sharedCond,
        yesTokenId: "prob-yes",
        noTokenId: "prob-no",
      })]],
      predictMarkets: [predictMarket(1, "Test market", {
        conditionId: sharedCond,
        yesTokenId: "pred-yes",
        noTokenId: "pred-no",
      })],
    });

    const result = await runDiscovery(params);
    expect(result.probableMarketMap[sharedCond]).toEqual({
      probableMarketId: expect.any(String),
      conditionId: sharedCond,
      yesTokenId: "prob-yes",
      noTokenId: "prob-no",
    });
    expect(result.predictMarketMap[sharedCond]).toEqual({
      predictMarketId: "1",
      yesTokenId: "pred-yes",
      noTokenId: "pred-no",
    });
  });

  it("conditionId match takes priority over template/Jaccard", async () => {
    const sharedCond = "shared-456";
    // Same conditionId AND matching template — should be conditionId match
    setupFetch({
      probableEvents: [[probableEvent("1", "Will Solana FDV be above $100B?", { conditionId: sharedCond })]],
      predictMarkets: [predictMarket(1, "Will Solana FDV be above $100B?", { conditionId: sharedCond })],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchType).toBe("conditionId");
  });

  it("skips non-binary Probable markets", async () => {
    const multiOutcome = {
      id: "multi",
      title: "Multi outcome",
      slug: "multi",
      active: true,
      tags: [],
      markets: [{
        id: "multi-mkt",
        question: "Who will win?",
        conditionId: "multi-cond",
        clobTokenIds: JSON.stringify(["a", "b", "c"]),
        outcomes: JSON.stringify(["Team A", "Team B", "Team C"]),
        tokens: [
          { token_id: "a", outcome: "Team A" },
          { token_id: "b", outcome: "Team B" },
          { token_id: "c", outcome: "Team C" },
        ],
      }],
    };

    setupFetch({
      probableEvents: [[multiOutcome]],
      predictMarkets: [],
    });

    const result = await runDiscovery(params);
    expect(result.probableMarkets).toBe(0);
  });

  it("skips Predict markets without YES/NO outcomes", async () => {
    const noOutcomes = {
      id: 99,
      title: "Broken market",
      question: "Broken?",
      conditionId: "broken-cond",
      outcomes: [{ name: "Maybe", indexSet: 3, onChainId: "tok" }],
      tradingStatus: "OPEN",
      status: "OPEN",
      categorySlug: "other",
    };

    setupFetch({
      probableEvents: [[]],
      predictMarkets: [noOutcomes],
    });

    const result = await runDiscovery(params);
    expect(result.predictMarkets).toBe(0);
  });

  it("deduplicates Predict markets across /markets and /categories", async () => {
    const mkt = predictMarket(42, "Deduplicated market");
    setupFetch({
      probableEvents: [[]],
      predictMarkets: [mkt],
      predictCategories: [{
        id: 1,
        slug: "crypto",
        title: "Crypto",
        status: "ACTIVE",
        markets: [mkt], // same market appears in categories too
      }],
    });

    const result = await runDiscovery(params);
    expect(result.predictMarkets).toBe(1); // not 2
  });

  it("handles multiple matches across different match types", async () => {
    setupFetch({
      probableEvents: [[
        probableEvent("1", "Exact condition match", { conditionId: "shared-1" }),
        probableEvent("2", "Will Solana FDV be above $200B?", { conditionId: "unique-prob-2" }),
        probableEvent("3", "Lakers vs Celtics NBA Finals 2025", { conditionId: "unique-prob-3" }),
      ]],
      predictMarkets: [
        predictMarket(1, "Exact condition match", { conditionId: "shared-1" }),
        predictMarket(2, "Will Solana FDV be above $200B?", { conditionId: "unique-pred-2" }),
        predictMarket(3, "Lakers vs Celtics NBA Finals 2025", { conditionId: "unique-pred-3" }),
      ],
    });

    const result = await runDiscovery(params);
    expect(result.matches.length).toBe(3);

    const types = result.matches.map((m) => m.matchType).sort();
    expect(types).toContain("conditionId");
    expect(types).toContain("templateMatch");
    expect(types).toContain("titleSimilarity");
  });

  // -------------------------------------------------------------------------
  // Opinion discovery tests
  // -------------------------------------------------------------------------

  const opinionParams = {
    ...params,
    opinionApiBase: "https://api.opinion.test",
    opinionApiKey: "op-key-123",
  };

  it("fetches Opinion markets and matches by title similarity", async () => {
    setupFetch({
      probableEvents: [[]],
      opinionMarkets: [opinionMarket(1, "Lakers vs Celtics NBA Finals 2025")],
      predictMarkets: [predictMarket(1, "Lakers vs Celtics NBA Finals 2025", { conditionId: "pred-cond-1" })],
    });

    const result = await runDiscovery(opinionParams);
    expect(result.opinionMarketsList.length).toBe(1);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);

    const opMatch = result.matches.find(
      (m) => m.platformA.platform === "Opinion" || m.platformB.platform === "Opinion",
    );
    expect(opMatch).toBeDefined();
    expect(Object.keys(result.opinionMarketMap).length).toBe(1);
  });

  it("Opinion matching skips conditionId pass (Opinion has no conditionId)", async () => {
    setupFetch({
      probableEvents: [[]],
      opinionMarkets: [opinionMarket(2, "Will Solana FDV be above $100B?", { conditionId: "" })],
      predictMarkets: [predictMarket(2, "Will Solana FDV be above $100B?", { conditionId: "pred-cond-2" })],
    });

    const result = await runDiscovery(opinionParams);
    expect(result.matches.length).toBe(1);
    // Should match via template or titleSimilarity, NOT conditionId
    expect(result.matches[0].matchType).not.toBe("conditionId");
  });

  it("disableProbable skips Probable fetch", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Should not be fetched")]],
      opinionMarkets: [opinionMarket(3, "Some Opinion market")],
      predictMarkets: [predictMarket(3, "Some Predict market")],
    });

    const result = await runDiscovery({ ...opinionParams, disableProbable: true });
    expect(result.probableMarkets).toBe(0);

    // Verify no Probable endpoint was called
    const calls = fetchSpy.mock.calls as Array<[string | Request, ...unknown[]]>;
    const probableCalls = calls.filter((c) => {
      const u = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return u.includes("/public/api/v1/events");
    });
    expect(probableCalls.length).toBe(0);
  });

  it("Opinion markets are filtered to statusEnum=Activated only", async () => {
    setupFetch({
      probableEvents: [[]],
      opinionMarkets: [
        opinionMarket(10, "Active market", { statusEnum: "Activated" }),
        opinionMarket(11, "Resolved market", { statusEnum: "Resolved" }),
        opinionMarket(12, "Another active", { statusEnum: "Activated" }),
      ],
      predictMarkets: [],
    });

    const result = await runDiscovery(opinionParams);
    expect(result.opinionMarketsList.length).toBe(2);
    expect(result.opinionMarketsList.every((m) => m.platform === "Opinion")).toBe(true);
  });

  it("builds correct opinionMarketMap from Opinion↔Predict matches", async () => {
    setupFetch({
      probableEvents: [[]],
      opinionMarkets: [opinionMarket(42, "Lakers vs Celtics NBA Finals 2025", {
        yesTokenId: "op-yes-42",
        noTokenId: "op-no-42",
      })],
      predictMarkets: [predictMarket(42, "Lakers vs Celtics NBA Finals 2025", {
        conditionId: "pred-cond-42",
        yesTokenId: "pred-yes-42",
        noTokenId: "pred-no-42",
      })],
    });

    const result = await runDiscovery(opinionParams);
    expect(result.matches.length).toBe(1);

    const entry = result.opinionMarketMap["pred-cond-42"];
    expect(entry).toBeDefined();
    expect(entry).toEqual({
      opinionMarketId: "42",
      yesTokenId: "op-yes-42",
      noTokenId: "op-no-42",
      topicId: "42",
    });
  });

  // -------------------------------------------------------------------------
  // Opinion ↔ Probable matching tests
  // -------------------------------------------------------------------------

  it("matches Opinion↔Probable by title similarity", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Lakers vs Celtics NBA Finals 2025", { conditionId: "prob-cond-1" })]],
      opinionMarkets: [opinionMarket(1, "Lakers vs Celtics NBA Finals 2025")],
      predictMarkets: [],
    });

    const result = await runDiscovery(opinionParams);
    expect(result.matches.length).toBe(1);

    const m = result.matches[0];
    expect(
      (m.platformA.platform === "Opinion" && m.platformB.platform === "Probable") ||
      (m.platformA.platform === "Probable" && m.platformB.platform === "Opinion"),
    ).toBe(true);
  });

  it("Opinion↔Probable match uses Probable conditionId as shared key", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Lakers vs Celtics NBA Finals 2025", {
        conditionId: "prob-cond-lakers",
        yesTokenId: "prob-yes-1",
        noTokenId: "prob-no-1",
      })]],
      opinionMarkets: [opinionMarket(1, "Lakers vs Celtics NBA Finals 2025", {
        yesTokenId: "op-yes-1",
        noTokenId: "op-no-1",
      })],
      predictMarkets: [],
    });

    const result = await runDiscovery(opinionParams);
    expect(result.matches.length).toBe(1);

    // Shared key should be Probable's conditionId
    expect(result.probableMarketMap["prob-cond-lakers"]).toEqual({
      probableMarketId: expect.any(String),
      conditionId: "prob-cond-lakers",
      yesTokenId: "prob-yes-1",
      noTokenId: "prob-no-1",
    });
    expect(result.opinionMarketMap["prob-cond-lakers"]).toEqual({
      opinionMarketId: "1",
      yesTokenId: "op-yes-1",
      noTokenId: "op-no-1",
      topicId: "1",
    });
  });

  it("deduplicates: market on all 3 platforms appears once under Predict key", async () => {
    const title = "Lakers vs Celtics NBA Finals 2025";
    setupFetch({
      probableEvents: [[probableEvent("1", title, {
        conditionId: "prob-cond-1",
        yesTokenId: "prob-yes",
        noTokenId: "prob-no",
      })]],
      opinionMarkets: [opinionMarket(1, title, {
        yesTokenId: "op-yes",
        noTokenId: "op-no",
      })],
      predictMarkets: [predictMarket(1, title, {
        conditionId: "pred-cond-1",
        yesTokenId: "pred-yes",
        noTokenId: "pred-no",
      })],
    });

    const result = await runDiscovery(opinionParams);

    // Should have 3 raw matches (P↔Pred, O↔Pred, O↔P) but dedup means
    // the Opinion↔Probable match is skipped in map building since both
    // Opinion and Probable are already covered by Predict-anchored matches.
    expect(result.matches.length).toBe(3);

    // Maps should have entries under Predict's conditionId only
    expect(Object.keys(result.predictMarketMap)).toEqual(["pred-cond-1"]);
    expect(Object.keys(result.probableMarketMap)).toEqual(["pred-cond-1"]);
    expect(Object.keys(result.opinionMarketMap)).toEqual(["pred-cond-1"]);
  });

  it("buildMatch omits probableMapEntry/predictMapEntry for Opinion↔Probable", async () => {
    setupFetch({
      probableEvents: [[probableEvent("1", "Lakers vs Celtics NBA Finals 2025", { conditionId: "prob-cond-1" })]],
      opinionMarkets: [opinionMarket(1, "Lakers vs Celtics NBA Finals 2025")],
      predictMarkets: [],
    });

    const result = await runDiscovery(opinionParams);
    expect(result.matches.length).toBe(1);
    // No Predict side → predictMapEntry should be undefined
    expect(result.matches[0].predictMapEntry).toBeUndefined();
    // Probable side → probableMapEntry should be defined
    expect(result.matches[0].probableMapEntry).toBeDefined();
  });
});
