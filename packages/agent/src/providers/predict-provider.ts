import { MarketProvider } from "./base.js";
import type { MarketQuote, MarketMeta } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { decimalToBigInt, pMap } from "../utils.js";

const ONE = 10n ** 18n;
const MIN_LIQUIDITY = 1_000_000n; // 1 USDT minimum liquidity (6 decimals)

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
  private deadMarketIds = new Set<string>();
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
    const entries = this.marketIds
      .filter((id) => !this.deadMarketIds.has(id))
      .map((id) => ({ id, mapping: this.marketMap.get(id) }))
      .filter((e): e is { id: `0x${string}`; mapping: NonNullable<typeof e.mapping> } => !!e.mapping);

    const results = await pMap(entries, async ({ id: marketId, mapping }) => {
      try {
        const book = await this.fetchOrderBook(mapping.predictMarketId);

        // PRICING NOTE: Predict uses a single-market orderbook where asks = YES sellers,
        // bids = YES buyers. YES price = best ask, NO price = 1 - best bid (complement).
        // This differs from Probable which fetches separate YES/NO orderbooks and uses
        // ask-only pricing for both. The complement approach can create phantom spreads
        // if the YES bid-ask spread is wide. Consider fetching NO-specific orderbook if available.

        // Sort asks ascending (lowest first), bids descending (highest first)
        const sortedAsks = [...book.asks].sort((a, b) => a[0] - b[0]);
        const sortedBids = [...book.bids].sort((a, b) => b[0] - a[0]);
        const yesAsk = sortedAsks.length > 0 ? sortedAsks[0] : null;
        const noBid = sortedBids.length > 0 ? sortedBids[0] : null;

        const yesPrice = yesAsk ? decimalToBigInt(String(yesAsk[0]), 18) : 0n;
        // NO price is complement: if best bid for YES is 0.60, NO costs 0.40
        const noPrice = noBid
          ? 10n ** 18n - decimalToBigInt(String(noBid[0]), 18)
          : 0n;

        // Depth at fillable price: only count levels within order slippage range (200 bps)
        const yesMaxPrice = yesAsk ? yesAsk[0] * 1.02 : 0;
        const noMinBid = noBid ? noBid[0] * 0.98 : Infinity;
        const yesLiq = sortedAsks
          .filter(([p]) => p <= yesMaxPrice)
          .reduce((sum, [, qty]) => sum + decimalToBigInt(String(qty), 6), 0n);
        const noLiq = sortedBids
          .filter(([p]) => p >= noMinBid)
          .reduce((sum, [, qty]) => sum + decimalToBigInt(String(qty), 6), 0n);

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
          feeBps: 200, // Predict minimum fee rate; TODO: fetch per-market feeRateBps from API
          quotedAt: Date.now(),
        } satisfies MarketQuote;
      } catch (err) {
        if (err instanceof Error && err.message.includes("404")) {
          this.deadMarketIds.add(marketId);
          log.info("Predict market delisted, skipping future polls", { marketId });
        } else {
          log.warn("Failed to fetch Predict quote", { marketId, error: String(err) });
        }
        return null;
      }
    }, 10);

    return results.filter((q): q is MarketQuote => q !== null);
  }

  getMarketMeta(marketId: `0x${string}`): MarketMeta | undefined {
    const mapping = this.marketMap.get(marketId);
    if (!mapping) return undefined;
    return {
      conditionId: marketId,
      yesTokenId: mapping.yesTokenId,
      noTokenId: mapping.noTokenId,
      predictMarketId: mapping.predictMarketId,
    };
  }

  private async fetchOrderBook(
    predictMarketId: string,
  ): Promise<PredictOrderBook> {
    return withRetry(
      async () => {
        const url = `${this.apiBase}/v1/markets/${predictMarketId}/orderbook`;
        const res = await fetch(url, {
          headers: { "x-api-key": this.apiKey },
          signal: AbortSignal.timeout(5_000),
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
      { label: `Predict orderbook ${predictMarketId}`, retries: 1, delayMs: 500, shouldRetry: (err) => !(err instanceof Error && err.message.includes("404")) },
    );
  }
}
