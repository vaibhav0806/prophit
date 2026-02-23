import { MarketProvider } from "./base.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { decimalToBigInt } from "../utils.js";

const ONE = 10n ** 18n;
const MIN_LIQUIDITY = 1_000_000n; // 1 USDT minimum liquidity (6 decimals)

// Probable Markets API (no auth required for reading):
//   Events: https://market-api.probable.markets/public/api/v1/events?active=true
//   Orderbook: https://api.probable.markets/public/api/v1/book?token_id=X
// Pagination: default limit=20, max per page=100, use offset for next pages

interface ProbableOrderBook {
  asks: Array<{ price: string; size: string }>;
  bids: Array<{ price: string; size: string }>;
}

export interface ProbableEvent {
  id: string;
  title: string;
  slug: string;
  active: boolean;
  tags: string[];
  markets: ProbableMarket[];
}

export interface ProbableMarket {
  id: string;
  question: string;
  clobTokenIds: string; // JSON string: '["yesTokenId","noTokenId"]'
  outcomes: string; // JSON string: '["Yes","No"]'
  tokens: Array<{ token_id: string; outcome: string }>;
}

export class ProbableProvider extends MarketProvider {
  private apiBase: string;
  private eventsApiBase: string;
  private marketIds: `0x${string}`[];
  private marketMap: Map<
    string,
    { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string }
  >;

  constructor(
    adapterAddress: `0x${string}`,
    apiBase: string,
    marketIds: `0x${string}`[],
    marketMap: Map<
      string,
      { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string }
    >,
    eventsApiBase?: string,
  ) {
    super("Probable", adapterAddress);
    this.apiBase = apiBase;
    this.eventsApiBase = eventsApiBase || "https://market-api.probable.markets";
    this.marketIds = marketIds;
    this.marketMap = marketMap;
  }

  async fetchQuotes(): Promise<MarketQuote[]> {
    const quotes: MarketQuote[] = [];

    for (const marketId of this.marketIds) {
      const mapping = this.marketMap.get(marketId);
      if (!mapping) continue;

      try {
        // Fetch orderbooks for YES and NO tokens
        const [yesBook, noBook] = await Promise.all([
          this.fetchOrderBook(mapping.yesTokenId),
          this.fetchOrderBook(mapping.noTokenId),
        ]);

        // Sort asks ascending by price (API doesn't guarantee order)
        const sortedYesAsks = [...yesBook.asks].sort((a, b) => Number(a.price) - Number(b.price));
        const sortedNoAsks = [...noBook.asks].sort((a, b) => Number(a.price) - Number(b.price));

        // Best ask price = lowest ask = what you'd pay to buy that outcome
        const yesPrice = sortedYesAsks.length > 0
          ? decimalToBigInt(sortedYesAsks[0].price, 18)
          : 0n;
        const noPrice = sortedNoAsks.length > 0
          ? decimalToBigInt(sortedNoAsks[0].price, 18)
          : 0n;

        // Liquidity from ask-side order depth (in 6-decimal USDT)
        const yesLiq = yesBook.asks.reduce(
          (sum, o) => sum + decimalToBigInt(o.size, 6), 0n,
        );
        const noLiq = noBook.asks.reduce(
          (sum, o) => sum + decimalToBigInt(o.size, 6), 0n,
        );

        // Skip quotes with invalid prices or insufficient liquidity
        if (yesPrice <= 0n || noPrice <= 0n) {
          log.warn("Skipping zero-price quote", { marketId, protocol: this.name });
          continue;
        }
        if (yesPrice >= ONE || noPrice >= ONE) {
          log.warn("Skipping out-of-range price", { marketId, protocol: this.name, yesPrice: yesPrice.toString(), noPrice: noPrice.toString() });
          continue;
        }
        if (yesLiq < MIN_LIQUIDITY || noLiq < MIN_LIQUIDITY) {
          log.warn("Skipping low-liquidity quote", { marketId, protocol: this.name, yesLiq: yesLiq.toString(), noLiq: noLiq.toString() });
          continue;
        }

        quotes.push({
          marketId,
          protocol: this.name,
          yesPrice,
          noPrice,
          yesLiquidity: yesLiq,
          noLiquidity: noLiq,
          feeBps: 0,
        });
      } catch (err) {
        log.warn("Failed to fetch Probable quote", { marketId, error: String(err) });
      }
    }

    return quotes;
  }

  /**
   * Discover all active events from Probable API with proper pagination.
   * Max 100 events per page; paginates via offset until all fetched.
   */
  async discoverEvents(): Promise<ProbableEvent[]> {
    const PAGE_SIZE = 100;
    const allEvents: ProbableEvent[] = [];
    let offset = 0;

    while (true) {
      const url = `${this.eventsApiBase}/public/api/v1/events?active=true&limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Probable events API error: ${res.status}`);

      const events = (await res.json()) as ProbableEvent[];
      if (!Array.isArray(events) || events.length === 0) break;

      allEvents.push(...events);
      log.info("Probable: fetched events page", { offset, count: events.length, total: allEvents.length });

      if (events.length < PAGE_SIZE) break; // last page
      offset += PAGE_SIZE;
    }

    return allEvents;
  }

  private async fetchOrderBook(tokenId: string): Promise<ProbableOrderBook> {
    return withRetry(async () => {
      const url = `${this.apiBase}/public/api/v1/book?token_id=${tokenId}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Probable API error: ${res.status}`);
      const data = await res.json();
      if (!data.asks || !data.bids) throw new Error("Invalid orderbook response");
      return data as ProbableOrderBook;
    }, { label: `Probable orderbook ${tokenId}` });
  }
}
