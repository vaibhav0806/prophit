import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuthMiddleware } from "../auth/middleware.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createWalletRoutes } from "./routes/wallet.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createMarketRoutes } from "./routes/markets.js";
import { createTradeRoutes } from "./routes/trades.js";
import { createConfigRoutes } from "./routes/config.js";
import { rateLimit } from "./middleware/rate-limit.js";
import type { Database } from "@prophet/shared/db";
import type { AgentManager } from "../agents/agent-manager.js";
import type { DepositWatcher } from "../wallets/deposit-watcher.js";
import type { WithdrawalProcessor } from "../wallets/withdrawal.js";
import type { QuoteStore } from "../scanner/quote-store.js";
import type { Context, Next } from "hono";

export type AuthEnv = {
  Variables: {
    userId: string;
    walletAddress: string;
  };
};

export interface ServerDeps {
  db: Database | null;
  agentManager: AgentManager;
  depositWatcher: DepositWatcher | null;
  withdrawalProcessor: WithdrawalProcessor | null;
  quoteStore: QuoteStore;
  rpcUrl: string;
  chainId: number;
}

export function createPlatformServer(deps: ServerDeps): Hono {
  const app = new Hono();

  // Request logger
  app.use("*", requestLogger);

  // CORS — restrict in production
  const isProd = process.env.NODE_ENV === "production";
  const corsOrigin = isProd
    ? (process.env.CORS_ORIGIN ?? "https://prophet.fun")
    : "*";
  app.use("*", cors({ origin: corsOrigin }));

  // Rate limiting — auth endpoints (10 req/min per IP)
  app.use("/api/auth/*", rateLimit({ limit: 10, windowMs: 60_000 }));

  // Rate limiting — general API (60 req/min per IP), skip health
  app.use("/api/*", rateLimit({
    limit: 60,
    windowMs: 60_000,
    keyFn: (c) => {
      if (c.req.path === "/api/health") return null; // no limit
      return (
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown"
      );
    },
  }));

  // Public routes (no auth)
  app.route("/api/markets", createMarketRoutes(deps.quoteStore));

  // Health check
  app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

  // DB-dependent routes
  if (deps.db) {
    const db = deps.db;
    app.route("/api/auth", createAuthRoutes(db));

    // Protected routes (require auth: Privy Bearer token or Bot secret)
    const protectedRoutes = new Hono();
    protectedRoutes.use("*", createAuthMiddleware(db));

    // Rate limiting — withdrawal endpoint (5 req/min per user)
    protectedRoutes.use("/api/wallet/withdraw", rateLimit({
      limit: 5,
      windowMs: 60_000,
      keyFn: (c) => {
        if (c.req.method !== "POST") return null;
        return `withdraw:${c.get("userId")}`;
      },
    }));

    protectedRoutes.route("/api/wallet", createWalletRoutes({
      db,
      depositWatcher: deps.depositWatcher!,
      withdrawalProcessor: deps.withdrawalProcessor!,
    }));
    protectedRoutes.route("/api/agent", createAgentRoutes({
      db,
      agentManager: deps.agentManager,
      rpcUrl: deps.rpcUrl,
      chainId: deps.chainId,
    }));
    protectedRoutes.route("/api/trades", createTradeRoutes(db));
    protectedRoutes.route("/api/me", createConfigRoutes(db));

    app.route("/", protectedRoutes);
  }

  return app;
}

// Simple request logger middleware
async function requestLogger(c: Context, next: Next): Promise<void> {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(
    `[Platform] ${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`,
  );
}
