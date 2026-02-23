import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config & CLI args
// ---------------------------------------------------------------------------

const API_BASE = "https://api.predict.fun";
const API_KEY = process.env.PREDICT_API_KEY || "";

function parseFlag(name: string, fallback: number): number {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return Number(process.argv[idx + 1]);
}

const hasFlag = (name: string) => process.argv.includes(name);

// The API returns one row per outcome (~10 outcomes per market), so 20 pages
// of 50 rows yields ~100 unique markets. Use --pages to adjust.
const MAX_PAGES = hasFlag("--all") ? Infinity : parseFlag("--pages", 20);
const MAX_ORDERBOOKS = hasFlag("--all") ? Infinity : parseFlag("--orderbooks", 50);

if (!API_KEY) {
  console.error(
    "PREDICT_API_KEY env var required.\n" +
      "Usage: npx tsx src/scripts/discover-markets.ts [--pages N] [--orderbooks N] [--all]",
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const OUT_PATH = join(DATA_DIR, "predict-markets.json");

const RATE_LIMIT_DELAY_MS = 150;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PredictOutcome {
  name: string;
  indexSet: number;
  onChainId: string;
}

interface PredictMarketRaw {
  id: number;
  title: string;
  question: string;
  description: string;
  conditionId: string;
  outcomes: PredictOutcome[];
  tradingStatus: string;
  status: string;
  categorySlug: string;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
}

interface OrderbookSummary {
  bestAsk: number | null;
  bestBid: number | null;
  spread: number | null;
  askDepth: number;
  bidDepth: number;
}

interface MarketEntry extends PredictMarketRaw {
  orderbook: OrderbookSummary;
}

interface OutputFile {
  fetchedAt: string;
  marketsTotal: number;
  marketsFetched: number;
  orderbooksFetched: number;
  markets: MarketEntry[];
  summary: {
    total: number;
    byCategory: Record<string, number>;
    byTradingStatus: Record<string, number>;
    topByLiquidity: Array<{
      id: number;
      title: string;
      bestAsk: number | null;
      bestBid: number | null;
      totalDepth: number;
    }>;
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-api-key": API_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Predict API ${res.status}: ${url}`);
  }
  return res.json() as Promise<T>;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Fetch open markets with pagination
// ---------------------------------------------------------------------------

interface MarketsListResponse {
  success: boolean;
  data: PredictMarketRaw[];
  cursor?: string;
}

async function fetchMarkets(): Promise<PredictMarketRaw[]> {
  // The API returns one row per outcome, so we deduplicate by market ID.
  const seen = new Map<number, PredictMarketRaw>();
  let cursor: string | undefined;
  let page = 0;

  while (page < MAX_PAGES) {
    page++;
    let path = `/v1/markets?status=OPEN&first=50`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;

    process.stdout.write(`  Page ${page}/${MAX_PAGES === Infinity ? "?" : MAX_PAGES} (${seen.size} unique)...\r`);
    const resp = await apiFetch<MarketsListResponse>(path);

    if (!resp.success || !Array.isArray(resp.data)) {
      throw new Error("Unexpected markets list response");
    }

    for (const m of resp.data) {
      if (!seen.has(m.id)) seen.set(m.id, m);
    }

    if (!resp.cursor || resp.data.length < 50) {
      console.log(`  Fetched ${page} pages — ${seen.size} unique markets (end of results)`);
      break;
    }

    if (page >= MAX_PAGES) {
      console.log(`  Fetched ${page} pages — ${seen.size} unique markets (hit --pages limit)`);
      break;
    }

    cursor = resp.cursor;
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Fetch orderbook for a single market
// ---------------------------------------------------------------------------

interface OrderbookResponse {
  success: boolean;
  data: {
    asks: Array<[number, number]>;
    bids: Array<[number, number]>;
  };
}

const EMPTY_BOOK: OrderbookSummary = {
  bestAsk: null,
  bestBid: null,
  spread: null,
  askDepth: 0,
  bidDepth: 0,
};

async function fetchOrderbook(marketId: number): Promise<OrderbookSummary> {
  try {
    const resp = await apiFetch<OrderbookResponse>(
      `/v1/markets/${marketId}/orderbook`,
    );
    if (!resp.success || !resp.data) return EMPTY_BOOK;

    const { asks, bids } = resp.data;
    const bestAsk = asks.length > 0 ? asks[0][0] : null;
    const bestBid = bids.length > 0 ? bids[0][0] : null;
    const spread =
      bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
    const askDepth = asks.reduce((sum, [, qty]) => sum + qty, 0);
    const bidDepth = bids.reduce((sum, [, qty]) => sum + qty, 0);

    return {
      bestAsk: bestAsk !== null ? Math.round(bestAsk * 10000) / 10000 : null,
      bestBid: bestBid !== null ? Math.round(bestBid * 10000) / 10000 : null,
      spread: spread !== null ? Math.round(spread * 10000) / 10000 : null,
      askDepth: Math.round(askDepth * 100) / 100,
      bidDepth: Math.round(bidDepth * 100) / 100,
    };
  } catch (err) {
    console.warn(`  Warning: orderbook failed for ${marketId}: ${err}`);
    return EMPTY_BOOK;
  }
}

// ---------------------------------------------------------------------------
// Build summary
// ---------------------------------------------------------------------------

function buildSummary(markets: MarketEntry[]): OutputFile["summary"] {
  const byCategory: Record<string, number> = {};
  const byTradingStatus: Record<string, number> = {};

  for (const m of markets) {
    byCategory[m.categorySlug] = (byCategory[m.categorySlug] || 0) + 1;
    byTradingStatus[m.tradingStatus] = (byTradingStatus[m.tradingStatus] || 0) + 1;
  }

  const sorted = [...markets].sort(
    (a, b) =>
      b.orderbook.askDepth + b.orderbook.bidDepth -
      (a.orderbook.askDepth + a.orderbook.bidDepth),
  );

  const topByLiquidity = sorted.slice(0, 10).map((m) => ({
    id: m.id,
    title: m.title,
    bestAsk: m.orderbook.bestAsk,
    bestBid: m.orderbook.bestBid,
    totalDepth: Math.round((m.orderbook.askDepth + m.orderbook.bidDepth) * 100) / 100,
  }));

  return { total: markets.length, byCategory, byTradingStatus, topByLiquidity };
}

// ---------------------------------------------------------------------------
// Print formatted summary
// ---------------------------------------------------------------------------

const OVERLAP_SLUGS = [
  "btc", "eth", "bnb", "crypto",
  "politic", "trump", "biden", "election",
  "nfl", "nba", "ncaa", "sport", "soccer", "football",
];

function printSummary(output: OutputFile): void {
  const { summary } = output;

  console.log("\n========================================");
  console.log(" Predict.fun Market Discovery Results");
  console.log("========================================\n");
  console.log(`Total markets fetched: ${output.marketsFetched}`);
  console.log(`Orderbooks fetched:    ${output.orderbooksFetched}`);
  console.log(`Fetched at:            ${output.fetchedAt}\n`);

  // Category breakdown
  console.log("--- Categories ---");
  const catEntries = Object.entries(summary.byCategory).sort(
    ([, a], [, b]) => b - a,
  );
  for (const [cat, count] of catEntries) {
    console.log(`  ${cat}: ${count}`);
  }

  // Trading status breakdown
  console.log("\n--- Trading Status ---");
  for (const [status, count] of Object.entries(summary.byTradingStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  // Top 10 by liquidity
  console.log("\n--- Top 10 by Liquidity ---");
  for (const m of summary.topByLiquidity) {
    const price =
      m.bestAsk !== null && m.bestBid !== null
        ? `ask=${m.bestAsk} bid=${m.bestBid}`
        : "no book";
    console.log(`  [${m.id}] ${m.title}`);
    console.log(`         ${price}  depth=${m.totalDepth}`);
  }

  // Cross-platform overlap candidates
  console.log("\n--- Likely Cross-Platform Overlap ---");
  const overlaps = output.markets.filter((m) => {
    const lower = (m.title + " " + m.categorySlug).toLowerCase();
    return OVERLAP_SLUGS.some((s) => lower.includes(s));
  });

  if (overlaps.length === 0) {
    console.log("  (no obvious overlap candidates found)");
  } else {
    const grouped: Record<string, MarketEntry[]> = {};
    for (const m of overlaps) {
      const lower = (m.title + " " + m.categorySlug).toLowerCase();
      let bucket = "Other";
      if (OVERLAP_SLUGS.slice(0, 4).some((s) => lower.includes(s))) {
        bucket = "Crypto";
      } else if (OVERLAP_SLUGS.slice(4, 8).some((s) => lower.includes(s))) {
        bucket = "Politics";
      } else if (OVERLAP_SLUGS.slice(8).some((s) => lower.includes(s))) {
        bucket = "Sports";
      }
      (grouped[bucket] ??= []).push(m);
    }

    for (const [bucket, markets] of Object.entries(grouped)) {
      console.log(`\n  ${bucket} (${markets.length} markets):`);
      for (const m of markets.slice(0, 10)) {
        console.log(`    [${m.id}] ${m.title}`);
      }
      if (markets.length > 10) {
        console.log(`    ... and ${markets.length - 10} more`);
      }
    }
  }

  console.log("\n========================================\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Discovering Predict.fun markets...");
  console.log(`  --pages ${MAX_PAGES === Infinity ? "ALL" : MAX_PAGES}  --orderbooks ${MAX_ORDERBOOKS === Infinity ? "ALL" : MAX_ORDERBOOKS}\n`);

  // 1. Fetch markets
  console.log("[1/3] Fetching open markets...");
  const rawMarkets = await fetchMarkets();

  // 2. Fetch orderbooks (only for first N markets)
  const orderbookCount = Math.min(
    rawMarkets.length,
    MAX_ORDERBOOKS === Infinity ? rawMarkets.length : MAX_ORDERBOOKS,
  );
  console.log(`\n[2/3] Fetching orderbooks for ${orderbookCount} of ${rawMarkets.length} markets...`);

  const markets: MarketEntry[] = [];
  for (let i = 0; i < rawMarkets.length; i++) {
    const m = rawMarkets[i];
    if (i < orderbookCount) {
      if (i > 0 && i % 10 === 0) {
        process.stdout.write(`  ${i}/${orderbookCount} orderbooks...\r`);
      }
      const orderbook = await fetchOrderbook(m.id);
      markets.push({ ...m, orderbook });
      await sleep(RATE_LIMIT_DELAY_MS);
    } else {
      markets.push({ ...m, orderbook: EMPTY_BOOK });
    }
  }
  console.log(`  ${orderbookCount}/${orderbookCount} orderbooks done.`);

  // 3. Build output
  console.log("\n[3/3] Building output...");
  const output: OutputFile = {
    fetchedAt: new Date().toISOString(),
    marketsTotal: rawMarkets.length,
    marketsFetched: markets.length,
    orderbooksFetched: orderbookCount,
    markets,
    summary: buildSummary(markets),
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Saved to ${OUT_PATH}`);

  printSummary(output);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
