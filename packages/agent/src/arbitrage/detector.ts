import type { MarketQuote, ArbitOpportunity } from "../types.js";

const ONE = 10n ** 18n;
const USDT_DECIMALS = 6n;
const REF_AMOUNT = 100n * 10n ** USDT_DECIMALS; // 100 USDT reference (6 decimals)

function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

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
          const grossSpreadBps = Number(((ONE - costYesANoB) * 10000n) / ONE);

          // Worst-case fee: protocol charges feeBps on profit of the winning leg
          const feeIfYesWins = (ONE - a.yesPrice) * BigInt(a.feeBps) / 10000n;
          const feeIfNoWins = (ONE - b.noPrice) * BigInt(b.feeBps) / 10000n;
          const worstCaseFee = bigMax(feeIfYesWins, feeIfNoWins);

          const effectivePayout = ONE - worstCaseFee;
          const netSpread = effectivePayout - costYesANoB;
          if (netSpread <= 0n) continue;

          const spreadBps = Number((netSpread * 10000n) / ONE);
          const estProfit = (REF_AMOUNT * netSpread) / ONE;

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
            grossSpreadBps,
            feesDeducted: worstCaseFee,
            estProfit,
            liquidityA: a.yesLiquidity,
            liquidityB: b.noLiquidity,
          });
        }

        // Strategy 2: buy NO on A + buy YES on B
        const costNoAYesB = a.noPrice + b.yesPrice;
        if (costNoAYesB < ONE) {
          const grossSpreadBps = Number(((ONE - costNoAYesB) * 10000n) / ONE);

          // Worst-case fee: protocol charges feeBps on profit of the winning leg
          const feeIfYesWins = (ONE - b.yesPrice) * BigInt(b.feeBps) / 10000n;
          const feeIfNoWins = (ONE - a.noPrice) * BigInt(a.feeBps) / 10000n;
          const worstCaseFee = bigMax(feeIfYesWins, feeIfNoWins);

          const effectivePayout = ONE - worstCaseFee;
          const netSpread = effectivePayout - costNoAYesB;
          if (netSpread <= 0n) continue;

          const spreadBps = Number((netSpread * 10000n) / ONE);
          const estProfit = (REF_AMOUNT * netSpread) / ONE;

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
            grossSpreadBps,
            feesDeducted: worstCaseFee,
            estProfit,
            liquidityA: b.yesLiquidity,
            liquidityB: a.noLiquidity,
          });
        }
      }
    }
  }

  // Sort by spreadBps descending
  opportunities.sort((x, y) => y.spreadBps - x.spreadBps);

  return opportunities;
}
