import { log } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredMarket {
  platform: "Probable" | "Predict";
  id: string;
  title: string;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  category?: string;
  hasLiquidity: boolean;
}

export interface MarketMatch {
  probable: DiscoveredMarket;
  predict: DiscoveredMarket;
  matchType: "conditionId" | "templateMatch" | "titleSimilarity";
  similarity: number;
  probableMapEntry: { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string };
  predictMapEntry: { predictMarketId: string; yesTokenId: string; noTokenId: string };
}

export interface DiscoveryResult {
  discoveredAt: string;
  probableMarkets: number;
  predictMarkets: number;
  probableMarketsList: DiscoveredMarket[];
  predictMarketsList: DiscoveredMarket[];
  matches: MarketMatch[];
  probableMarketMap: Record<string, { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string }>;
  predictMarketMap: Record<string, { predictMarketId: string; yesTokenId: string; noTokenId: string }>;
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
  conditionId?: string;
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

/**
 * Normalize a title for comparison: lowercase, strip punctuation, collapse
 * whitespace, trim.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "will", "the", "a", "an", "by", "be", "of", "in", "to",
  "and", "or", "is", "it", "at", "on", "for", "has", "have",
]);

/**
 * Jaccard similarity over word sets.  intersection / union of unique words.
 * Stop words are filtered out so template-heavy titles don't inflate scores.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(" ").filter((w) => w && !STOP_WORDS.has(w)));
  const wordsB = new Set(normalizeTitle(b).split(" ").filter((w) => w && !STOP_WORDS.has(w)));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Template extraction — identifies structured market titles and extracts the
// distinguishing entity/params so template-heavy titles don't false-positive
// on Jaccard similarity.
// ---------------------------------------------------------------------------

interface TemplateResult {
  template: string;
  entity: string;
  params: string;
}

const TEMPLATE_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "fdv-above",    regex: /will (.+?) fdv be above \$?([\d.]+[bmk]?)/i },
  { name: "token-launch", regex: /will (.+?) launch a token by (.+)/i },
  { name: "price-target", regex: /will (.+?) (?:hit|reach|break) \$?([\d,.]+)/i },
  { name: "win-comp",     regex: /will (.+?) win (.+)/i },
  { name: "out-as",       regex: /will (.+?) come out as (.+)/i },
  { name: "ipo-by",       regex: /will (.+?) ipo by (.+)/i },
];

function normalizeEntity(s: string): string {
  return s.toLowerCase().trim().replace(/[?.,!]+$/, "");
}

function normalizeParams(s: string): string {
  return s.toLowerCase().replace(/[$?]/g, "").replace(/\s+/g, " ").trim();
}

function extractTemplate(title: string): TemplateResult | null {
  for (const { name, regex } of TEMPLATE_PATTERNS) {
    const m = title.match(regex);
    if (m) {
      return {
        template: name,
        entity: normalizeEntity(m[1]),
        params: normalizeParams(m[2]),
      };
    }
  }
  return null;
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

      // Parse clobTokenIds for YES/NO token IDs
      let tokenIds: string[];
      try {
        tokenIds = JSON.parse(market.clobTokenIds);
      } catch {
        continue;
      }
      if (tokenIds.length !== 2) continue;

      // token_id order matches outcomes order; find YES and NO
      const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
      const noIdx = outcomes.findIndex((o) => o.toLowerCase() === "no");
      if (yesIdx === -1 || noIdx === -1) continue;

      const yesTokenId = tokenIds[yesIdx];
      const noTokenId = tokenIds[noIdx];

      // conditionId: prefer explicit field, fall back to market id
      const conditionId = market.conditionId || market.id;

      discovered.push({
        platform: "Probable",
        id: market.id,
        title: market.question || event.title,
        conditionId,
        yesTokenId,
        noTokenId,
        category: event.tags?.[0]?.label,
        hasLiquidity: true, // Will be refined below if we add orderbook checks
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

    discovered.push({
      platform: "Predict",
      id: String(m.id),
      title: m.question || m.title, // prefer full question over short option name
      conditionId: m.conditionId,
      yesTokenId: yes.onChainId,
      noTokenId: no.onChainId,
      category: m.categorySlug,
      hasLiquidity: true, // checked at scan time, not discovery time
    });
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchMarkets(
  probable: DiscoveredMarket[],
  predict: DiscoveredMarket[],
): MarketMatch[] {
  const matches: MarketMatch[] = [];
  const matchedProbableIds = new Set<string>();
  const matchedPredictIds = new Set<string>();

  // Pass 1: exact conditionId match
  const predictByCondition = new Map<string, DiscoveredMarket>();
  for (const p of predict) {
    if (p.conditionId) predictByCondition.set(p.conditionId, p);
  }

  for (const prob of probable) {
    if (!prob.conditionId) continue;
    const pred = predictByCondition.get(prob.conditionId);
    if (!pred) continue;

    matchedProbableIds.add(prob.id);
    matchedPredictIds.add(pred.id);
    matches.push(buildMatch(prob, pred, "conditionId", 1.0));
  }

  // Pass 2: template extraction + entity match
  const templateKeyToPredict = new Map<string, DiscoveredMarket>();
  for (const pred of predict) {
    if (matchedPredictIds.has(pred.id)) continue;
    const tpl = extractTemplate(pred.title);
    if (!tpl) continue;
    const key = `${tpl.template}:${tpl.entity}:${tpl.params}`;
    templateKeyToPredict.set(key, pred);
  }

  for (const prob of probable) {
    if (matchedProbableIds.has(prob.id)) continue;
    const tpl = extractTemplate(prob.title);
    if (!tpl) continue;
    const key = `${tpl.template}:${tpl.entity}:${tpl.params}`;
    const pred = templateKeyToPredict.get(key);
    if (!pred) continue;

    matchedProbableIds.add(prob.id);
    matchedPredictIds.add(pred.id);
    matches.push(buildMatch(prob, pred, "templateMatch", 1.0));
    log.info("Discovery: template match", { template: tpl.template, entity: tpl.entity });
  }

  // Pass 3: Jaccard title similarity fallback for remaining unmatched markets
  const unmatchedPredict = predict.filter((p) => !matchedPredictIds.has(p.id));
  let nearMisses = 0;

  for (const prob of probable) {
    if (matchedProbableIds.has(prob.id)) continue;

    let bestMatch: DiscoveredMarket | null = null;
    let bestSimilarity = 0;

    for (const pred of unmatchedPredict) {
      if (matchedPredictIds.has(pred.id)) continue;

      const sim = jaccardSimilarity(prob.title, pred.title);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = pred;
      }
    }

    if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
      matchedProbableIds.add(prob.id);
      matchedPredictIds.add(bestMatch.id);
      matches.push(buildMatch(prob, bestMatch, "titleSimilarity", bestSimilarity));
    } else if (bestMatch && bestSimilarity >= 0.50) {
      nearMisses++;
      log.info("Discovery near-miss", {
        similarity: Math.round(bestSimilarity * 100) / 100,
        probable: prob.title.slice(0, 80),
        predict: bestMatch.title.slice(0, 80),
      });
    }
  }

  if (nearMisses > 0) {
    log.info("Discovery: title near-misses (0.50-0.85)", { count: nearMisses });
  }

  return matches;
}

function buildMatch(
  probable: DiscoveredMarket,
  predict: DiscoveredMarket,
  matchType: "conditionId" | "templateMatch" | "titleSimilarity",
  similarity: number,
): MarketMatch {
  return {
    probable,
    predict,
    matchType,
    similarity: Math.round(similarity * 10000) / 10000,
    probableMapEntry: {
      probableMarketId: probable.id,
      conditionId: probable.conditionId,
      yesTokenId: probable.yesTokenId,
      noTokenId: probable.noTokenId,
    },
    predictMapEntry: {
      predictMarketId: predict.id,
      yesTokenId: predict.yesTokenId,
      noTokenId: predict.noTokenId,
    },
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateMatch(match: MarketMatch): boolean {
  // Both must have YES/NO tokens
  if (!match.probable.yesTokenId || !match.probable.noTokenId) return false;
  if (!match.predict.yesTokenId || !match.predict.noTokenId) return false;

  // Liquidity is checked at scan time, not discovery time — the scan loop
  // gracefully handles empty orderbooks by skipping zero-price quotes.

  return true;
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export async function runDiscovery(params: {
  probableEventsApiBase: string;
  predictApiBase: string;
  predictApiKey: string;
}): Promise<DiscoveryResult> {
  const { probableEventsApiBase, predictApiBase, predictApiKey } = params;

  // Step 1: Fetch Probable markets
  log.info("Discovery: fetching Probable markets...");
  let probableMarkets: DiscoveredMarket[] = [];
  try {
    probableMarkets = await fetchProbableMarkets(probableEventsApiBase);
    log.info("Discovery: Probable markets fetched", { count: probableMarkets.length });
  } catch (err) {
    log.error("Discovery: Probable fetch failed, skipping", { error: String(err) });
  }

  // Step 2: Fetch Predict markets
  log.info("Discovery: fetching Predict markets...");
  let predictMarkets: DiscoveredMarket[] = [];
  try {
    predictMarkets = await fetchPredictMarkets(predictApiBase, predictApiKey);
    log.info("Discovery: Predict markets fetched", { count: predictMarkets.length });
  } catch (err) {
    log.error("Discovery: Predict fetch failed, skipping", { error: String(err) });
  }

  // Step 3: Match
  log.info("Discovery: matching markets...");
  const rawMatches = matchMarkets(probableMarkets, predictMarkets);

  // Step 4: Validate
  const matches = rawMatches.filter(validateMatch);
  log.info("Discovery: matching complete", {
    rawMatches: rawMatches.length,
    validated: matches.length,
    droppedByValidation: rawMatches.length - matches.length,
  });

  // Step 5: Build output maps
  const probableMarketMap: DiscoveryResult["probableMarketMap"] = {};
  const predictMarketMap: DiscoveryResult["predictMarketMap"] = {};

  for (const m of matches) {
    // Key by conditionId (shared identifier)
    const key = m.probable.conditionId;
    probableMarketMap[key] = m.probableMapEntry;
    predictMarketMap[key] = m.predictMapEntry;
  }

  return {
    discoveredAt: new Date().toISOString(),
    probableMarkets: probableMarkets.length,
    predictMarkets: predictMarkets.length,
    probableMarketsList: probableMarkets,
    predictMarketsList: predictMarkets,
    matches,
    probableMarketMap,
    predictMarketMap,
  };
}
