import { Hono } from "hono";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import type { Database } from "@prophit/shared/db";
import { userConfigs, trades, tradingWallets } from "@prophit/shared/db";
import { eq, and, gt } from "drizzle-orm";
import type { AgentManager } from "../../agents/agent-manager.js";
import { getOrCreateWallet } from "../../wallets/privy-wallet.js";
import { createPrivyAccount } from "../../wallets/privy-account.js";
import { getOrCreateProbableProxy } from "../../wallets/safe-deployer.js";
import type { AuthEnv } from "../server.js";
import type { ClobPosition } from "@prophit/agent/src/types.js";

export function createAgentRoutes(params: {
  db: Database;
  agentManager: AgentManager;
  rpcUrl: string;
  chainId: number;
}): Hono<AuthEnv> {
  const { db, agentManager, rpcUrl, chainId } = params;
  const app = new Hono<AuthEnv>();

  // POST /api/agent/start - Start user's trading agent
  app.post("/start", async (c) => {
    const userId = c.get("userId") as string;

    // Get user config
    let [config] = await db.select().from(userConfigs).where(eq(userConfigs.userId, userId)).limit(1);

    if (!config) {
      // Create default config
      const configId = crypto.randomUUID();
      [config] = await db.insert(userConfigs).values({
        id: configId,
        userId,
      }).returning();
    }

    // Check if already running
    const existing = agentManager.getAgent(userId);
    if (existing?.isRunning()) {
      return c.json({ error: "Agent is already running" }, 409);
    }

    // Get wallet info from Privy
    const { walletId, address } = await getOrCreateWallet(userId);

    // Fetch or deploy Gnosis Safe proxy
    let safeProxyAddress: `0x${string}` | undefined;
    const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);

    if (wallet?.safeProxyAddress) {
      safeProxyAddress = wallet.safeProxyAddress as `0x${string}`;
      console.log(`[Agent] Using existing Safe proxy ${safeProxyAddress} for user ${userId}`);
    } else if (wallet) {
      try {
        console.log(`[Agent] Deploying Gnosis Safe proxy for user ${userId}...`);
        const chain = defineChain({
          id: chainId,
          name: chainId === 56 ? "BNB Smart Chain" : "prophit-chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] } },
        });
        const account = createPrivyAccount(walletId, address as `0x${string}`);
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });
        const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });

        safeProxyAddress = await getOrCreateProbableProxy(walletClient, publicClient, address as `0x${string}`, chain);

        await db.update(tradingWallets)
          .set({ safeProxyAddress })
          .where(eq(tradingWallets.userId, userId));

        console.log(`[Agent] Safe proxy deployed at ${safeProxyAddress} for user ${userId}`);
      } catch (err) {
        console.error(`[Agent] Safe deployment failed for user ${userId}:`, err);
        return c.json({ error: "Failed to deploy Safe proxy wallet" }, 500);
      }
    }

    // Seed cooldowns from recent PARTIAL trades (survive restarts)
    const COOLDOWN_MS = 30 * 60 * 1000; // must match Executor.MARKET_COOLDOWN_MS
    const initialCooldowns = new Map<string, number>();
    try {
      const cutoff = new Date(Date.now() - COOLDOWN_MS);
      const partialTrades = await db
        .select({ marketId: trades.marketId, openedAt: trades.openedAt })
        .from(trades)
        .where(and(
          eq(trades.userId, userId),
          eq(trades.status, "PARTIAL"),
          gt(trades.openedAt, cutoff),
        ));
      const now = Date.now();
      for (const t of partialTrades) {
        const elapsed = now - t.openedAt.getTime();
        const remaining = COOLDOWN_MS - elapsed;
        if (remaining > 0) {
          initialCooldowns.set(t.marketId, now + remaining);
        }
      }
      if (initialCooldowns.size > 0) {
        console.log(`[Agent] Seeded ${initialCooldowns.size} market cooldown(s) from recent PARTIAL trades`);
      }
    } catch (err) {
      console.warn("[Agent] Failed to seed cooldowns from DB, starting fresh:", err);
    }

    // Create and start agent
    try {
      const onTradeExecuted = async (trade: ClobPosition) => {
        try {
          await db.insert(trades).values({
            id: trade.id,
            userId,
            marketId: trade.marketId,
            status: trade.status,
            legA: trade.legA as any,
            legB: trade.legB as any,
            totalCost: Math.round(trade.totalCost * 100), // Store as cents
            expectedPayout: Math.round(trade.expectedPayout * 100),
            spreadBps: trade.spreadBps,
            pnl: trade.pnl != null ? Math.round(trade.pnl * 100) : null,
            openedAt: new Date(trade.openedAt),
            closedAt: trade.closedAt ? new Date(trade.closedAt) : null,
          });
          console.log(`[Agent] Trade persisted: ${trade.id} market=${trade.marketId} spread=${trade.spreadBps}bps`);
        } catch (err) {
          console.error(`[Agent] Failed to persist trade ${trade.id}:`, err);
        }
      };

      await agentManager.createAgent({
        userId,
        walletId,
        walletAddress: address as `0x${string}`,
        safeProxyAddress,
        config: {
          minTradeSize: config.minTradeSize,
          maxTradeSize: config.maxTradeSize,
          minSpreadBps: config.minSpreadBps,
          maxSpreadBps: config.maxSpreadBps,
          maxTotalTrades: config.maxTotalTrades,
          tradingDurationMs: config.tradingDurationMs,
          dailyLossLimit: config.dailyLossLimit,
          maxResolutionDays: config.maxResolutionDays,
        },
        onTradeExecuted,
        initialCooldowns,
      });

      agentManager.startAgent(userId);

      // Update DB status
      await db.update(userConfigs)
        .set({ agentStatus: "running", tradingStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(userConfigs.userId, userId));

      return c.json({ ok: true, status: "running" });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // POST /api/agent/stop - Stop user's trading agent
  app.post("/stop", async (c) => {
    const userId = c.get("userId") as string;

    agentManager.stopAgent(userId);
    agentManager.removeAgent(userId);

    await db.update(userConfigs)
      .set({ agentStatus: "stopped", updatedAt: new Date() })
      .where(eq(userConfigs.userId, userId));

    return c.json({ ok: true, status: "stopped" });
  });

  // GET /api/agent/status - Get agent running state
  app.get("/status", async (c) => {
    const userId = c.get("userId") as string;
    const agent = agentManager.getAgent(userId);

    if (!agent) {
      return c.json({ running: false, tradesExecuted: 0, pnl: 0, lastScan: 0, uptime: 0 });
    }

    const status = agent.getStatus();
    return c.json({
      running: status.running,
      tradesExecuted: status.tradesExecuted,
      lastScan: status.lastScan,
      uptime: status.uptime,
      config: status.config,
    });
  });

  return app;
}
