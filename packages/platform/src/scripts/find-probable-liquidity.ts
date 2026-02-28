/**
 * Find Probable markets with actual orderbook liquidity.
 *
 * Fetches all active events, checks orderbooks for each market's YES/NO tokens,
 * and reports the most liquid markets with their tokenIds, best bid/ask, and depth.
 *
 * Usage: npx tsx packages/platform/src/scripts/find-probable-liquidity.ts
 */

const EVENTS_API_BASE = "https://market-api.probable.markets";
const API_BASE = "https://api.probable.markets";
const CHAIN_ID = 56;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProbableEvent {
  id: string;
  title: string;
  slug: string;
  active: boolean;
  markets: ProbableMarket[];
}

interface ProbableMarket {
  id: string;
  question: string;
  clobTokenIds: string;
  outcomes: string;
  tokens: Array<{ token_id: string; outcome: string }>;
}

interface OrderLevel {
  price: string;
  size: string;
}

interface OrderBook {
  bids: OrderLevel[];
  asks: OrderLevel[];
}

interface MarketLiquidity {
  eventTitle: string;
  marketQuestion: string;
  marketId: string;
  yesTokenId: string;
  noTokenId: string;
  yesBids: number;
  yesAsks: number;
  noBids: number;
  noAsks: number;
  yesBestBid: number | null;
  yesBestAsk: number | null;
  noBestBid: number | null;
  noBestAsk: number | null;
  yesBidDepth: number; // total size in bids
  yesAskDepth: number;
  noBidDepth: number;
  noAskDepth: number;
  totalDepth: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchEvents(): Promise<ProbableEvent[]> {
  const PAGE_SIZE = 100;
  const allEvents: ProbableEvent[] = [];
  let offset = 0;

  while (true) {
    const url = `${EVENTS_API_BASE}/public/api/v1/events?active=true&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.error(`Events API error: ${res.status}`);
      break;
    }
    const events = (await res.json()) as ProbableEvent[];
    if (!Array.isArray(events) || events.length === 0) break;
    allEvents.push(...events);
    console.log(`  Fetched events page offset=${offset}, got ${events.length}, total=${allEvents.length}`);
    if (events.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allEvents;
}

async function fetchOrderBook(tokenId: string): Promise<OrderBook> {
  const url = `${API_BASE}/public/api/v1/book?token_id=${tokenId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    return { bids: [], asks: [] };
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    bids: (data.bids ?? []) as OrderLevel[],
    asks: (data.asks ?? []) as OrderLevel[],
  };
}

function sumDepth(levels: OrderLevel[]): number {
  return levels.reduce((sum, l) => sum + Number(l.size), 0);
}

function bestPrice(levels: OrderLevel[], side: "bid" | "ask"): number | null {
  if (levels.length === 0) return null;
  // bids: highest price first; asks: lowest price first
  const sorted = [...levels].sort((a, b) =>
    side === "bid"
      ? Number(b.price) - Number(a.price)
      : Number(a.price) - Number(b.price),
  );
  return Number(sorted[0].price);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Finding Probable Markets with Orderbook Liquidity ===\n");

  // Step 1: Fetch all active events
  console.log("[1] Fetching active events...");
  const events = await fetchEvents();
  console.log(`  Total events: ${events.length}\n`);

  // Step 2: Parse binary markets (all 2-outcome markets, not just yes/no labels)
  console.log("[2] Parsing binary markets...");
  const markets: Array<{
    eventTitle: string;
    market: ProbableMarket;
    yesTokenId: string;
    noTokenId: string;
  }> = [];

  for (const event of events) {
    if (!event.markets || !Array.isArray(event.markets)) continue;
    for (const market of event.markets) {
      // Prefer tokens array (always has Yes/No outcome labels even for sports markets)
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
        let outcomes: string[];
        let tokenIds: string[];
        try {
          outcomes = JSON.parse(market.outcomes);
          tokenIds = JSON.parse(market.clobTokenIds);
        } catch {
          continue;
        }
        if (outcomes.length !== 2 || tokenIds.length !== 2) continue;
        // Use positional: first token = first outcome
        yesTokenId = tokenIds[0];
        noTokenId = tokenIds[1];
      }

      if (!yesTokenId || !noTokenId) continue;

      markets.push({
        eventTitle: event.title,
        market,
        yesTokenId,
        noTokenId,
      });
    }
  }

  console.log(`  Binary markets found: ${markets.length}\n`);

  // Step 3: Check orderbooks
  console.log("[3] Checking orderbooks (this may take a while)...");
  const results: MarketLiquidity[] = [];
  let checked = 0;
  const BATCH_SIZE = 5; // concurrent requests

  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const [yesBook, noBook] = await Promise.all([
          fetchOrderBook(entry.yesTokenId),
          fetchOrderBook(entry.noTokenId),
        ]);

        const yesBidDepth = sumDepth(yesBook.bids);
        const yesAskDepth = sumDepth(yesBook.asks);
        const noBidDepth = sumDepth(noBook.bids);
        const noAskDepth = sumDepth(noBook.asks);

        return {
          eventTitle: entry.eventTitle,
          marketQuestion: entry.market.question || entry.eventTitle,
          marketId: entry.market.id,
          yesTokenId: entry.yesTokenId,
          noTokenId: entry.noTokenId,
          yesBids: yesBook.bids.length,
          yesAsks: yesBook.asks.length,
          noBids: noBook.bids.length,
          noAsks: noBook.asks.length,
          yesBestBid: bestPrice(yesBook.bids, "bid"),
          yesBestAsk: bestPrice(yesBook.asks, "ask"),
          noBestBid: bestPrice(noBook.bids, "bid"),
          noBestAsk: bestPrice(noBook.asks, "ask"),
          yesBidDepth,
          yesAskDepth,
          noBidDepth,
          noAskDepth,
          totalDepth: yesBidDepth + yesAskDepth + noBidDepth + noAskDepth,
        } satisfies MarketLiquidity;
      }),
    );

    results.push(...batchResults);
    checked += batch.length;

    // Progress every 50 markets
    if (checked % 50 === 0 || checked === markets.length) {
      const withLiq = results.filter(
        (r) => r.yesBids + r.yesAsks + r.noBids + r.noAsks > 0,
      ).length;
      console.log(`  Checked ${checked}/${markets.length} markets, ${withLiq} have liquidity`);
    }

    // Small delay to avoid rate limiting
    if (i + BATCH_SIZE < markets.length) {
      await sleep(100);
    }
  }

  // Step 4: Filter and rank
  const withLiquidity = results.filter(
    (r) => r.yesBids + r.yesAsks + r.noBids + r.noAsks > 0,
  );
  const withBothSides = results.filter(
    (r) =>
      (r.yesBids > 0 || r.yesAsks > 0) &&
      (r.noBids > 0 || r.noAsks > 0),
  );
  const withBidsAndAsks = results.filter(
    (r) =>
      r.yesBids > 0 &&
      r.yesAsks > 0 &&
      r.noBids > 0 &&
      r.noAsks > 0,
  );

  console.log("\n=== RESULTS ===\n");
  console.log(`Total binary markets:          ${markets.length}`);
  console.log(`Markets with ANY liquidity:    ${withLiquidity.length}`);
  console.log(`Markets with YES+NO liquidity: ${withBothSides.length}`);
  console.log(`Markets with full 2-sided:     ${withBidsAndAsks.length}`);

  // Sort by total depth
  const sorted = [...withLiquidity].sort((a, b) => b.totalDepth - a.totalDepth);

  // Top 20 most liquid
  console.log("\n=== TOP 20 MOST LIQUID MARKETS ===\n");
  const top = sorted.slice(0, 20);

  for (let i = 0; i < top.length; i++) {
    const m = top[i];
    console.log(`#${i + 1}: ${m.marketQuestion}`);
    console.log(`    Event:       ${m.eventTitle}`);
    console.log(`    Market ID:   ${m.marketId}`);
    console.log(`    YES tokenId: ${m.yesTokenId}`);
    console.log(`    NO  tokenId: ${m.noTokenId}`);
    console.log(
      `    YES book:    ${m.yesBids} bids / ${m.yesAsks} asks | bestBid=${m.yesBestBid} bestAsk=${m.yesBestAsk} | bidDepth=${m.yesBidDepth.toFixed(2)} askDepth=${m.yesAskDepth.toFixed(2)}`,
    );
    console.log(
      `    NO  book:    ${m.noBids} bids / ${m.noAsks} asks | bestBid=${m.noBestBid} bestAsk=${m.noBestAsk} | bidDepth=${m.noBidDepth.toFixed(2)} askDepth=${m.noAskDepth.toFixed(2)}`,
    );
    console.log(`    Total depth: ${m.totalDepth.toFixed(2)}`);
    console.log();
  }

  // Also show a quick list of all markets with full 2-sided liquidity
  if (withBidsAndAsks.length > 0) {
    console.log("\n=== ALL MARKETS WITH FULL 2-SIDED LIQUIDITY (bids+asks on both YES and NO) ===\n");
    const sortedFull = [...withBidsAndAsks].sort((a, b) => b.totalDepth - a.totalDepth);
    for (const m of sortedFull) {
      const spread = (m.yesBestAsk !== null && m.yesBestBid !== null)
        ? ((m.yesBestAsk - m.yesBestBid) * 100).toFixed(1)
        : "?";
      console.log(
        `  ${m.marketQuestion.slice(0, 80).padEnd(80)} | depth=${m.totalDepth.toFixed(0).padStart(8)} | YES ${m.yesBestBid}/${m.yesBestAsk} (spread ${spread}%) | NO ${m.noBestBid}/${m.noBestAsk}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
