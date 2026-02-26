import { Hono } from "hono";
import type { QuoteStore } from "../../scanner/quote-store.js";
import { detectArbitrage } from "@prophit/agent/src/arbitrage/detector.js";

export function createMarketRoutes(quoteStore: QuoteStore): Hono {
  const app = new Hono();

  // GET /api/markets - Browse available arb opportunities (global, no auth required)
  app.get("/", async (c) => {
    const quotes = await quoteStore.getLatestQuotes();
    const opportunities = detectArbitrage(quotes);

    return c.json({
      quoteCount: quotes.length,
      updatedAt: quoteStore.getUpdatedAt(),
      opportunities: opportunities.map(o => ({
        marketId: o.marketId,
        title: quoteStore.getTitle(o.marketId) ?? null,
        links: quoteStore.getLinks(o.marketId) ?? null,
        protocolA: o.protocolA,
        protocolB: o.protocolB,
        buyYesOnA: o.buyYesOnA,
        yesPriceA: o.yesPriceA.toString(),
        noPriceB: o.noPriceB.toString(),
        spreadBps: o.spreadBps,
        grossSpreadBps: o.grossSpreadBps,
        feesDeducted: o.feesDeducted.toString(),
        estProfit: o.estProfit.toString(),
        totalCost: o.totalCost.toString(),
        liquidityA: o.liquidityA.toString(),
        liquidityB: o.liquidityB.toString(),
      })),
    });
  });

  return app;
}
