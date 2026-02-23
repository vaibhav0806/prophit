import { MarketProvider } from "./base.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { decimalToBigInt } from "../utils.js";

// Predict.fun API: https://api.predict.fun
// Auth: x-api-key header
// Endpoints:
//   GET /v1/markets — list markets
//   GET /v1/markets/{id}/orderbook — orderbook (returns asks/bids as [price, quantity] arrays)

interface PredictMarket {
  id: number;
  conditionId: string;
  outcomes: Array<{
    name: string;
    indexSet: number; // 1 = YES, 2 = NO
    onChainId: string; // ERC-1155 tokenId
  }>;
  status: string; // "RESOLVED" etc
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
}

interface PredictOrderBook {
  asks: Array<[number, number]>; // [price, quantity]
  bids: Array<[number, number]>; // [price, quantity]
}

export class PredictProvider extends MarketProvider {
  private apiBase: string;
  private apiKey: string;
  private marketIds: `0x${string}`[];
  // Maps our internal marketId to Predict's market ID and outcome tokenIds
  private marketMap: Map<
    string,
    { predictMarketId: string; yesTokenId: string; noTokenId: string }
  >;

  constructor(
    adapterAddress: `0x${string}`,
    apiBase: string,
    apiKey: string,
    marketIds: `0x${string}`[],
    marketMap: Map<
      string,
      { predictMarketId: string; yesTokenId: string; noTokenId: string }
    >,
  ) {
    super("Predict", adapterAddress);
    this.apiBase = apiBase;
    this.apiKey = apiKey;
    this.marketIds = marketIds;
    this.marketMap = marketMap;
  }

  async fetchQuotes(): Promise<MarketQuote[]> {
    const quotes: MarketQuote[] = [];

    for (const marketId of this.marketIds) {
      const mapping = this.marketMap.get(marketId);
      if (!mapping) continue;

      try {
        const book = await this.fetchOrderBook(mapping.predictMarketId);

        // Predict returns asks/bids as [price, quantity] tuples
        // asks = people selling YES, bids = people buying YES
        // YES price = best ask price, NO price = 1 - best bid price
        const yesAsk = book.asks.length > 0 ? book.asks[0] : null;
        const noBid = book.bids.length > 0 ? book.bids[0] : null;

        const yesPrice = yesAsk ? decimalToBigInt(String(yesAsk[0]), 18) : 0n;
        // NO price is complement: if best bid for YES is 0.60, NO costs 0.40
        const noPrice = noBid
          ? 10n ** 18n - decimalToBigInt(String(noBid[0]), 18)
          : 0n;

        const yesLiq = book.asks.reduce(
          (sum, [, qty]) => sum + decimalToBigInt(String(qty), 6),
          0n,
        );
        const noLiq = book.bids.reduce(
          (sum, [, qty]) => sum + decimalToBigInt(String(qty), 6),
          0n,
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
        log.warn("Failed to fetch Predict quote", {
          marketId,
          error: String(err),
        });
      }
    }

    return quotes;
  }

  private async fetchOrderBook(
    predictMarketId: string,
  ): Promise<PredictOrderBook> {
    return withRetry(
      async () => {
        const url = `${this.apiBase}/v1/markets/${predictMarketId}/orderbook`;
        const res = await fetch(url, {
          headers: { "x-api-key": this.apiKey },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Predict API error: ${res.status}`);
        const json = await res.json();
        if (!json.success || !json.data)
          throw new Error("Predict API returned error");
        const book = json.data;
        if (!book.asks || !book.bids)
          throw new Error("Invalid orderbook response");
        return book as PredictOrderBook;
      },
      { label: `Predict orderbook ${predictMarketId}` },
    );
  }
}
