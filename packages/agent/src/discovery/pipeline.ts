import { log } from "../logger.js";
import { matchMarkets, compositeSimilarity } from "../matching-engine/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredMarket {
  platform: "Probable" | "Predict" | "Opinion" | string;
  id: string;
  title: string;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  category?: string;
  hasLiquidity: boolean;
  resolvesAt?: string; // ISO date string when market resolves
  /** Opinion-specific: marketId used as topicId for order placement */
  topicId?: string;
  /** Opinion-specific: 0 = singular binary, non-0 = multi-outcome topic */
  opinionMarketType?: number;
  /** Probable/Predict slug (shared, sourced from Probable side) */
  slug?: string;
}

export interface MarketMatch {
  platformA: DiscoveredMarket;
  platformB: DiscoveredMarket;
  matchType: "conditionId" | "templateMatch" | "titleSimilarity";
  similarity: number;
  /** @deprecated use platformA/platformB directly */
  probable: DiscoveredMarket;
  /** @deprecated use platformA/platformB directly */
  predict: DiscoveredMarket;
  probableMapEntry?: { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string };
  predictMapEntry?: { predictMarketId: string; yesTokenId: string; noTokenId: string };
}

export interface OpinionMapEntry {
  opinionMarketId: string;
  yesTokenId: string;
  noTokenId: string;
  topicId: string;
}

export interface DiscoveryResult {
  discoveredAt: string;
  probableMarkets: number;
  predictMarkets: number;
  probableMarketsList: DiscoveredMarket[];
  predictMarketsList: DiscoveredMarket[];
  opinionMarketsList: DiscoveredMarket[];
  matches: MarketMatch[];
  probableMarketMap: Record<string, { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string }>;
  predictMarketMap: Record<string, { predictMarketId: string; yesTokenId: string; noTokenId: string }>;
  opinionMarketMap: Record<string, OpinionMapEntry>;
  /** Maps shared market key → market title (from Predict or best available) */
  titleMap: Record<string, string>;
  /** Maps shared market key → per-platform URLs */
  linkMap: Record<string, { predict?: string; probable?: string; opinion?: string }>;
}

// ---------------------------------------------------------------------------
// Probable API types (mirrors probable-provider.ts)
// ---------------------------------------------------------------------------

interface ProbableEvent {
  id: string;
  title: string;
  slug: string;
  active: boolean;
  tags: Array<{ id: number; label: string; slug: string }>;
  markets: ProbableMarketRaw[];
}

interface ProbableMarketRaw {
  id: string;
  question: string;
  condition_id?: string; // snake_case from Probable API
  conditionId?: string;  // camelCase fallback (some endpoints)
  clobTokenIds: string; // JSON string: '["yesTokenId","noTokenId"]'
  outcomes: string;     // JSON string: '["Yes","No"]'
  tokens: Array<{ token_id: string; outcome: string }>;
}

// ---------------------------------------------------------------------------
// Predict API types (mirrors discover-markets.ts)
// ---------------------------------------------------------------------------

interface PredictOutcome {
  name: string;
  indexSet: number; // 1 = YES, 2 = NO
  onChainId: string;
}

interface PredictMarketRaw {
  id: number;
  title: string;
  question: string;
  conditionId: string;
  outcomes: PredictOutcome[];
  tradingStatus: string;
  status: string;
  categorySlug: string;
  endDate?: string;
  closeDate?: string;
}

interface PredictMarketsListResponse {
  success: boolean;
  data: PredictMarketRaw[];
  cursor?: string;
}

interface PredictCategoryRaw {
  id: number;
  slug: string;
  title: string;
  status: string;
  markets: PredictMarketRaw[];
}

interface PredictCategoriesListResponse {
  success: boolean;
  data: PredictCategoryRaw[];
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}


// ---------------------------------------------------------------------------
// Fetch Probable events (paginated, reuses discoverEvents() pattern)
// ---------------------------------------------------------------------------

async function fetchProbableMarkets(
  eventsApiBase: string,
): Promise<DiscoveredMarket[]> {
  const PAGE_SIZE = 100;
  const allEvents: ProbableEvent[] = [];
  let offset = 0;

  while (true) {
    const url = `${eventsApiBase}/public/api/v1/events?active=true&limit=${PAGE_SIZE}&offset=${offset}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      log.error("Probable events fetch failed", { offset, error: String(err) });
      break;
    }

    if (!res.ok) {
      log.error("Probable events API error", { status: res.status, offset });
      break;
    }

    const events = (await res.json()) as ProbableEvent[];
    if (!Array.isArray(events) || events.length === 0) break;

    allEvents.push(...events);
    log.info("Probable: fetched events page", { offset, count: events.length, total: allEvents.length });

    if (events.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Flatten events -> individual markets
  const discovered: DiscoveredMarket[] = [];

  for (const event of allEvents) {
    if (!event.markets || !Array.isArray(event.markets)) continue;

    for (const market of event.markets) {
      // Parse outcomes — must be YES/NO binary
      let outcomes: string[];
      try {
        outcomes = JSON.parse(market.outcomes);
      } catch {
        continue;
      }
      if (outcomes.length !== 2) continue;

      const hasYesNo =
        outcomes.some((o) => o.toLowerCase() === "yes") &&
        outcomes.some((o) => o.toLowerCase() === "no");
      if (!hasYesNo) continue;

      // Determine YES/NO token IDs — prefer explicit tokens array over positional clobTokenIds
      let yesTokenId: string | undefined;
      let noTokenId: string | undefined;

      if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
        const yesToken = market.tokens.find((t) => t.outcome.toLowerCase() === "yes");
        const noToken = market.tokens.find((t) => t.outcome.toLowerCase() === "no");
        if (yesToken && noToken) {
          yesTokenId = yesToken.token_id;
          noTokenId = noToken.token_id;
        }
      }

      // Fallback to clobTokenIds + outcomes parallel arrays
      if (!yesTokenId || !noTokenId) {
        let tokenIds: string[];
        try {
          tokenIds = JSON.parse(market.clobTokenIds);
        } catch {
          continue;
        }
        if (tokenIds.length !== 2) continue;

        const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
        const noIdx = outcomes.findIndex((o) => o.toLowerCase() === "no");
        if (yesIdx === -1 || noIdx === -1) continue;

        yesTokenId = tokenIds[yesIdx];
        noTokenId = tokenIds[noIdx];
      }

      if (!yesTokenId || !noTokenId) continue;

      // conditionId: prefer snake_case (Probable API), then camelCase, then market id
      const conditionId = market.condition_id || market.conditionId || market.id;

      // Try various date field names that prediction market APIs commonly use
      const rawEvent = event as unknown as Record<string, unknown>;
      const rawMarket = market as unknown as Record<string, unknown>;
      const endDateStr = (rawEvent.end_date ?? rawEvent.endDate ?? rawEvent.close_time ??
                          rawEvent.resolution_date ?? rawMarket.end_date ?? rawMarket.endDate ??
                          rawMarket.close_time ?? rawMarket.closeTime) as string | undefined;

      let resolvesAt: string | undefined;
      if (endDateStr) {
        try {
          const parsed = new Date(endDateStr);
          if (!isNaN(parsed.getTime())) resolvesAt = parsed.toISOString();
        } catch {
          // ignore invalid dates
        }
      }

      discovered.push({
        platform: "Probable",
        id: market.id,
        title: market.question || event.title,
        conditionId,
        yesTokenId,
        noTokenId,
        category: event.tags?.[0]?.label,
        hasLiquidity: true, // Will be refined below if we add orderbook checks
        resolvesAt,
        slug: event.slug,
      });
    }
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Fetch Predict markets (paginated, reuses discover-markets.ts pattern)
// ---------------------------------------------------------------------------

async function fetchPredictMarkets(
  apiBase: string,
  apiKey: string,
): Promise<DiscoveredMarket[]> {
  const seen = new Map<number, PredictMarketRaw>();
  let cursor: string | undefined;
  const MAX_PAGES = 100; // safety cap

  for (let page = 0; page < MAX_PAGES; page++) {
    let path = `/v1/markets?status=OPEN&first=50`;
    if (cursor) path += `&after=${encodeURIComponent(cursor)}`;

    let resp: PredictMarketsListResponse;
    try {
      const url = `${apiBase}${path}`;
      const res = await fetch(url, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        log.error("Predict markets API error", { status: res.status, page });
        break;
      }
      resp = (await res.json()) as PredictMarketsListResponse;
    } catch (err) {
      log.error("Predict markets fetch failed", { page, error: String(err) });
      break;
    }

    if (!resp.success || !Array.isArray(resp.data)) {
      log.error("Unexpected Predict markets response", { page });
      break;
    }

    for (const m of resp.data) {
      if (!seen.has(m.id)) seen.set(m.id, m);
    }

    log.info("Predict: fetched markets page", { page: page + 1, unique: seen.size });

    if (!resp.cursor || resp.data.length < 50) break;
    cursor = resp.cursor;
    await sleep(150); // rate limit
  }

  // Also fetch from /v1/categories — many markets (especially multi-outcome
  // events) only appear here, not in /v1/markets.
  // Cap at 30 pages (~1500 categories) to keep startup under 30s.
  const CAT_PAGE_CAP = 30;
  let catCursor: string | undefined;
  for (let page = 0; page < CAT_PAGE_CAP; page++) {
    let path = `/v1/categories?first=50`;
    if (catCursor) path += `&after=${encodeURIComponent(catCursor)}`;

    try {
      const url = `${apiBase}${path}`;
      const res = await fetch(url, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) break;
      const resp = (await res.json()) as PredictCategoriesListResponse;
      if (!resp.success || !Array.isArray(resp.data)) break;

      for (const cat of resp.data) {
        if (!cat.markets) continue;
        for (const m of cat.markets) {
          if (!seen.has(m.id)) seen.set(m.id, m);
        }
      }

      log.info("Predict: fetched categories page", { page: page + 1, unique: seen.size });

      if (!resp.cursor || resp.data.length < 50) break;
      catCursor = resp.cursor;
      await sleep(150);
    } catch (err) {
      log.error("Predict categories fetch failed", { page, error: String(err) });
      break;
    }
  }

  // Build discovered list (skip per-market orderbook check — too slow for
  // thousands of markets and the scan loop filters by liquidity in real-time)
  const discovered: DiscoveredMarket[] = [];

  for (const m of seen.values()) {
    // Must have exactly YES (indexSet=1) and NO (indexSet=2) outcomes
    const yes = m.outcomes.find((o) => o.indexSet === 1);
    const no = m.outcomes.find((o) => o.indexSet === 2);
    if (!yes || !no) continue;

    const endDate = m.endDate ?? m.closeDate ?? (m as unknown as Record<string, unknown>).end_date as string | undefined;
    let resolvesAt: string | undefined;
    if (endDate) {
      try {
        const parsed = new Date(endDate);
        if (!isNaN(parsed.getTime())) resolvesAt = parsed.toISOString();
      } catch { /* ignore */ }
    }

    discovered.push({
      platform: "Predict",
      id: String(m.id),
      title: m.question || m.title, // prefer full question over short option name
      conditionId: m.conditionId,
      yesTokenId: yes.onChainId,
      noTokenId: no.onChainId,
      category: m.categorySlug,
      hasLiquidity: true, // checked at scan time, not discovery time
      resolvesAt,
    });
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Fetch Opinion markets (paginated)
// ---------------------------------------------------------------------------

interface OpinionMarketRaw {
  marketId: number;
  marketTitle: string;
  statusEnum: string; // "Activated", "Resolved", etc.
  marketType: number; // 0 = singular binary, non-0 = multi-outcome topic
  labels: string[];
  yesTokenId: string;
  noTokenId: string;
  conditionId: string; // always "" in practice
  cutoffAt: number; // unix timestamp
  yesLabel?: string;
  noLabel?: string;
  childMarkets?: unknown[] | null;
}

interface OpinionMarketsResponse {
  errno: number;
  result: {
    total: number;
    list: OpinionMarketRaw[];
  };
}

async function fetchOpinionMarkets(
  apiBase: string,
  apiKey: string,
): Promise<DiscoveredMarket[]> {
  const PAGE_SIZE = 10; // Opinion API max
  const allMarkets: OpinionMarketRaw[] = [];
  let page = 1;
  const MAX_PAGES = 50; // safety cap: 500 markets

  while (page <= MAX_PAGES) {
    let res: Response;
    try {
      const url = `${apiBase}/market?page=${page}&pageSize=${PAGE_SIZE}`;
      res = await fetch(url, {
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      log.error("Opinion markets fetch failed", { page, error: String(err) });
      break;
    }

    if (res.status === 429) {
      log.warn("Opinion rate limited, backing off", { page });
      await sleep(2000);
      continue;
    }

    if (!res.ok) {
      log.error("Opinion markets API error", { status: res.status, page });
      break;
    }

    const data = (await res.json()) as OpinionMarketsResponse;
    if (data.errno !== 0 || !data.result?.list) {
      log.error("Unexpected Opinion markets response", { page, errno: data.errno });
      break;
    }

    allMarkets.push(...data.result.list);
    log.info("Opinion: fetched markets page", { page, count: data.result.list.length, total: allMarkets.length });

    if (allMarkets.length >= data.result.total || data.result.list.length < PAGE_SIZE) break;
    page++;
    await sleep(200);
  }

  // Filter to active markets and map to DiscoveredMarket
  const discovered: DiscoveredMarket[] = [];

  for (const m of allMarkets) {
    if (m.statusEnum !== "Activated") continue;
    if (!m.yesTokenId || !m.noTokenId) continue;

    let resolvesAt: string | undefined;
    if (m.cutoffAt) {
      try {
        const parsed = new Date(m.cutoffAt * 1000);
        if (!isNaN(parsed.getTime())) resolvesAt = parsed.toISOString();
      } catch { /* ignore */ }
    }

    discovered.push({
      platform: "Opinion",
      id: String(m.marketId),
      title: m.marketTitle,
      conditionId: m.conditionId || "", // always empty for Opinion
      yesTokenId: m.yesTokenId,
      noTokenId: m.noTokenId,
      category: m.labels?.[0],
      hasLiquidity: true,
      resolvesAt,
      topicId: String(m.marketId),
      opinionMarketType: m.marketType,
    });
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Match two lists of markets from different platforms.
 * Delegates to the matching engine, then wraps results as MarketMatch.
 */
function matchPlatformPair(
  listA: DiscoveredMarket[],
  listB: DiscoveredMarket[],
): MarketMatch[] {
  const aById = new Map(listA.map((m) => [m.id, m]));
  const bById = new Map(listB.map((m) => [m.id, m]));

  const raw = matchMarkets(listA, listB);
  const matches: MarketMatch[] = [];
  const matchedAIds = new Set<string>();
  const matchedBIds = new Set<string>();

  // Debug: match breakdown by type
  const byType = { conditionId: 0, templateMatch: 0, titleSimilarity: 0 };
  for (const r of raw) {
    byType[r.matchType]++;
    // Log non-conditionId matches for debugging false positives
    if (r.matchType !== "conditionId") {
      log.info("Match detail", {
        type: r.matchType,
        sim: r.similarity,
        a: r.marketA.title.slice(0, 70),
        b: r.marketB.title.slice(0, 70),
      });
    }
  }
  log.info("Match breakdown", byType);

  for (const r of raw) {
    const a = aById.get(r.marketA.id)!;
    const b = bById.get(r.marketB.id)!;
    matchedAIds.add(a.id);
    matchedBIds.add(b.id);
    matches.push(buildMatch(a, b, r.matchType, r.similarity));
  }

  // Near-miss logging: iterate unmatched pairs for diagnostics
  const unmatchedA = listA.filter((m) => !matchedAIds.has(m.id));
  const unmatchedB = listB.filter((m) => !matchedBIds.has(m.id));
  let nearMisses = 0;

  for (const a of unmatchedA) {
    let bestSim = 0;
    let bestB: DiscoveredMarket | null = null;
    for (const b of unmatchedB) {
      const sim = compositeSimilarity(a.title, b.title);
      if (sim > bestSim) {
        bestSim = sim;
        bestB = b;
      }
    }
    if (bestB && bestSim >= 0.50) {
      nearMisses++;
      log.info("Discovery near-miss", {
        similarity: Math.round(bestSim * 100) / 100,
        a: a.title.slice(0, 80),
        b: bestB.title.slice(0, 80),
      });
    }
  }

  if (nearMisses > 0) {
    log.info("Discovery: title near-misses (0.50-0.85)", { count: nearMisses });
  }

  return matches;
}

function buildMatch(
  a: DiscoveredMarket,
  b: DiscoveredMarket,
  matchType: "conditionId" | "templateMatch" | "titleSimilarity",
  similarity: number,
): MarketMatch {
  // Best-effort assignment of deprecated probable/predict fields.
  // For Predict-anchored matches these are accurate; for Opinion↔Probable
  // they point at whichever side is closest (Probable→probable, Opinion→predict).
  const predictSide = a.platform === "Predict" ? a : b.platform === "Predict" ? b : undefined;
  const probableSide = a.platform === "Probable" ? a : b.platform === "Probable" ? b : undefined;

  const match: MarketMatch = {
    platformA: a,
    platformB: b,
    probable: probableSide ?? a,
    predict: predictSide ?? b,
    matchType,
    similarity: Math.round(similarity * 10000) / 10000,
  };

  if (probableSide) {
    match.probableMapEntry = {
      probableMarketId: probableSide.id,
      conditionId: probableSide.conditionId,
      yesTokenId: probableSide.yesTokenId,
      noTokenId: probableSide.noTokenId,
    };
  }

  if (predictSide) {
    match.predictMapEntry = {
      predictMarketId: predictSide.id,
      yesTokenId: predictSide.yesTokenId,
      noTokenId: predictSide.noTokenId,
    };
  }

  return match;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateMatch(match: MarketMatch): boolean {
  // Both sides must have YES/NO tokens
  if (!match.platformA.yesTokenId || !match.platformA.noTokenId) return false;
  if (!match.platformB.yesTokenId || !match.platformB.noTokenId) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export async function runDiscovery(params: {
  probableEventsApiBase: string;
  predictApiBase: string;
  predictApiKey: string;
  opinionApiBase?: string;
  opinionApiKey?: string;
  disableProbable?: boolean;
}): Promise<DiscoveryResult> {
  const { probableEventsApiBase, predictApiBase, predictApiKey } = params;

  // Step 1: Fetch Probable markets (skip if disabled)
  let probableMarkets: DiscoveredMarket[] = [];
  if (!params.disableProbable) {
    log.info("Discovery: fetching Probable markets...");
    try {
      probableMarkets = await fetchProbableMarkets(probableEventsApiBase);
      log.info("Discovery: Probable markets fetched", { count: probableMarkets.length });
    } catch (err) {
      log.error("Discovery: Probable fetch failed, skipping", { error: String(err) });
    }
  }

  // Step 2: Fetch Predict markets (always)
  log.info("Discovery: fetching Predict markets...");
  let predictMarkets: DiscoveredMarket[] = [];
  try {
    predictMarkets = await fetchPredictMarkets(predictApiBase, predictApiKey);
    log.info("Discovery: Predict markets fetched", { count: predictMarkets.length });
  } catch (err) {
    log.error("Discovery: Predict fetch failed, skipping", { error: String(err) });
  }

  // Step 3: Fetch Opinion markets (when API key present)
  let opinionMarkets: DiscoveredMarket[] = [];
  if (params.opinionApiKey && params.opinionApiBase) {
    log.info("Discovery: fetching Opinion markets...");
    try {
      opinionMarkets = await fetchOpinionMarkets(params.opinionApiBase, params.opinionApiKey);
      log.info("Discovery: Opinion markets fetched", { count: opinionMarkets.length });
    } catch (err) {
      log.error("Discovery: Opinion fetch failed, skipping", { error: String(err) });
    }
  }

  // Step 4: Match platform pairs
  log.info("Discovery: matching markets...");
  const allMatches: MarketMatch[] = [];

  // Probable ↔ Predict
  if (probableMarkets.length > 0 && predictMarkets.length > 0) {
    const raw = matchPlatformPair(probableMarkets, predictMarkets);
    allMatches.push(...raw);
    log.info("Discovery: Probable↔Predict matches", { count: raw.length });
  }

  // Opinion ↔ Predict
  if (opinionMarkets.length > 0 && predictMarkets.length > 0) {
    const raw = matchPlatformPair(opinionMarkets, predictMarkets);
    allMatches.push(...raw);
    log.info("Discovery: Opinion↔Predict matches", { count: raw.length });
  }

  // Opinion ↔ Probable
  if (opinionMarkets.length > 0 && probableMarkets.length > 0) {
    const raw = matchPlatformPair(opinionMarkets, probableMarkets);
    allMatches.push(...raw);
    log.info("Discovery: Opinion↔Probable matches", { count: raw.length });
  }

  // Step 5: Validate
  const matches = allMatches.filter(validateMatch);
  log.info("Discovery: matching complete", {
    rawMatches: allMatches.length,
    validated: matches.length,
    droppedByValidation: allMatches.length - matches.length,
  });

  // Step 6: Build output maps (platform-agnostic shared key)
  const probableMarketMap: DiscoveryResult["probableMarketMap"] = {};
  const predictMarketMap: DiscoveryResult["predictMarketMap"] = {};
  const opinionMarketMap: DiscoveryResult["opinionMarketMap"] = {};
  const titleMap: DiscoveryResult["titleMap"] = {};
  const linkMap: DiscoveryResult["linkMap"] = {};

  // Derive a shared key for a matched pair.
  // Predict-anchored matches use Predict's conditionId (backward compat).
  // Otherwise prefer a shared or Probable conditionId, else a composite key.
  function getSharedKey(a: DiscoveredMarket, b: DiscoveredMarket): string | null {
    if (a.platform === "Predict" && a.conditionId) return a.conditionId;
    if (b.platform === "Predict" && b.conditionId) return b.conditionId;
    if (a.conditionId && a.conditionId === b.conditionId) return a.conditionId;
    if (a.platform === "Probable" && a.conditionId) return a.conditionId;
    if (b.platform === "Probable" && b.conditionId) return b.conditionId;
    // Composite fallback
    return `${a.platform}:${a.id}+${b.platform}:${b.id}`;
  }

  function populateMapEntry(market: DiscoveredMarket, key: string): void {
    if (market.platform === "Predict") {
      predictMarketMap[key] = {
        predictMarketId: market.id,
        yesTokenId: market.yesTokenId,
        noTokenId: market.noTokenId,
      };
    } else if (market.platform === "Probable") {
      probableMarketMap[key] = {
        probableMarketId: market.id,
        conditionId: market.conditionId,
        yesTokenId: market.yesTokenId,
        noTokenId: market.noTokenId,
      };
    } else if (market.platform === "Opinion") {
      opinionMarketMap[key] = {
        opinionMarketId: market.id,
        yesTokenId: market.yesTokenId,
        noTokenId: market.noTokenId,
        topicId: market.topicId || market.id,
      };
    }
  }

  // Track which platform-specific market IDs have been assigned a shared key.
  // Prevents duplicate quotes when a market appears in multiple pairs.
  const assignedMarketIds = new Map<string, string>(); // "platform:marketId" → sharedKey

  // Sort: Predict-anchored matches first (higher priority for dedup)
  const sorted = [...matches].sort((a, b) => {
    const aHasPredict = a.platformA.platform === "Predict" || a.platformB.platform === "Predict";
    const bHasPredict = b.platformA.platform === "Predict" || b.platformB.platform === "Predict";
    return aHasPredict === bHasPredict ? 0 : aHasPredict ? -1 : 1;
  });

  for (const m of sorted) {
    const aKey = `${m.platformA.platform}:${m.platformA.id}`;
    const bKey = `${m.platformB.platform}:${m.platformB.id}`;

    const aAssigned = assignedMarketIds.get(aKey);
    const bAssigned = assignedMarketIds.get(bKey);

    // Skip if both sides already mapped (fully covered by prior matches)
    if (aAssigned && bAssigned) continue;

    // Reuse existing key if one side is already assigned, else derive new key
    const sharedKey = aAssigned ?? bAssigned ?? getSharedKey(m.platformA, m.platformB);
    if (!sharedKey) continue;

    if (!aAssigned) {
      assignedMarketIds.set(aKey, sharedKey);
      populateMapEntry(m.platformA, sharedKey);
    }
    if (!bAssigned) {
      assignedMarketIds.set(bKey, sharedKey);
      populateMapEntry(m.platformB, sharedKey);
    }
    // Prefer Predict title as canonical; fall back to the other platform's title
    if (!titleMap[sharedKey]) {
      const predictSide = m.platformA.platform === "Predict" ? m.platformA : m.platformB.platform === "Predict" ? m.platformB : null;
      titleMap[sharedKey] = predictSide?.title || m.platformA.title || m.platformB.title;
    }

    // Build platform links using slug (shared between Probable/Predict) and topicId (Opinion)
    if (!linkMap[sharedKey]) linkMap[sharedKey] = {};
    const sides = [m.platformA, m.platformB];
    const matchHasPredict = m.platformA.platform === "Predict" || m.platformB.platform === "Predict";
    for (const side of sides) {
      if (side.platform === "Probable" && side.slug && !linkMap[sharedKey].probable) {
        linkMap[sharedKey].probable = `https://probable.markets/event/${side.slug}`;
        // Only generate Predict link from Probable slug if this match involves Predict
        // (both sourced from Polymarket, so slugs match)
        if (matchHasPredict && !linkMap[sharedKey].predict) {
          linkMap[sharedKey].predict = `https://predict.fun/market/${side.slug}`;
        }
      } else if (side.platform === "Opinion" && side.topicId && !linkMap[sharedKey].opinion) {
        const isMulti = side.opinionMarketType && side.opinionMarketType !== 0;
        linkMap[sharedKey].opinion = `https://app.opinion.trade/detail?topicId=${side.topicId}${isMulti ? "&type=multi" : ""}`;
      }
    }
  }

  return {
    discoveredAt: new Date().toISOString(),
    probableMarkets: probableMarkets.length,
    predictMarkets: predictMarkets.length,
    probableMarketsList: probableMarkets,
    predictMarketsList: predictMarkets,
    opinionMarketsList: opinionMarkets,
    matches,
    probableMarketMap,
    predictMarketMap,
    opinionMarketMap,
    titleMap,
    linkMap,
  };
}
