import { Hono } from "hono";
import type { Database } from "@prophit/shared/db";
import { trades } from "@prophit/shared/db";
import { eq, desc } from "drizzle-orm";
import type { AuthEnv } from "../server.js";

export function createTradeRoutes(db: Database): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // GET /api/trades - User's trade history
  app.get("/", async (c) => {
    const userId = c.get("userId") as string;
    const limit = Number(c.req.query("limit") ?? "50");
    const offset = Number(c.req.query("offset") ?? "0");

    const userTrades = await db.select().from(trades)
      .where(eq(trades.userId, userId))
      .orderBy(desc(trades.openedAt))
      .limit(Math.min(limit, 100))
      .offset(offset);

    return c.json({
      trades: userTrades.map(t => ({
        id: t.id,
        marketId: t.marketId,
        status: t.status,
        legA: t.legA,
        legB: t.legB,
        totalCost: t.totalCost / 100, // cents → dollars
        expectedPayout: t.expectedPayout / 100,
        spreadBps: t.spreadBps,
        pnl: t.pnl != null ? t.pnl / 100 : null,
        openedAt: t.openedAt.toISOString(),
        closedAt: t.closedAt?.toISOString() ?? null,
      })),
      limit,
      offset,
    });
  });

  // GET /api/trades/:id - Single trade detail
  app.get("/:id", async (c) => {
    const userId = c.get("userId") as string;
    const tradeId = c.req.param("id");

    const [trade] = await db.select().from(trades)
      .where(eq(trades.id, tradeId))
      .limit(1);

    if (!trade || trade.userId !== userId) {
      return c.json({ error: "Trade not found" }, 404);
    }

    return c.json({
      id: trade.id,
      marketId: trade.marketId,
      status: trade.status,
      legA: trade.legA,
      legB: trade.legB,
      totalCost: trade.totalCost / 100,
      expectedPayout: trade.expectedPayout / 100,
      spreadBps: trade.spreadBps,
      pnl: trade.pnl != null ? trade.pnl / 100 : null,
      openedAt: trade.openedAt.toISOString(),
      closedAt: trade.closedAt?.toISOString() ?? null,
    });
  });

  return app;
}
