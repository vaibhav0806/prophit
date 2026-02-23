import { MarketProvider } from "./base.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";

interface PolymarketBook {
  market: string;
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

const CLOB_BASE_DEFAULT = "https://clob.polymarket.com";

export class PolymarketProvider extends MarketProvider {
  private marketIds: `0x${string}`[];
  // Map from our marketId to Polymarket's token IDs [yesTokenId, noTokenId]
  private tokenMap: Map<string, { yesTokenId: string; noTokenId: string }>;
  private clobBase: string;

  constructor(
    adapterAddress: `0x${string}`,
    marketIds: `0x${string}`[],
    tokenMap: Map<string, { yesTokenId: string; noTokenId: string }>,
    clobBase?: string,
  ) {
    super("Polymarket", adapterAddress);
    this.marketIds = marketIds;
    this.tokenMap = tokenMap;
    this.clobBase = clobBase ?? CLOB_BASE_DEFAULT;
  }

  async fetchQuotes(): Promise<MarketQuote[]> {
    const quotes: MarketQuote[] = [];

    for (const marketId of this.marketIds) {
      try {
        const tokens = this.tokenMap.get(marketId);
        if (!tokens) continue;

        // Fetch order books for YES and NO tokens in parallel
        const [yesBook, noBook] = await Promise.all([
          this.fetchBook(tokens.yesTokenId),
          this.fetchBook(tokens.noTokenId),
        ]);

        // Best ask = price to buy at
        const yesPrice =
          yesBook.asks.length > 0
            ? this.priceToWei(yesBook.asks[0].price)
            : 0n;
        const noPrice =
          noBook.asks.length > 0
            ? this.priceToWei(noBook.asks[0].price)
            : 0n;

        // Liquidity = total size on ask side (in USDC 6 decimals)
        const yesLiquidity = yesBook.asks.reduce(
          (sum, o) => sum + BigInt(Math.floor(Number(o.size) * 1e6)),
          0n,
        );
        const noLiquidity = noBook.asks.reduce(
          (sum, o) => sum + BigInt(Math.floor(Number(o.size) * 1e6)),
          0n,
        );

        quotes.push({
          marketId,
          protocol: this.name,
          yesPrice,
          noPrice,
          yesLiquidity,
          noLiquidity,
        });
      } catch (err) {
        log.error("Error fetching Polymarket quote", { marketId, error: String(err) });
      }
    }

    return quotes;
  }

  private async fetchBook(tokenId: string): Promise<PolymarketBook> {
    const res = await fetch(`${this.clobBase}/book?token_id=${tokenId}`);
    if (!res.ok) throw new Error(`CLOB API error: ${res.status}`);
    return res.json();
  }

  /** Convert a decimal price string like "0.55" to 18-decimal bigint (0.55e18) */
  private priceToWei(price: string): bigint {
    const num = Number(price);
    return BigInt(Math.floor(num * 1e18));
  }
}
