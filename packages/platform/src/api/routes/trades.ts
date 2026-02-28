import { Hono } from "hono";
import type { Database } from "@prophet/shared/db";
import { trades, markets } from "@prophet/shared/db";
import { eq, desc } from "drizzle-orm";
import type { AuthEnv } from "../server.js";

function computePnl(t: { status: string; totalCost: number; expectedPayout: number; pnl: number | null }): number | null {
  if (t.status === "FILLED" || t.status === "CLOSED") {
    return (t.expectedPayout - t.totalCost) / 100;
  }
  return t.pnl != null ? t.pnl / 100 : null;
}

function mapTradeRow(
  t: typeof trades.$inferSelect,
  m: { title: string | null; category: string | null; resolvesAt: Date | null } | null,
) {
  return {
    id: t.id,
    marketId: t.marketId,
    status: t.status,
    legA: t.legA,
    legB: t.legB,
    totalCost: t.totalCost / 100, // cents → dollars
    expectedPayout: t.expectedPayout / 100,
    spreadBps: t.spreadBps,
    pnl: computePnl(t),
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
    marketTitle: m?.title ?? null,
    marketCategory: m?.category ?? null,
    resolvesAt: m?.resolvesAt?.toISOString() ?? null,
  };
}

export function createTradeRoutes(db: Database): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // GET /api/trades - User's trade history
  app.get("/", async (c) => {
    const userId = c.get("userId") as string;
    const limit = Number(c.req.query("limit") ?? "50");
    const offset = Number(c.req.query("offset") ?? "0");

    const rows = await db.select({
      trade: trades,
      market: {
        title: markets.title,
        category: markets.category,
        resolvesAt: markets.resolvesAt,
      },
    }).from(trades)
      .leftJoin(markets, eq(trades.marketId, markets.conditionId))
      .where(eq(trades.userId, userId))
      .orderBy(desc(trades.openedAt))
      .limit(Math.min(limit, 100))
      .offset(offset);

    return c.json({
      trades: rows.map(({ trade, market }) => mapTradeRow(trade, market)),
      limit,
      offset,
    });
  });

  // GET /api/trades/:id - Single trade detail
  app.get("/:id", async (c) => {
    const userId = c.get("userId") as string;
    const tradeId = c.req.param("id");

    const [row] = await db.select({
      trade: trades,
      market: {
        title: markets.title,
        category: markets.category,
        resolvesAt: markets.resolvesAt,
      },
    }).from(trades)
      .leftJoin(markets, eq(trades.marketId, markets.conditionId))
      .where(eq(trades.id, tradeId))
      .limit(1);

    if (!row || row.trade.userId !== userId) {
      return c.json({ error: "Trade not found" }, 404);
    }

    return c.json(mapTradeRow(row.trade, row.market));
  });

  return app;
}
