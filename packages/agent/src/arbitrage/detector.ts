import type { MarketQuote, ArbitOpportunity } from "../types.js";

const ONE = 10n ** 18n;
const USDT_DECIMALS = 6n;
const REF_AMOUNT = 100n * 10n ** USDT_DECIMALS; // 100 USDT reference (6 decimals)

function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/**
 * @param quotes Market quotes grouped by shared marketId
 * @param polarityMap Optional map of "protocolA:protocolB" → true when YES on A = NO on B.
 *                    When flipped, compare yesPriceA + yesPriceB (both YES sides) instead.
 */
export function detectArbitrage(
  quotes: MarketQuote[],
  polarityMap?: Map<string, boolean>,
): ArbitOpportunity[] {
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

        // Check if this pair has flipped polarity (YES on A = NO on B)
        const isFlipped = polarityMap?.get(`${a.protocol}:${b.protocol}`) ||
                          polarityMap?.get(`${b.protocol}:${a.protocol}`) ||
                          false;

        if (isFlipped) {
          // Polarity flipped: YES on A corresponds to YES on B (not NO on B)
          // Strategy: buy YES on A + buy YES on B (both YES sides, one will win)
          const costYesAYesB = a.yesPrice + b.yesPrice;
          if (costYesAYesB < ONE) {
            const grossSpreadBps = Number(((ONE - costYesAYesB) * 10000n) / ONE);
            const feeIfAWins = (ONE - a.yesPrice) * BigInt(a.feeBps) / 10000n;
            const feeIfBWins = (ONE - b.yesPrice) * BigInt(b.feeBps) / 10000n;
            const worstCaseFee = bigMax(feeIfAWins, feeIfBWins);
            const effectivePayout = ONE - worstCaseFee;
            const netSpread = effectivePayout - costYesAYesB;
            if (netSpread > 0n) {
              const spreadBps = Number((netSpread * 10000n) / ONE);
              const estProfit = (REF_AMOUNT * netSpread) / ONE;
              opportunities.push({
                marketId: a.marketId,
                protocolA: a.protocol,
                protocolB: b.protocol,
                buyYesOnA: true,
                yesPriceA: a.yesPrice,
                noPriceB: b.yesPrice, // flipped: B's YES is the opposing side
                totalCost: costYesAYesB,
                guaranteedPayout: ONE,
                spreadBps,
                grossSpreadBps,
                feesDeducted: worstCaseFee,
                estProfit,
                liquidityA: a.yesLiquidity,
                liquidityB: b.yesLiquidity,
                polarityFlip: true,
              });
            }
          }

          // Strategy: buy NO on A + buy NO on B
          const costNoANoB = a.noPrice + b.noPrice;
          if (costNoANoB < ONE) {
            const grossSpreadBps = Number(((ONE - costNoANoB) * 10000n) / ONE);
            const feeIfAWins = (ONE - a.noPrice) * BigInt(a.feeBps) / 10000n;
            const feeIfBWins = (ONE - b.noPrice) * BigInt(b.feeBps) / 10000n;
            const worstCaseFee = bigMax(feeIfAWins, feeIfBWins);
            const effectivePayout = ONE - worstCaseFee;
            const netSpread = effectivePayout - costNoANoB;
            if (netSpread > 0n) {
              const spreadBps = Number((netSpread * 10000n) / ONE);
              const estProfit = (REF_AMOUNT * netSpread) / ONE;
              opportunities.push({
                marketId: a.marketId,
                protocolA: a.protocol,
                protocolB: b.protocol,
                buyYesOnA: false,
                yesPriceA: b.noPrice,
                noPriceB: a.noPrice,
                totalCost: costNoANoB,
                guaranteedPayout: ONE,
                spreadBps,
                grossSpreadBps,
                feesDeducted: worstCaseFee,
                estProfit,
                liquidityA: a.noLiquidity,
                liquidityB: b.noLiquidity,
                polarityFlip: true,
              });
            }
          }

          continue; // skip normal strategies for flipped pairs
        }

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
