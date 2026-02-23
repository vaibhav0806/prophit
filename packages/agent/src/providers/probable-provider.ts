import { MarketProvider } from "./base.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { decimalToBigInt } from "../utils.js";

// Probable Markets API (no auth required for reading):
//   Events: https://market-api.probable.markets/public/api/v1/events?active=true
//   Orderbook: https://api.probable.markets/public/api/v1/book?token_id=X

interface ProbableOrderBook {
  asks: Array<{ price: string; size: string }>;
  bids: Array<{ price: string; size: string }>;
}

export class ProbableProvider extends MarketProvider {
  private apiBase: string;
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
  ) {
    super("Probable", adapterAddress);
    this.apiBase = apiBase;
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

        quotes.push({
          marketId,
          protocol: this.name,
          yesPrice,
          noPrice,
          yesLiquidity: yesLiq,
          noLiquidity: noLiq,
        });
      } catch (err) {
        log.warn("Failed to fetch Probable quote", { marketId, error: String(err) });
      }
    }

    return quotes;
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
