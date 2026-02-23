import { MarketProvider } from "./base.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { decimalToBigInt } from "../utils.js";

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

  async fetchQuotes(): Promise<MarketQuote[]> {
    const quotes: MarketQuote[] = [];

    for (const marketId of this.marketIds) {
      const mapping = this.tokenMap.get(marketId);
      if (!mapping) continue;

      try {
        // Fetch orderbooks for YES and NO tokens
        const [yesBook, noBook] = await Promise.all([
          this.fetchOrderBook(mapping.yesTokenId),
          this.fetchOrderBook(mapping.noTokenId),
        ]);

        // Best ask price = what you'd pay to buy
        const yesPrice = yesBook.asks.length > 0
          ? decimalToBigInt(yesBook.asks[0].price, 18)
          : 0n;
        const noPrice = noBook.asks.length > 0
          ? decimalToBigInt(noBook.asks[0].price, 18)
          : 0n;

        // Liquidity from order depth (in USDT 6 decimals)
        const yesLiq = yesBook.asks.reduce(
          (sum, o) => sum + decimalToBigInt(o.size, 6), 0n,
        );
        const noLiq = noBook.asks.reduce(
          (sum, o) => sum + decimalToBigInt(o.size, 6), 0n,
        );

        quotes.push({
          marketId,
          protocol: this.name,
          yesPrice,
          noPrice,
          yesLiquidity: yesLiq,
          noLiquidity: noLiq,
        });
      } catch (err) {
        log.warn("Failed to fetch Opinion quote", { marketId, error: String(err) });
      }
    }

    return quotes;
  }

  private async fetchOrderBook(tokenId: string): Promise<OpinionOrderBook> {
    return withRetry(async () => {
      const url = `${this.apiBase}/token/orderbook?token_id=${tokenId}`;
      const res = await fetch(url, {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Opinion API error: ${res.status}`);
      const data = await res.json();
      if (!data.asks || !data.bids) throw new Error("Invalid orderbook response");
      return data as OpinionOrderBook;
    }, { label: `Opinion orderbook ${tokenId}` });
  }
}
