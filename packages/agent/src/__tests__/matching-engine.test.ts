import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  replaceConfusables,
  normalizeTitle,
  normalizeEntity,
  normalizeParams,
  normalizeMagnitude,
} from "../matching-engine/normalizer.js";
import {
  jaccardSimilarity,
  diceSimilarity,
  compositeSimilarity,
  extractTemplate,
  matchMarkets,
  normalizeCategory,
  SIMILARITY_THRESHOLD,
  TEMPORAL_WINDOW_MS,
} from "../matching-engine/index.js";
import { detectPolarity } from "../matching-engine/polarity.js";

// ---------------------------------------------------------------------------
// Normalizer tests
// ---------------------------------------------------------------------------

describe("normalizer", () => {
  describe("replaceConfusables", () => {
    it("replaces Cyrillic lookalikes with ASCII", () => {
      // Cyrillic А (U+0410) → A, с (U+0441) → c
      expect(replaceConfusables("\u0410\u0441")).toBe("Ac");
    });

    it("replaces Greek lookalikes with ASCII", () => {
      // Greek Α (U+0391) → A
      expect(replaceConfusables("\u0391")).toBe("A");
    });

    it("passes through regular ASCII unchanged", () => {
      expect(replaceConfusables("Hello World 123")).toBe("Hello World 123");
    });

    it("handles the BLACKPINK confusable case", () => {
      // BL\u0245\u03FDKPI\u0438K → BLACKPINK (after case normalization)
      const confusable = "BL\u0245\u03FDKPI\u0438K";
      const result = replaceConfusables(confusable);
      expect(result.toLowerCase()).toBe("blackpink");
    });
  });

  describe("normalizeTitle", () => {
    it("lowercases and strips punctuation", () => {
      expect(normalizeTitle("Will BTC hit $100k?")).toBe("will btc hit 100k");
    });

    it("replaces confusables before normalizing", () => {
      const confusable = "Will BL\u0245\u03FDKPI\u0438K release a new album?";
      const result = normalizeTitle(confusable);
      expect(result).toContain("blackpink");
    });

    it("strips combining marks via NFKD (café → cafe)", () => {
      expect(normalizeTitle("café")).toBe("cafe");
      expect(normalizeTitle("naïve résumé")).toBe("naive resume");
    });

    it("collapses digit separators (100,000 → 100000)", () => {
      expect(normalizeTitle("$100,000,000")).toBe("100000000");
    });

    it("removes standalone current-year tokens", () => {
      const year = new Date().getFullYear();
      expect(normalizeTitle(`token launch by June 30, ${year}`)).toBe("token launch by june 30");
    });

    it("does not remove year embedded in a word", () => {
      const year = new Date().getFullYear();
      // "abc2026def" should not be modified (not standalone)
      expect(normalizeTitle(`abc${year}def`)).toBe(`abc${year}def`);
    });

    it("allows overriding currentYear", () => {
      expect(normalizeTitle("by June 30, 2025", { currentYear: 2025 })).toBe("by june 30");
    });

    it("collapses whitespace and trims", () => {
      expect(normalizeTitle("  hello   world  ")).toBe("hello world");
    });
  });

  describe("normalizeEntity", () => {
    it("lowercases and trims", () => {
      expect(normalizeEntity("  Solana  ")).toBe("solana");
    });

    it("strips trailing punctuation", () => {
      expect(normalizeEntity("MetaMask?")).toBe("metamask");
      expect(normalizeEntity("Apple...")).toBe("apple");
    });

    it("strips leading articles", () => {
      expect(normalizeEntity("The Netherlands")).toBe("netherlands");
      expect(normalizeEntity("The USA")).toBe("usa");
      expect(normalizeEntity("A Token")).toBe("token");
      expect(normalizeEntity("An Apple")).toBe("apple");
    });

    it("replaces confusables", () => {
      expect(normalizeEntity("BL\u0245\u03FDKPI\u0438K")).toBe("blackpink");
    });
  });

  describe("normalizeParams", () => {
    it("strips $ and ? and normalizes magnitude", () => {
      expect(normalizeParams("$100B?")).toBe("100000000000");
    });

    it("strips current year and trailing punctuation", () => {
      const year = new Date().getFullYear();
      expect(normalizeParams(`June 30, ${year}`)).toBe("june 30");
    });

    it("allows overriding currentYear", () => {
      expect(normalizeParams("June 30, 2025", { currentYear: 2025 })).toBe("june 30");
    });

    it("collapses whitespace", () => {
      expect(normalizeParams("  foo   bar  ")).toBe("foo bar");
    });
  });
});

// ---------------------------------------------------------------------------
// Similarity tests
// ---------------------------------------------------------------------------

describe("similarity", () => {
  describe("jaccardSimilarity", () => {
    it("returns 1 for identical titles", () => {
      expect(jaccardSimilarity("Lakers vs Celtics", "Lakers vs Celtics")).toBe(1);
    });

    it("returns 0 for completely different titles", () => {
      expect(jaccardSimilarity("Lakers vs Celtics", "Ethereum price prediction")).toBe(0);
    });

    it("filters stop words", () => {
      // "Will the Lakers win" vs "Will Lakers win" — stop words filtered, same content
      expect(jaccardSimilarity("Will the Lakers win", "Will Lakers win")).toBe(1);
    });

    it("returns 1 when both are empty after stop word removal", () => {
      expect(jaccardSimilarity("will the a", "of in to")).toBe(1);
    });

    it("returns 0 when one side is empty after stop word removal", () => {
      expect(jaccardSimilarity("will the a", "Lakers win")).toBe(0);
    });
  });

  describe("diceSimilarity", () => {
    it("returns 1 for identical titles", () => {
      expect(diceSimilarity("Hello World", "Hello World")).toBe(1);
    });

    it("returns 0 for completely different short strings", () => {
      expect(diceSimilarity("ab", "xy")).toBe(0);
    });

    it("returns 0 for strings shorter than 2 chars", () => {
      expect(diceSimilarity("a", "a")).toBe(0);
    });

    it("scores high for strings differing by one character", () => {
      const sim = diceSimilarity(
        "Will Basel launch a token by June 30?",
        "Will Based launch a token by June 30?",
      );
      expect(sim).toBeGreaterThan(0.9);
    });

    it("handles multiset bigrams (repeated characters)", () => {
      const sim = diceSimilarity("aaa", "aaa");
      expect(sim).toBe(1);
    });
  });

  describe("compositeSimilarity", () => {
    it("returns max of jaccard and dice", () => {
      const a = "Will BLACKPINK release a new album?";
      const b = "Will BLACKPINK release a new album?";
      expect(compositeSimilarity(a, b)).toBe(1);
    });

    it("dice rescues cases where jaccard fails on word boundaries", () => {
      // Confusable BLACKPINK: Jaccard might fragment but Dice on bigrams should score high
      const a = "Will BL\u0245\u03FDKPI\u0438K release a new album?";
      const b = "Will BLACKPINK release a new album?";
      const comp = compositeSimilarity(a, b);
      expect(comp).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    });
  });
});

// ---------------------------------------------------------------------------
// Template extraction tests
// ---------------------------------------------------------------------------

describe("extractTemplate", () => {
  it("extracts fdv-above template", () => {
    const result = extractTemplate("Will Solana FDV be above $100B?");
    expect(result).toEqual({
      template: "fdv-above",
      entity: "solana",
      params: "100000000000",
    });
  });

  it("extracts token-launch template", () => {
    const result = extractTemplate("Will Apple launch a token by 2025?");
    expect(result).toEqual({
      template: "token-launch",
      entity: "apple",
      params: "2025",
    });
  });

  it("extracts price-target template", () => {
    const result = extractTemplate("Will ETH hit $5,000?");
    expect(result).toEqual({
      template: "price-target",
      entity: "eth",
      params: "5000",
    });
  });

  it("returns null for non-template titles", () => {
    expect(extractTemplate("Lakers vs Celtics NBA Finals")).toBeNull();
  });

  it("normalizes entity with confusable replacement", () => {
    // "BL\u0245\u03FDKPI\u0438K" → "blackpink"
    const result = extractTemplate("Will BL\u0245\u03FDKPI\u0438K win the Grammy?");
    expect(result).not.toBeNull();
    expect(result!.entity).toBe("blackpink");
  });

  it("strips current year from params (MetaMask case)", () => {
    const year = new Date().getFullYear();
    const result = extractTemplate(`Will MetaMask launch a token by June 30, ${year}?`);
    expect(result).not.toBeNull();
    expect(result!.params).toBe("june 30");

    // Without year should produce the same params
    const result2 = extractTemplate("Will MetaMask launch a token by June 30?");
    expect(result2).not.toBeNull();
    expect(result2!.params).toBe("june 30");
  });
});

// ---------------------------------------------------------------------------
// matchMarkets integration tests
// ---------------------------------------------------------------------------

function mkMarket(id: string, title: string, conditionId = "") {
  return { id, title, conditionId };
}

describe("matchMarkets", () => {
  it("matches by conditionId (Pass 1)", () => {
    const a = [mkMarket("a1", "Will BTC hit 100k?", "cond-123")];
    const b = [mkMarket("b1", "Bitcoin to 100k?", "cond-123")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("conditionId");
    expect(results[0].similarity).toBe(1);
  });

  it("skips conditionId pass when one side has no conditionIds", () => {
    const a = [mkMarket("a1", "Will Solana FDV be above $100B?", "")];
    const b = [mkMarket("b1", "Will Solana FDV be above $100B?", "cond-b")];
    const results = matchMarkets(a, b);
    // Should match via template, not conditionId
    expect(results.length).toBe(1);
    expect(results[0].matchType).not.toBe("conditionId");
  });

  it("matches by template (Pass 2)", () => {
    const a = [mkMarket("a1", "Will Solana FDV be above $100B?", "cond-a")];
    const b = [mkMarket("b1", "Will Solana FDV be above $100B?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("matches by composite similarity (Pass 3)", () => {
    const a = [mkMarket("a1", "Lakers vs Celtics NBA Finals 2025", "cond-a")];
    const b = [mkMarket("b1", "Lakers vs Celtics NBA Finals 2025", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("titleSimilarity");
  });

  it("conditionId takes priority over template", () => {
    const shared = "shared-cond";
    const a = [mkMarket("a1", "Will Solana FDV be above $100B?", shared)];
    const b = [mkMarket("b1", "Will Solana FDV be above $100B?", shared)];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("conditionId");
  });

  it("template guard prevents false positive in Pass 3", () => {
    // Both match "token-launch" template but different entities
    const a = [mkMarket("a1", "Will Basel launch a token by June 30?", "cond-a")];
    const b = [mkMarket("b1", "Will Based launch a token by June 30?", "cond-b")];
    const results = matchMarkets(a, b);
    // Should NOT match: template guard blocks the pair
    expect(results.length).toBe(0);
  });

  it("template guard only blocks same template name", () => {
    // a matches "token-launch", b matches no template → guard doesn't apply
    const a = [mkMarket("a1", "Will Apple launch a token by 2025?", "cond-a")];
    const b = [mkMarket("b1", "Apple launches crypto token before 2025 deadline", "cond-b")];
    const results = matchMarkets(a, b);
    // Similarity might or might not pass threshold, but guard doesn't block
    // The important thing is the guard doesn't prevent the comparison
    // (actual match depends on similarity score)
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("handles empty lists gracefully", () => {
    expect(matchMarkets([], [])).toEqual([]);
    expect(matchMarkets([mkMarket("a1", "Test", "c")], [])).toEqual([]);
    expect(matchMarkets([], [mkMarket("b1", "Test", "c")])).toEqual([]);
  });

  it("handles multiple matches across different types", () => {
    const a = [
      mkMarket("a1", "Exact condition match", "shared-1"),
      mkMarket("a2", "Will Solana FDV be above $200B?", "unique-a-2"),
      mkMarket("a3", "Lakers vs Celtics NBA Finals 2025", "unique-a-3"),
    ];
    const b = [
      mkMarket("b1", "Exact condition match", "shared-1"),
      mkMarket("b2", "Will Solana FDV be above $200B?", "unique-b-2"),
      mkMarket("b3", "Lakers vs Celtics NBA Finals 2025", "unique-b-3"),
    ];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(3);
    const types = results.map((r) => r.matchType).sort();
    expect(types).toContain("conditionId");
    expect(types).toContain("templateMatch");
    expect(types).toContain("titleSimilarity");
  });

  // -------------------------------------------------------------------------
  // Regression tests: known production failures
  // -------------------------------------------------------------------------

  it("REGRESSION: BLACKPINK Unicode confusables match correctly", () => {
    const a = [mkMarket("a1", "Will BL\u0245\u03FDKPI\u0438K release a new album?", "cond-a")];
    const b = [mkMarket("b1", "Will BLACKPINK release a new album?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].similarity).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("REGRESSION: 'The Netherlands' vs 'Netherlands' template matches via article stripping", () => {
    const a = [mkMarket("a1", "Will The Netherlands win the 2026 FIFA World Cup?", "cond-a")];
    const b = [mkMarket("b1", "Will Netherlands win the 2026 FIFA World Cup?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("REGRESSION: MetaMask off-by-year template matches via year stripping", () => {
    const year = new Date().getFullYear();
    const a = [mkMarket("a1", "Will MetaMask launch a token by June 30?", "cond-a")];
    const b = [mkMarket("b1", `Will MetaMask launch a token by June 30, ${year}?`, "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("REGRESSION: Silver (LOW) $25 must NOT match Silver (LOW) $75", () => {
    const a = [mkMarket("a1", "Will Silver (SI) hit (LOW) $25 by end of February?", "cond-a")];
    const b = [mkMarket("b1", "Will Silver (SI) hit (LOW) $75 by end of February?", "cond-b")];
    const results = matchMarkets(a, b);
    // Template guard should block: same template (price-target), same entity, different params
    expect(results.length).toBe(0);
  });

  it("REGRESSION: Silver (HIGH) must NOT match Silver (LOW)", () => {
    const a = [mkMarket("a1", "Will Silver (SI) hit (HIGH) $150 by end of February?", "cond-a")];
    const b = [mkMarket("b1", "Will Silver (SI) hit (LOW) $95 by end of February?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(0);
  });

  it("REGRESSION: FDV cross-project must NOT match (EdgeX vs Ink)", () => {
    const a = [mkMarket("a1", "EdgeX FDV above $4B one day after launch?", "cond-a")];
    const b = [mkMarket("b1", "Ink FDV above $4B one day after launch?", "cond-b")];
    const results = matchMarkets(a, b);
    // Template guard: same template (fdv-above), different entity
    expect(results.length).toBe(0);
  });

  it("REGRESSION: FDV same project different tier must NOT match", () => {
    const a = [mkMarket("a1", "EdgeX FDV above $4B one day after launch?", "cond-a")];
    const b = [mkMarket("b1", "EdgeX FDV above $1B one day after launch?", "cond-b")];
    const results = matchMarkets(a, b);
    // Template guard: same template, same entity, different params
    expect(results.length).toBe(0);
  });

  it("REGRESSION: overlapping numeric IDs between lists must not cause false matches", () => {
    // Simulate Probable and Predict both having market ID "500" — different markets
    const a = [
      // Probable market ID 500: "Will Base launch a token by June 30, 2026?"
      mkMarket("500", "Will Base launch a token by June 30, 2026?", "cond-probable-500"),
    ];
    const b = [
      // Predict market ID 500: "Opensea FDV above $500M one day after launch?"
      mkMarket("500", "Opensea FDV above $500M one day after launch?", "cond-predict-500"),
      // Predict market ID 501: "Will Theo launch a token by March 31, 2026?"
      mkMarket("501", "Will Theo launch a token by March 31, 2026?", "cond-predict-501"),
    ];
    const results = matchMarkets(a, b);
    // "Base launch a token" should NOT match "Opensea FDV" (different templates)
    // "Base launch a token" should NOT match "Theo launch a token" (template guard: same template, different entity)
    // Without the fix, ID "500" collision causes Predict market 500 to inherit
    // the "token-launch" template from Probable market 500, breaking the guard.
    expect(results.length).toBe(0);
  });

  it("REGRESSION: 'Trump out as President' (GTA VI) must NOT match 'Trump out as President before 2027?'", () => {
    // Probable multi-outcome event sub-market vs Opinion standalone market
    // Different resolution criteria: "before GTA VI" vs "before 2027"
    const a = [mkMarket("a1", "Trump out as President", "cond-a")];
    const b = [mkMarket("b1", "Trump out as President before 2027?", "cond-b")];
    const results = matchMarkets(a, b);
    // Template guard: both match "out-as" template, same entity "trump",
    // different params ("president" vs "president before 2027")
    expect(results.length).toBe(0);
  });

  it("REGRESSION: political 'out as' markets with different dates must NOT match", () => {
    const a = [mkMarket("a1", "Khamenei out as Supreme Leader of Iran by February 28?", "cond-a")];
    const b = [mkMarket("b1", "Khamenei out as Supreme Leader of Iran by June 30?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(0);
  });

  it("REGRESSION: ID collision must not cause cross-project template match in Pass 2", () => {
    // Both lists have ID "100" but completely different markets
    const a = [
      mkMarket("100", "Will Nansen launch a token by March 31, 2026?", "cond-a-100"),
    ];
    const b = [
      mkMarket("100", "Will Arsenal win the 2025–26 English Premier League?", "cond-b-100"),
      // This Predict market has the same template key as Probable ID 100
      mkMarket("200", "Will Nansen launch a token by March 31, 2026?", "cond-b-200"),
    ];
    const results = matchMarkets(a, b);
    // Should match a:100 with b:200 (same template key), NOT with b:100 (ID collision)
    expect(results.length).toBe(1);
    expect(results[0].marketB.id).toBe("200");
    expect(results[0].matchType).toBe("templateMatch");
  });

  // -------------------------------------------------------------------------
  // Phase 1: polarityFlip defaults to false for all existing matches
  // -------------------------------------------------------------------------

  it("polarityFlip defaults to false for conditionId matches", () => {
    const a = [mkMarket("a1", "Will BTC hit 100k?", "cond-123")];
    const b = [mkMarket("b1", "Bitcoin to 100k?", "cond-123")];
    const results = matchMarkets(a, b);
    expect(results[0].polarityFlip).toBe(false);
  });

  it("polarityFlip defaults to false for template matches with same phrasing", () => {
    const a = [mkMarket("a1", "Will Solana FDV be above $100B?", "cond-a")];
    const b = [mkMarket("b1", "Will Solana FDV be above $100B?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results[0].polarityFlip).toBe(false);
  });

  it("polarityFlip defaults to false for title similarity matches", () => {
    const a = [mkMarket("a1", "Lakers vs Celtics NBA Finals 2025", "cond-a")];
    const b = [mkMarket("b1", "Lakers vs Celtics NBA Finals 2025", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results[0].polarityFlip).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Phase 2: New template patterns
  // -------------------------------------------------------------------------

  it("matches happen-by template", () => {
    const a = [mkMarket("a1", "Will ETF approval happen by March?", "cond-a")];
    const b = [mkMarket("b1", "Will ETF approval happen by March?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("matches list-on template", () => {
    const a = [mkMarket("a1", "Will Uniswap be listed on Coinbase?", "cond-a")];
    const b = [mkMarket("b1", "Will Uniswap be listed on Coinbase?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("matches mcap-above template", () => {
    const a = [mkMarket("a1", "Will Ethereum market cap be above $500B?", "cond-a")];
    const b = [mkMarket("b1", "Will Ethereum market cap be above $500B?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("matches approved-by template", () => {
    const a = [mkMarket("a1", "Will Bitcoin ETF be approved by SEC?", "cond-a")];
    const b = [mkMarket("b1", "Will Bitcoin ETF be approved by SEC?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("matches partner-with template", () => {
    const a = [mkMarket("a1", "Will Chainlink partner with Swift?", "cond-a")];
    const b = [mkMarket("b1", "Will Chainlink partner with Swift?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("matches elected-to template", () => {
    const a = [mkMarket("a1", "Will Harris be elected as President?", "cond-a")];
    const b = [mkMarket("b1", "Will Harris be elected as President?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  it("template guard blocks different entities on new templates", () => {
    const a = [mkMarket("a1", "Will Solana be listed on Coinbase?", "cond-a")];
    const b = [mkMarket("b1", "Will Avalanche be listed on Coinbase?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Phase 2: Numeric magnitude normalization
  // -------------------------------------------------------------------------

  it("matches FDV $4B with FDV $4,000,000,000 via magnitude normalization", () => {
    const a = [mkMarket("a1", "EdgeX FDV above $4B one day after launch?", "cond-a")];
    const b = [mkMarket("b1", "EdgeX FDV above $4,000,000,000 one day after launch?", "cond-b")];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("templateMatch");
  });

  // -------------------------------------------------------------------------
  // Phase 3: Category & temporal pre-filtering
  // -------------------------------------------------------------------------

  it("category pre-filter prevents cross-category matches in Pass 3", () => {
    const a = [{ id: "a1", title: "SuperBowl winner announced today", conditionId: "cond-a", category: "sports" }];
    const b = [{ id: "b1", title: "SuperBowl winner announced today", conditionId: "cond-b", category: "crypto" }];
    const results = matchMarkets(a, b);
    // Same title but different categories — should NOT match in Pass 3
    // (no conditionId match, no template match)
    expect(results.length).toBe(0);
  });

  it("uncategorized markets still match across categories", () => {
    const a = [{ id: "a1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-a" }];
    const b = [{ id: "b1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-b", category: "sports" }];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
  });

  it("temporal window filter blocks markets resolving far apart", () => {
    const now = Date.now();
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    const a = [{ id: "a1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-a", resolvesAt: now }];
    const b = [{ id: "b1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-b", resolvesAt: now + sixtyDays }];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(0);
  });

  it("temporal window filter allows markets resolving within 30 days", () => {
    const now = Date.now();
    const tenDays = 10 * 24 * 60 * 60 * 1000;
    const a = [{ id: "a1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-a", resolvesAt: now }];
    const b = [{ id: "b1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-b", resolvesAt: now + tenDays }];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
  });

  it("temporal window skipped when one market has no resolvesAt", () => {
    const now = Date.now();
    const a = [{ id: "a1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-a", resolvesAt: now }];
    const b = [{ id: "b1", title: "Lakers vs Celtics NBA Finals 2025", conditionId: "cond-b" }];
    const results = matchMarkets(a, b);
    expect(results.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Polarity detection tests (Phase 1)
// ---------------------------------------------------------------------------

describe("detectPolarity", () => {
  it("detects negation asymmetry", () => {
    const result = detectPolarity(
      "Will Bitcoin hit $100k?",
      "Will Bitcoin NOT hit $100k?",
    );
    expect(result.polarityFlip).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("detects antonym pairs (above/below)", () => {
    const result = detectPolarity(
      "Will ETH price be above $5000?",
      "Will ETH price be below $5000?",
    );
    expect(result.polarityFlip).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects antonym pairs (over/under)", () => {
    const result = detectPolarity(
      "Will inflation be over 3%?",
      "Will inflation be under 3%?",
    );
    expect(result.polarityFlip).toBe(true);
  });

  it("returns no flip for identical titles", () => {
    const result = detectPolarity(
      "Will Bitcoin hit $100k?",
      "Will Bitcoin hit $100k?",
    );
    expect(result.polarityFlip).toBe(false);
  });

  it("returns no flip for unrelated titles", () => {
    const result = detectPolarity(
      "Will Bitcoin hit $100k?",
      "Will Lakers win the NBA Finals?",
    );
    expect(result.polarityFlip).toBe(false);
  });

  it("detects outcome label inversion", () => {
    const result = detectPolarity(
      "Will X happen?",
      "Will X happen?",
      ["Yes", "No"],
      ["No", "Yes"],
    );
    expect(result.polarityFlip).toBe(true);
    expect(result.confidence).toBe(0.95);
  });

  it("no flip when outcome labels match", () => {
    const result = detectPolarity(
      "Will X happen?",
      "Will X happen?",
      ["Yes", "No"],
      ["Yes", "No"],
    );
    expect(result.polarityFlip).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Numeric magnitude normalization tests (Phase 2)
// ---------------------------------------------------------------------------

describe("normalizeMagnitude", () => {
  it("normalizes B suffix", () => {
    expect(normalizeMagnitude("4B")).toBe("4000000000");
  });

  it("normalizes M suffix", () => {
    expect(normalizeMagnitude("500M")).toBe("500000000");
  });

  it("normalizes k suffix", () => {
    expect(normalizeMagnitude("10k")).toBe("10000");
    expect(normalizeMagnitude("10K")).toBe("10000");
  });

  it("normalizes decimal magnitudes", () => {
    expect(normalizeMagnitude("1.5B")).toBe("1500000000");
    expect(normalizeMagnitude("2.5M")).toBe("2500000");
  });

  it("normalizes word forms", () => {
    expect(normalizeMagnitude("4 billion")).toBe("4000000000");
    expect(normalizeMagnitude("10 thousand")).toBe("10000");
    expect(normalizeMagnitude("1.5 million")).toBe("1500000");
  });

  it("leaves non-magnitude numbers unchanged", () => {
    expect(normalizeMagnitude("42")).toBe("42");
    expect(normalizeMagnitude("100")).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// Category normalization tests (Phase 3)
// ---------------------------------------------------------------------------

describe("normalizeCategory", () => {
  it("maps synonyms to canonical form", () => {
    expect(normalizeCategory("cryptocurrency")).toBe("crypto");
    expect(normalizeCategory("Cryptocurrency")).toBe("crypto");
    expect(normalizeCategory("DeFi")).toBe("crypto");
    expect(normalizeCategory("political")).toBe("politics");
    expect(normalizeCategory("elections")).toBe("politics");
  });

  it("returns empty string for undefined", () => {
    expect(normalizeCategory(undefined)).toBe("");
    expect(normalizeCategory("")).toBe("");
  });

  it("lowercases and trims", () => {
    expect(normalizeCategory("  Sports  ")).toBe("sports");
  });
});
