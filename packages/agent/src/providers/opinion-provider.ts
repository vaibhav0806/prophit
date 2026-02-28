import { MarketProvider } from "./base.js";
import type { MarketQuote, MarketMeta } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { decimalToBigInt, pMap } from "../utils.js";

const ONE = 10n ** 18n;
const MIN_LIQUIDITY = 1_000_000n; // 1 USDT minimum liquidity (6 decimals)

// Opinion API: https://openapi.opinion.trade/openapi
// Auth: apikey header
// Endpoints:
//   GET /market — list markets
//   GET /token/orderbook?token_id=X — orderbook
//   GET /token/latest-price?token_id=X — latest price

interface OpinionMarket {
  topicId: number;
  conditionId: string;
  tokens: Array<{
    tokenId: string;
    outcome: string; // "Yes" | "No"
    price: string;
  }>;
  status: number; // 4 = RESOLVED
  liquidity?: number;
}

interface OpinionOrderBook {
  asks: Array<{ price: string; size: string }>;
  bids: Array<{ price: string; size: string }>;
}

export class OpinionProvider extends MarketProvider {
  private apiBase: string;
  private apiKey: string;
  private marketIds: `0x${string}`[];
  // Maps our internal marketId to Opinion's tokenIds
  private tokenMap: Map<string, { yesTokenId: string; noTokenId: string; topicId: string }>;

  constructor(
    adapterAddress: `0x${string}`,
    apiBase: string,
    apiKey: string,
    marketIds: `0x${string}`[],
    tokenMap: Map<string, { yesTokenId: string; noTokenId: string; topicId: string }>,
  ) {
    super("Opinion", adapterAddress);
    this.apiBase = apiBase;
    this.apiKey = apiKey;
    this.marketIds = marketIds;
    this.tokenMap = tokenMap;
  }

  getMarketMeta(marketId: `0x${string}`): MarketMeta | undefined {
    const mapping = this.tokenMap.get(marketId);
    if (!mapping) return undefined;
    return {
      conditionId: marketId,
      yesTokenId: mapping.yesTokenId,
      noTokenId: mapping.noTokenId,
    };
  }

  async fetchQuotes(): Promise<MarketQuote[]> {
    const entries = this.marketIds
      .map((id) => ({ id, mapping: this.tokenMap.get(id) }))
      .filter((e): e is { id: `0x${string}`; mapping: NonNullable<typeof e.mapping> } => !!e.mapping);

    const results = await pMap(entries, async ({ id: marketId, mapping }) => {
      try {
        // Fetch orderbooks sequentially to avoid hammering Opinion's rate limits.
        // With concurrency=3 and 2 requests per market, parallel would mean 6 simultaneous
        // connections — enough to trigger 429s. Sequential keeps it at 3.
        const yesBook = await this.fetchOrderBook(mapping.yesTokenId);
        const noBook = await this.fetchOrderBook(mapping.noTokenId);

        // Sort asks ascending for correct best-price and depth calculation
        const sortedYesAsks = [...yesBook.asks].sort((a, b) => Number(a.price) - Number(b.price));
        const sortedNoAsks = [...noBook.asks].sort((a, b) => Number(a.price) - Number(b.price));

        // Best ask price = what you'd pay to buy
        const yesPrice = sortedYesAsks.length > 0
          ? decimalToBigInt(sortedYesAsks[0].price, 18)
          : 0n;
        const noPrice = sortedNoAsks.length > 0
          ? decimalToBigInt(sortedNoAsks[0].price, 18)
          : 0n;

        // Depth at fillable price: only count asks within order slippage range (100 bps)
        const yesMaxPrice = Number(sortedYesAsks[0]?.price ?? 0) * 1.01;
        const noMaxPrice = Number(sortedNoAsks[0]?.price ?? 0) * 1.01;
        const yesLiq = sortedYesAsks
          .filter(o => Number(o.price) <= yesMaxPrice)
          .reduce((sum, o) => sum + decimalToBigInt(o.size, 6), 0n);
        const noLiq = sortedNoAsks
          .filter(o => Number(o.price) <= noMaxPrice)
          .reduce((sum, o) => sum + decimalToBigInt(o.size, 6), 0n);

        // Skip quotes with invalid prices or insufficient liquidity
        if (yesPrice <= 0n || noPrice <= 0n) {
          log.warn("Skipping zero-price quote", { marketId, protocol: this.name });
          return null;
        }
        if (yesPrice >= ONE || noPrice >= ONE) {
          log.warn("Skipping out-of-range price", { marketId, protocol: this.name, yesPrice: yesPrice.toString(), noPrice: noPrice.toString() });
          return null;
        }
        if (yesLiq < MIN_LIQUIDITY || noLiq < MIN_LIQUIDITY) {
          log.warn("Skipping low-liquidity quote", { marketId, protocol: this.name, yesLiq: yesLiq.toString(), noLiq: noLiq.toString() });
          return null;
        }

        return {
          marketId,
          protocol: this.name,
          yesPrice,
          noPrice,
          yesLiquidity: yesLiq,
          noLiquidity: noLiq,
          feeBps: 200,
          quotedAt: Date.now(),
        } satisfies MarketQuote;
      } catch (err) {
        log.warn("Failed to fetch Opinion quote", { marketId, error: String(err) });
        return null;
      }
    }, 3);

    return results.filter((q): q is MarketQuote => q !== null);
  }

  private async fetchOrderBook(tokenId: string): Promise<OpinionOrderBook> {
    return withRetry(async () => {
      const url = `${this.apiBase}/token/orderbook?token_id=${tokenId}`;
      const res = await fetch(url, {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`Opinion API error: ${res.status}`);
      const data = await res.json() as any;
      // Response is { errno, result: { bids, asks } }
      const book = data.result ?? data;
      if (!book.asks || !book.bids) throw new Error("Invalid orderbook response");
      return book as OpinionOrderBook;
    }, {
      label: `Opinion orderbook ${tokenId}`,
      retries: 1,
      delayMs: 500,
      shouldRetry: (err) => !String(err).includes("429"), // don't retry rate limits
    });
  }
}
