import type { MarketQuote, ArbitOpportunity } from "../types.js";

const ONE = 10n ** 18n;
const USDT_DECIMALS = 6n;
const REF_AMOUNT = 100n * 10n ** USDT_DECIMALS; // 100 USDT reference (6 decimals)

export function detectArbitrage(quotes: MarketQuote[]): ArbitOpportunity[] {
  // Group quotes by marketId
  const byMarket = new Map<string, MarketQuote[]>();
  for (const q of quotes) {
    const key = q.marketId;
    const arr = byMarket.get(key) ?? [];
    arr.push(q);
    byMarket.set(key, arr);
  }

  const opportunities: ArbitOpportunity[] = [];

  for (const [, marketQuotes] of byMarket) {
    if (marketQuotes.length < 2) continue;

    // Check all pairs
    for (let i = 0; i < marketQuotes.length; i++) {
      for (let j = i + 1; j < marketQuotes.length; j++) {
        const a = marketQuotes[i];
        const b = marketQuotes[j];

        // Strategy 1: buy YES on A + buy NO on B
        const costYesANoB = a.yesPrice + b.noPrice;
        if (costYesANoB < ONE) {
          const spreadBps = Number(((ONE - costYesANoB) * 10000n) / ONE);
          // estProfit: for REF_AMOUNT per side, shares = amount * 1e18 / price
          // total cost = REF_AMOUNT on each side = 2 * REF_AMOUNT
          // guaranteed payout per share = 1e18
          // profit = payout - totalCost per pair of shares
          const estProfit =
            (REF_AMOUNT * (ONE - costYesANoB)) / ONE;

          opportunities.push({
            marketId: a.marketId,
            protocolA: a.protocol,
            protocolB: b.protocol,
            buyYesOnA: true,
            yesPriceA: a.yesPrice,
            noPriceB: b.noPrice,
            totalCost: costYesANoB,
            guaranteedPayout: ONE,
            spreadBps,
            estProfit,
          });
        }

        // Strategy 2: buy NO on A + buy YES on B
        const costNoAYesB = a.noPrice + b.yesPrice;
        if (costNoAYesB < ONE) {
          const spreadBps = Number(((ONE - costNoAYesB) * 10000n) / ONE);
          const estProfit =
            (REF_AMOUNT * (ONE - costNoAYesB)) / ONE;

          opportunities.push({
            marketId: a.marketId,
            protocolA: a.protocol,
            protocolB: b.protocol,
            buyYesOnA: false,
            yesPriceA: b.yesPrice,
            noPriceB: a.noPrice,
            totalCost: costNoAYesB,
            guaranteedPayout: ONE,
            spreadBps,
            estProfit,
          });
        }
      }
    }
  }

  // Sort by spreadBps descending
  opportunities.sort((x, y) => y.spreadBps - x.spreadBps);

  return opportunities;
}
