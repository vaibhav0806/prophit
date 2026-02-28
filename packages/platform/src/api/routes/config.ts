import { Hono } from "hono";
import type { Database } from "@prophet/shared/db";
import { users, userConfigs } from "@prophet/shared/db";
import { eq } from "drizzle-orm";
import type { AuthEnv } from "../server.js";

export function createConfigRoutes(db: Database): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // GET /api/me - User profile + config (find-or-create user)
  app.get("/", async (c) => {
    const userId = c.get("userId") as string;
    const walletAddress = c.get("walletAddress") as string;

    let [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ id: userId, walletAddress })
        .returning();
    }

    const [config] = await db.select().from(userConfigs).where(eq(userConfigs.userId, userId)).limit(1);

    return c.json({
      id: user.id,
      walletAddress: user.walletAddress,
      createdAt: user.createdAt.toISOString(),
      config: config ? {
        minTradeSize: config.minTradeSize.toString(),
        maxTradeSize: config.maxTradeSize.toString(),
        minSpreadBps: config.minSpreadBps,
        maxSpreadBps: config.maxSpreadBps,
        maxTotalTrades: config.maxTotalTrades,
        tradingDurationMs: config.tradingDurationMs?.toString() ?? null,
        dailyLossLimit: config.dailyLossLimit.toString(),
        maxResolutionDays: config.maxResolutionDays,
        agentStatus: config.agentStatus,
      } : null,
    });
  });

  // PATCH /api/me/config - Update user config
  app.patch("/config", async (c) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      minTradeSize?: string;
      maxTradeSize?: string;
      minSpreadBps?: number;
      maxSpreadBps?: number;
      maxTotalTrades?: number | null;
      tradingDurationMs?: string | null;
      dailyLossLimit?: string;
      maxResolutionDays?: number | null;
    }>();

    // Find or create config
    let [config] = await db.select().from(userConfigs).where(eq(userConfigs.userId, userId)).limit(1);

    if (!config) {
      const configId = crypto.randomUUID();
      [config] = await db.insert(userConfigs).values({
        id: configId,
        userId,
      }).returning();
    }

    // Build update object
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.minTradeSize !== undefined) updates.minTradeSize = BigInt(body.minTradeSize);
    if (body.maxTradeSize !== undefined) updates.maxTradeSize = BigInt(body.maxTradeSize);
    if (body.minSpreadBps !== undefined) {
      if (body.minSpreadBps < 1 || body.minSpreadBps > 10000) {
        return c.json({ error: "minSpreadBps must be between 1 and 10000" }, 400);
      }
      updates.minSpreadBps = body.minSpreadBps;
    }
    if (body.maxSpreadBps !== undefined) {
      if (body.maxSpreadBps < 1 || body.maxSpreadBps > 10000) {
        return c.json({ error: "maxSpreadBps must be between 1 and 10000" }, 400);
      }
      updates.maxSpreadBps = body.maxSpreadBps;
    }
    if (body.maxTotalTrades !== undefined) updates.maxTotalTrades = body.maxTotalTrades;
    if (body.tradingDurationMs !== undefined) {
      updates.tradingDurationMs = body.tradingDurationMs ? BigInt(body.tradingDurationMs) : null;
    }
    if (body.dailyLossLimit !== undefined) updates.dailyLossLimit = BigInt(body.dailyLossLimit);
    if (body.maxResolutionDays !== undefined) updates.maxResolutionDays = body.maxResolutionDays;

    await db.update(userConfigs).set(updates).where(eq(userConfigs.userId, userId));

    return c.json({ ok: true });
  });

  return app;
}
