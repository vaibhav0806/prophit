import type { MarketQuote, MarketMeta } from "@prophit/agent/src/types.js";

export interface MarketMetaResolver {
  getMarketMeta(marketId: `0x${string}`): MarketMeta | undefined;
}

export class QuoteStore {
  private quotes: MarketQuote[] = [];
  private updatedAt = 0;
  private metaResolvers: Map<string, MarketMetaResolver> = new Map();

  update(quotes: MarketQuote[], metaResolvers?: Map<string, MarketMetaResolver>): void {
    this.quotes = quotes;
    if (metaResolvers) {
      this.metaResolvers.clear();
      for (const [key, value] of metaResolvers) {
        this.metaResolvers.set(key, value);
      }
    }
    this.updatedAt = Date.now();
  }

  async getLatestQuotes(): Promise<MarketQuote[]> {
    return this.quotes;
  }

  getMetaResolvers(): Map<string, MarketMetaResolver> {
    return this.metaResolvers;
  }

  getUpdatedAt(): number {
    return this.updatedAt;
  }

  getCount(): number {
    return this.quotes.length;
  }
}
