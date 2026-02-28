import type { MarketQuote, MarketMeta } from "@prophet/agent/src/types.js";

export interface MarketMetaResolver {
  getMarketMeta(marketId: `0x${string}`): MarketMeta | undefined;
}

export class QuoteStore {
  private quotes: MarketQuote[] = [];
  private updatedAt = 0;
  private metaResolvers: Map<string, MarketMetaResolver> = new Map();
  private titleMap: Map<string, string> = new Map();
  private linkMap: Map<string, { predict?: string; probable?: string; opinion?: string }> = new Map();
  private imageMap: Map<string, string> = new Map();

  setTitles(titles: Map<string, string>): void {
    this.titleMap = titles;
  }

  getTitle(marketId: string): string | undefined {
    return this.titleMap.get(marketId);
  }

  setLinks(links: Map<string, { predict?: string; probable?: string; opinion?: string }>): void {
    this.linkMap = links;
  }

  getLinks(marketId: string): { predict?: string; probable?: string; opinion?: string } | undefined {
    return this.linkMap.get(marketId);
  }

  setImages(images: Map<string, string>): void {
    this.imageMap = images;
  }

  getImage(marketId: string): string | undefined {
    return this.imageMap.get(marketId);
  }

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
