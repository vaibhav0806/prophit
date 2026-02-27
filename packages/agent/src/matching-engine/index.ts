import {
  normalizeTitle,
  normalizeEntity,
  normalizeParams,
} from "./normalizer.js";
import { detectPolarity } from "./polarity.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchType = "conditionId" | "templateMatch" | "titleSimilarity";

export interface MatchResult {
  marketA: { id: string; title: string; conditionId: string };
  marketB: { id: string; title: string; conditionId: string };
  matchType: MatchType;
  similarity: number;
  polarityFlip: boolean; // YES on A = NO on B
}

interface TemplateResult {
  template: string;
  entity: string;
  params: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SIMILARITY_THRESHOLD = 0.85;
/** Threshold for cross-category sweep (Pass 3b) — bypasses category/temporal filters */
export const HIGH_CONFIDENCE_THRESHOLD = 0.98;

export const STOP_WORDS = new Set([
  "will", "the", "a", "an", "by", "be", "of", "in", "to",
  "and", "or", "is", "it", "at", "on", "for", "has", "have",
  // Prediction-market-specific stop words that dilute similarity
  "market", "price", "token", "before", "after", "reach", "above", "below",
]);

export const TEMPLATE_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "fdv-above",    regex: /(?:will )?(.+?) (?:fdv|market cap(?: \(fdv\))?) (?:be )?(?:above|>)\s*\$?([\d.,]+[bmk]?)/i },
  { name: "token-launch", regex: /(?:will )?(.+?) launch a token by (.+)/i },
  { name: "price-target", regex: /(?:will )?(.+?) (?:hit|reach|break|dip to) ((?:\((?:low|high)\) )?\$?[\d.,]+[bmk]?)/i },
  // Up/Down directional markets — must be before win-comp to avoid "Up or Down" matching "win"
  { name: "up-or-down",  regex: /(\w+)(?:\/\w+)?\s+up or down[\s\-]*(?:on\s+|hourly\s+)?(?:\(?)?(.+)/i },
  // Sports matchup — must be before win-comp so "Who will win: X vs Y" is parsed as matchup, not win-comp
  { name: "matchup",     regex: /(?:who will win[:\s]+|(?:nba|nfl|mlb|nhl|lpl|lck|lec|lcs|lcp|cblol|kpl|lol|dota\s*2?(?:\s*-\s*\w+)?|valorant(?:\s*-\s*\w+(?:\s+\w+)*)?):\s+)(.+?)\s+vs\.?\s+(.+?)(?:\s*\(.*)?$/i },
  { name: "win-comp",     regex: /(?:will )?(.+?) win (.+)/i },
  { name: "out-as",       regex: /(?:will )?(.+?) (?:come )?out as (.+)/i },
  { name: "ipo-by",       regex: /(?:will )?(.+?) ipo by (.+)/i },
  // Phase 2 additions
  { name: "happen-by",    regex: /(?:will )?(.+?) (?:happen|occur) by (.+)/i },
  { name: "mcap-above",   regex: /(?:will )?(.+?) market cap (?:be )?(?:above|>)\s*\$?([\d.,]+[bmk]?)/i },
  { name: "tvl-above",    regex: /(?:will )?(.+?) tvl (?:be )?above \$?([\d.,]+[bmk]?)/i },
  { name: "list-on",      regex: /(?:will )?(.+?) (?:be )?list(?:ed)? on (.+)/i },
  { name: "approved-by",  regex: /(?:will )?(.+?) (?:be )?approved by (.+)/i },
  { name: "partner-with", regex: /(?:will )?(.+?) (?:partner|integrate) with (.+)/i },
  { name: "elected-to",   regex: /(?:will )?(.+?) (?:be )?elected (?:as |to )?(.+)/i },
  { name: "rate-above",   regex: /(?:will )?(.+?) (?:rate|apr|apy) (?:be )?(?:above|over) ([\d.,]+%?)/i },
  { name: "close-above", regex: /(?:will )?(.+?) close (?:above|below) \$?([\d.,]+[bmk]?)/i },
  { name: "depeg-by",    regex: /(?:will )?(.+?) depeg (?:by|before) (.+)/i },
  { name: "acquire-by",  regex: /(?:will )?(.+?) acquire (.+)/i },
  { name: "return-by",   regex: /(?:will )?(.+?) return (?:by |before )(.+)/i },
  { name: "strikes-by",  regex: /(.+?) strikes? (.+)/i },
];

// ---------------------------------------------------------------------------
// Similarity functions
// ---------------------------------------------------------------------------

/**
 * Jaccard similarity over word sets (stop words filtered).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    normalizeTitle(a).split(" ").filter((w) => w && !STOP_WORDS.has(w)),
  );
  const wordsB = new Set(
    normalizeTitle(b).split(" ").filter((w) => w && !STOP_WORDS.has(w)),
  );

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Dice coefficient over character bigrams (multiset — counts, not just presence).
 * Catches cases where Jaccard fails due to word boundary differences.
 */
export function diceSimilarity(a: string, b: string): number {
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);

  if (normA.length < 2 || normB.length < 2) return 0;
  if (normA === normB) return 1;

  const bigramsA = getBigramCounts(normA);
  const bigramsB = getBigramCounts(normB);

  let intersection = 0;
  for (const [bigram, countA] of bigramsA) {
    const countB = bigramsB.get(bigram) ?? 0;
    intersection += Math.min(countA, countB);
  }

  const totalA = sumValues(bigramsA);
  const totalB = sumValues(bigramsB);

  return totalA + totalB === 0 ? 0 : (2 * intersection) / (totalA + totalB);
}

function getBigramCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bigram = s.slice(i, i + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}

function sumValues(map: Map<string, number>): number {
  let sum = 0;
  for (const v of map.values()) sum += v;
  return sum;
}

/**
 * Composite similarity: max(jaccard, dice).
 * Used for Pass 3 threshold check.
 */
export function compositeSimilarity(a: string, b: string): number {
  return Math.max(jaccardSimilarity(a, b), diceSimilarity(a, b));
}

// ---------------------------------------------------------------------------
// Template extraction
// ---------------------------------------------------------------------------

export function extractTemplate(title: string): TemplateResult | null {
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
// Category & temporal pre-filtering helpers
// ---------------------------------------------------------------------------

/** Default temporal window: 30 days in milliseconds */
export const TEMPORAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const CATEGORY_SYNONYMS: Record<string, string> = {
  // Crypto variants (Predict slugs, Probable tags, Opinion labels)
  cryptocurrency: "crypto",
  cryptocurrencies: "crypto",
  defi: "crypto",
  blockchain: "crypto",
  tokens: "crypto",
  "token launches": "crypto",
  "crypto prices": "crypto",
  "fdv predictions": "crypto",
  web3: "crypto",
  "pre tge": "crypto",
  fdv: "crypto",
  // Politics
  political: "politics",
  election: "politics",
  elections: "politics",
  geopolitics: "politics",
  government: "politics",
  "us politics": "politics",
  "world politics": "politics",
  // Sports (Predict uses "sports-and-esports", Probable uses "Sports", Opinion may use "Esports")
  sporting: "sports",
  sport: "sports",
  "sports and esports": "sports",
  esports: "sports",
  nba: "sports",
  nfl: "sports",
  soccer: "sports",
  football: "sports",
  "world cup": "sports",
  dota: "sports",
  "dota 2": "sports",
  basketball: "sports",
  hockey: "sports",
  baseball: "sports",
  cricket: "sports",
  golf: "sports",
  tennis: "sports",
  "formula 1": "sports",
  f1: "sports",
  lol: "sports",
  "league of legends": "sports",
  valorant: "sports",
  cs2: "sports",
  "counter strike": "sports",
  mlb: "sports",
  mls: "sports",
  nhl: "sports",
  "la liga": "sports",
  "serie a": "sports",
  bundesliga: "sports",
  ligue1: "sports",
  // Culture / Entertainment
  entertainment: "culture",
  pop_culture: "culture",
  "pop culture": "culture",
  celebrity: "culture",
  music: "culture",
  movies: "culture",
  oscars: "culture",
  // Science / Tech
  science: "tech",
  technology: "tech",
  ai: "tech",
  // Finance / Economy
  finance: "finance",
  stocks: "finance",
  "stock market": "finance",
  commodities: "finance",
  "fed rates": "finance",
  economy: "finance",
  macro: "finance",
  business: "finance",
  marco: "finance",
  // Topic-specific categories → broader bucket
  greenland: "politics",
  geopolitics: "politics",
  iran: "politics",
  // Novelty / Meme (these vary wildly across platforms — unify)
  novelty: "other",
  meme: "other",
  viral: "other",
  misc: "other",
  other: "other",
  general: "other",
  more: "other",
};

/**
 * Keywords in Predict category slugs that map to canonical categories.
 * Predict slugs look like "btc-usd-up-down-2026-02-27-00-00-15-minutes"
 * or "2026-nba-champion". We scan for keywords to infer category.
 */
const SLUG_KEYWORD_MAP: [RegExp, string][] = [
  [/\b(btc|eth|bnb|crypto|token|fdv|defi|binance|solana|bitcoin|ethereum|airdrop|safu|tge)\b/, "crypto"],
  [/\b(nba|nfl|mlb|mls|ncaa|premier league|champions league|la liga|serie a|bundesliga|f1|nhl|fifa|world cup|stanley cup|soccer|football|ski|halfpipe|cricket|icc|golf|masters|lol|lck|lpl|lec|lcs|cblol|valorant|vct|cs2|dota|dreamleague|kpl)\b/, "sports"],
  [/\b(trump|election|president|congress|senate|political|vote|governor|vance|rubio|shapiro|desantis|newsom|ossoff)\b/, "politics"],
  [/\b(gold|silver|oil|spx|s&p|nasdaq|stock|temperature|weather)\b/, "finance"],
  [/\b(oscars|grammy|emmy|movies|music)\b/, "culture"],
];

export function normalizeCategory(cat?: string): string {
  if (!cat) return "";
  const normalized = cat.toLowerCase().trim().replace(/[\s_-]+/g, " ");

  // Direct synonym lookup
  const direct = CATEGORY_SYNONYMS[normalized];
  if (direct) return direct;

  // For long slug-style categories (Predict), scan for keywords
  if (normalized.length > 20) {
    for (const [re, canonical] of SLUG_KEYWORD_MAP) {
      if (re.test(normalized)) return canonical;
    }
  }

  return normalized;
}

function bucketByCategory(markets: MarketInput[]): Map<string, MarketInput[]> {
  const buckets = new Map<string, MarketInput[]>();
  for (const m of markets) {
    const cat = normalizeCategory(m.category);
    const key = cat || "__uncategorized__";
    const arr = buckets.get(key) ?? [];
    arr.push(m);
    buckets.set(key, arr);
  }
  return buckets;
}

function getCategoryCandidates(
  category: string,
  buckets: Map<string, MarketInput[]>,
): MarketInput[] {
  const uncategorized = buckets.get("__uncategorized__") ?? [];

  if (!category) {
    // Uncategorized market: compare against all buckets
    const all: MarketInput[] = [];
    for (const items of buckets.values()) {
      all.push(...items);
    }
    return all;
  }

  const sameCat = buckets.get(category) ?? [];
  return [...sameCat, ...uncategorized];
}

function withinTemporalWindow(
  aResolves?: number,
  bResolves?: number,
): boolean {
  // Conservative: if either is missing, don't reject
  if (aResolves == null || bResolves == null) return true;
  return Math.abs(aResolves - bResolves) <= TEMPORAL_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Market matching — pure function (no logging, no side effects)
// ---------------------------------------------------------------------------

export interface MarketInput {
  id: string;
  title: string;
  conditionId: string;
  category?: string;     // for category bucketing in Pass 3
  resolvesAt?: number;   // unix timestamp for temporal window filter
}

/**
 * Match two lists of markets from different platforms.
 *
 * 3-pass algorithm:
 *  1. conditionId exact match (skipped if either list lacks them)
 *  2. Template extraction + entity/params match (with confusable + year normalization)
 *  3. Composite similarity (Jaccard + Dice) above threshold, with template guard
 */
export function matchMarkets(
  listA: MarketInput[],
  listB: MarketInput[],
): MatchResult[] {
  const results: MatchResult[] = [];
  const matchedAIds = new Set<string>();
  const matchedBIds = new Set<string>();

  // Pre-compute template extractions for all markets (used in Pass 2 and Pass 3 guard).
  // IMPORTANT: prefix keys with "a:" / "b:" to avoid ID collisions between lists
  // (both Probable and Predict use numeric IDs that overlap).
  const templateCache = new Map<string, TemplateResult | null>();
  for (const m of listA) {
    templateCache.set(`a:${m.id}`, extractTemplate(m.title));
  }
  for (const m of listB) {
    templateCache.set(`b:${m.id}`, extractTemplate(m.title));
  }

  // Check if conditionId matching is viable
  const aHasConditionIds = listA.some((m) => !!m.conditionId);
  const bHasConditionIds = listB.some((m) => !!m.conditionId);

  // --- Pass 1: exact conditionId match ---
  if (aHasConditionIds && bHasConditionIds) {
    const bByCondition = new Map<string, MarketInput>();
    for (const b of listB) {
      if (b.conditionId) bByCondition.set(b.conditionId, b);
    }

    for (const a of listA) {
      if (!a.conditionId) continue;
      const b = bByCondition.get(a.conditionId);
      if (!b) continue;

      matchedAIds.add(a.id);
      matchedBIds.add(b.id);
      // Same conditionId implies same polarity
      results.push({ marketA: a, marketB: b, matchType: "conditionId", similarity: 1.0, polarityFlip: false });
    }
  }

  // --- Pass 2: template extraction + entity/params match ---
  const templateKeyToB = new Map<string, MarketInput>();
  for (const b of listB) {
    if (matchedBIds.has(b.id)) continue;
    const tpl = templateCache.get(`b:${b.id}`);
    if (!tpl) continue;
    const key = `${tpl.template}:${tpl.entity}:${tpl.params}`;
    templateKeyToB.set(key, b);
  }

  for (const a of listA) {
    if (matchedAIds.has(a.id)) continue;
    const tpl = templateCache.get(`a:${a.id}`);
    if (!tpl) continue;
    const key = `${tpl.template}:${tpl.entity}:${tpl.params}`;
    const b = templateKeyToB.get(key);
    if (!b) continue;

    matchedAIds.add(a.id);
    matchedBIds.add(b.id);
    const { polarityFlip } = detectPolarity(a.title, b.title);
    results.push({ marketA: a, marketB: b, matchType: "templateMatch", similarity: 1.0, polarityFlip });
  }

  // --- Pass 3: composite similarity with template guard + category/temporal pre-filter ---
  const unmatchedA = listA.filter((a) => !matchedAIds.has(a.id));
  const unmatchedB = listB.filter((b) => !matchedBIds.has(b.id));

  // Category bucketing: group unmatched markets by normalized category
  const bucketedB = bucketByCategory(unmatchedB);

  for (const a of unmatchedA) {
    if (matchedAIds.has(a.id)) continue;

    // Get candidate B markets from same category bucket + uncategorized
    const aCat = normalizeCategory(a.category);
    const candidates = getCategoryCandidates(aCat, bucketedB);

    let bestMatch: MarketInput | null = null;
    let bestSimilarity = 0;

    for (const b of candidates) {
      if (matchedBIds.has(b.id)) continue;

      // Temporal window filter: skip if resolution dates are too far apart
      if (!withinTemporalWindow(a.resolvesAt, b.resolvesAt)) continue;

      // Template guard: if both titles match the same template name but
      // were rejected in Pass 2 (different entity/params), skip the pair.
      const tplA = templateCache.get(`a:${a.id}`);
      const tplB = templateCache.get(`b:${b.id}`);
      if (tplA && tplB && tplA.template === tplB.template) continue;

      const sim = compositeSimilarity(a.title, b.title);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = b;
      }
    }

    if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
      matchedAIds.add(a.id);
      matchedBIds.add(bestMatch.id);
      const { polarityFlip } = detectPolarity(a.title, bestMatch.title);
      results.push({
        marketA: a,
        marketB: bestMatch,
        matchType: "titleSimilarity",
        similarity: Math.round(bestSimilarity * 10000) / 10000,
        polarityFlip,
      });
    }
  }

  // --- Pass 3b: high-confidence cross-category sweep ---
  // Identical or near-identical titles across different category buckets were
  // missed by the category pre-filter (platforms use different taxonomies).
  // Do a targeted sweep of remaining unmatched pairs, bypassing category/temporal
  // filters, but only accepting very high similarity (>= 0.98).
  const stillUnmatchedA = unmatchedA.filter((a) => !matchedAIds.has(a.id));
  const stillUnmatchedB = unmatchedB.filter((b) => !matchedBIds.has(b.id));

  for (const a of stillUnmatchedA) {
    if (matchedAIds.has(a.id)) continue;

    let bestMatch: MarketInput | null = null;
    let bestSimilarity = 0;

    for (const b of stillUnmatchedB) {
      if (matchedBIds.has(b.id)) continue;

      // Template guard still applies
      const tplA = templateCache.get(`a:${a.id}`);
      const tplB = templateCache.get(`b:${b.id}`);
      if (tplA && tplB && tplA.template === tplB.template) continue;

      const sim = compositeSimilarity(a.title, b.title);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = b;
      }
    }

    if (bestMatch && bestSimilarity >= HIGH_CONFIDENCE_THRESHOLD) {
      matchedAIds.add(a.id);
      matchedBIds.add(bestMatch.id);
      const { polarityFlip } = detectPolarity(a.title, bestMatch.title);
      results.push({
        marketA: a,
        marketB: bestMatch,
        matchType: "titleSimilarity",
        similarity: Math.round(bestSimilarity * 10000) / 10000,
        polarityFlip,
      });
    }
  }

  return results;
}

// Re-export normalizer functions for external use
export { normalizeTitle, normalizeEntity, normalizeParams, replaceConfusables } from "./normalizer.js";
