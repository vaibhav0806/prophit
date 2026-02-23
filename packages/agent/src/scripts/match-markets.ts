import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../../data/predict-markets.json");

// ---------------------------------------------------------------------------
// Types (mirror discover-markets output)
// ---------------------------------------------------------------------------

interface OrderbookSummary {
  bestAsk: number | null;
  bestBid: number | null;
  spread: number | null;
  askDepth: number;
  bidDepth: number;
}

interface MarketEntry {
  id: number;
  title: string;
  question: string;
  description: string;
  conditionId: string;
  outcomes: Array<{ name: string; indexSet: number; onChainId: string }>;
  tradingStatus: string;
  status: string;
  categorySlug: string;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  orderbook: OrderbookSummary;
}

interface CachedData {
  fetchedAt: string;
  marketsTotal: number;
  marketsFetched: number;
  orderbooksFetched: number;
  markets: MarketEntry[];
  summary: {
    total: number;
    byCategory: Record<string, number>;
    byTradingStatus: Record<string, number>;
  };
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

interface CategoryRule {
  name: string;
  keywords: string[];
  description: string;
}

const CATEGORIES: CategoryRule[] = [
  {
    name: "Crypto Price",
    keywords: [
      "btc", "bitcoin", "eth", "ethereum", "bnb", "sol", "solana",
      "xrp", "doge", "crypto", "up or down", "price",
    ],
    description: "Crypto price prediction markets (BTC, ETH, BNB targets)",
  },
  {
    name: "Sports",
    keywords: [
      "nfl", "nba", "ncaa", "mlb", "nhl", "ufc", "mma",
      "soccer", "football", "basketball", "baseball", "tennis",
      "premier league", "champions league", "world cup",
    ],
    description: "Sports outcome markets",
  },
  {
    name: "Politics",
    keywords: [
      "trump", "biden", "election", "president", "congress",
      "senate", "governor", "politic", "democrat", "republican",
      "vote", "poll",
    ],
    description: "Political prediction markets",
  },
  {
    name: "Pop Culture / Social Media",
    keywords: [
      "twitter", "youtube", "tiktok", "instagram", "follower",
      "subscriber", "views", "viral", "celebrity", "movie",
      "oscar", "grammy", "emmy", "award",
    ],
    description: "Pop culture and social media markets",
  },
];

function classifyMarket(market: MarketEntry): string {
  const text = (
    market.title + " " + market.question + " " + market.categorySlug
  ).toLowerCase();

  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => text.includes(kw))) {
      return cat.name;
    }
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Generate PREDICT_MARKET_MAP template
// ---------------------------------------------------------------------------

function generateMapTemplate(
  markets: MarketEntry[],
): string {
  const map: Record<string, { predictMarketId: string; yesTokenId: string; noTokenId: string }> = {};

  for (const m of markets) {
    // Use conditionId as the key (this is what we'd match against Opinion)
    const yes = m.outcomes.find((o) => o.indexSet === 1);
    const no = m.outcomes.find((o) => o.indexSet === 2);

    if (!yes || !no) continue;

    map[m.conditionId] = {
      predictMarketId: String(m.id),
      yesTokenId: yes.onChainId,
      noTokenId: no.onChainId,
    };
  }

  return JSON.stringify(map, null, 2);
}

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

function printGroupedMarkets(
  grouped: Map<string, MarketEntry[]>,
  allMarkets: MarketEntry[],
): void {
  console.log("========================================");
  console.log(" Predict.fun Market Matcher");
  console.log("========================================\n");

  for (const cat of CATEGORIES) {
    const markets = grouped.get(cat.name) || [];
    console.log(`--- ${cat.name} (${markets.length} markets) ---`);
    console.log(`    ${cat.description}\n`);

    if (markets.length === 0) {
      console.log("    (none found)\n");
      continue;
    }

    // Sort by liquidity
    const sorted = [...markets].sort(
      (a, b) =>
        b.orderbook.askDepth + b.orderbook.bidDepth -
        (a.orderbook.askDepth + a.orderbook.bidDepth),
    );

    // Show top markets — these are most likely to overlap with Opinion
    const shown = sorted.slice(0, 15);
    for (const m of shown) {
      const depth = Math.round((m.orderbook.askDepth + m.orderbook.bidDepth) * 100) / 100;
      const price =
        m.orderbook.bestAsk !== null
          ? `ask=${m.orderbook.bestAsk}`
          : "no book";
      console.log(`    [${m.id}] ${m.title}`);
      console.log(`           ${price}  depth=${depth}  cat=${m.categorySlug}`);
    }
    if (markets.length > 15) {
      console.log(`    ... and ${markets.length - 15} more\n`);
    } else {
      console.log("");
    }
  }

  // Other / unclassified
  const other = grouped.get("Other") || [];
  console.log(`--- Other / Unclassified (${other.length} markets) ---`);
  if (other.length > 0) {
    const uniqueSlugs = [...new Set(other.map((m) => m.categorySlug))];
    console.log(`    Categories: ${uniqueSlugs.join(", ")}`);
    console.log(`    (These are less likely to overlap with Opinion)\n`);
  }

  // Overall stats
  const total = allMarkets.length;
  const classified = total - other.length;
  console.log("--- Cross-Platform Overlap Likelihood ---");
  console.log(`    Total markets: ${total}`);
  console.log(`    Classified for overlap: ${classified} (${Math.round((classified / total) * 100)}%)`);
  console.log(`    Unclassified: ${other.length}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Load cached data
  let raw: string;
  try {
    raw = await readFile(DATA_PATH, "utf-8");
  } catch {
    console.error(
      `No cached market data found at ${DATA_PATH}.\n` +
        "Run the discover script first: npx tsx src/scripts/discover-markets.ts",
    );
    process.exit(1);
  }

  const data: CachedData = JSON.parse(raw);
  console.log(`Loaded ${data.markets.length} markets (fetched at ${data.fetchedAt})\n`);

  // Classify and group
  const grouped = new Map<string, MarketEntry[]>();
  for (const m of data.markets) {
    const cat = classifyMarket(m);
    const list = grouped.get(cat) ?? [];
    list.push(m);
    grouped.set(cat, list);
  }

  // Print grouped results
  printGroupedMarkets(grouped, data.markets);

  // Generate PREDICT_MARKET_MAP template for high-overlap markets
  console.log("========================================");
  console.log(" PREDICT_MARKET_MAP Template");
  console.log("========================================\n");
  console.log("Highest-overlap markets (by liquidity) for env var:\n");

  // Pick top 10 classified markets by liquidity
  const classified = data.markets
    .filter((m) => classifyMarket(m) !== "Other")
    .sort(
      (a, b) =>
        b.orderbook.askDepth + b.orderbook.bidDepth -
        (a.orderbook.askDepth + a.orderbook.bidDepth),
    )
    .slice(0, 10);

  if (classified.length === 0) {
    console.log("(no classified markets found)\n");
  } else {
    console.log("# Add to .env (replace MARKET_ID placeholders with Opinion conditionIds):");
    console.log(`PREDICT_MARKET_MAP='${generateMapTemplate(classified)}'`);
    console.log("");
    console.log("Markets included:");
    for (const m of classified) {
      console.log(`  [${m.id}] ${m.title} (${classifyMarket(m)})`);
    }
  }

  console.log("\n========================================");
  console.log(" Next Steps");
  console.log("========================================");
  console.log("1. Get Opinion API key");
  console.log("2. Fetch Opinion markets and find matching conditionIds");
  console.log("3. Fill in OPINION_TOKEN_MAP with matched token IDs");
  console.log("4. Update PREDICT_MARKET_MAP keys to use shared conditionIds");
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
