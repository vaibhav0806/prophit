import "dotenv/config";
import { serve } from "@hono/node-server";
import { createDb } from "@prophet/shared/db";
import { ScannerService } from "./scanner/service.js";
import { QuoteStore } from "./scanner/quote-store.js";
import { AgentManager } from "./agents/agent-manager.js";
import { DepositWatcher } from "./wallets/deposit-watcher.js";
import { WithdrawalProcessor } from "./wallets/withdrawal.js";
import { privyClient } from "./auth/privy.js";
import { createPlatformServer } from "./api/server.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const scannerConfig = {
  rpcUrl: requireEnv("RPC_URL"),
  chainId: Number(process.env.CHAIN_ID ?? "56"),
  predictApiBase: process.env.PREDICT_API_BASE ?? "https://api.predict.fun",
  predictApiKey: process.env.PREDICT_API_KEY ?? "",
  probableApiBase: process.env.PROBABLE_API_BASE ?? "https://api.probable.markets",
  probableEventsApiBase: process.env.PROBABLE_EVENTS_API_BASE ?? "https://market-api.probable.markets",
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS ?? "5000"),
  autoDiscover: process.env.AUTO_DISCOVER !== "false",
  disableProbable: process.env.DISABLE_PROBABLE === "true",
  opinionApiKey: process.env.OPINION_API_KEY ?? "",
  opinionApiBase: process.env.OPINION_API_BASE ?? "https://openapi.opinion.trade/openapi",
  opinionAdapterAddress: process.env.OPINION_ADAPTER_ADDRESS ?? "",
  opinionTokenMap: process.env.OPINION_TOKEN_MAP
    ? JSON.parse(process.env.OPINION_TOKEN_MAP) as Record<string, { yesTokenId: string; noTokenId: string; topicId: string }>
    : undefined,
};

const platformConfig = {
  rpcUrl: scannerConfig.rpcUrl,
  chainId: scannerConfig.chainId,
  predictApiBase: scannerConfig.predictApiBase,
  predictApiKey: scannerConfig.predictApiKey,
  probableApiBase: scannerConfig.probableApiBase,
  probableExchangeAddress: (process.env.PROBABLE_EXCHANGE_ADDRESS ?? "0xf99f5367ce708c66f0860b77b4331301a5597c86") as `0x${string}`,
  predictExchangeAddress: (process.env.PREDICT_EXCHANGE_ADDRESS ?? "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689") as `0x${string}`,
  orderExpirationSec: Number(process.env.ORDER_EXPIRATION_SEC ?? "300"),
  dryRun: process.env.DRY_RUN === "true",
  opinionApiBase: scannerConfig.opinionApiBase || undefined,
  opinionApiKey: scannerConfig.opinionApiKey || undefined,
  opinionExchangeAddress: (process.env.OPINION_EXCHANGE_ADDRESS || scannerConfig.opinionAdapterAddress || undefined) as `0x${string}` | undefined,
};

const databaseUrl = process.env.DATABASE_URL;
const db = databaseUrl ? createDb(databaseUrl) : null;

const quoteStore = new QuoteStore();
const scanner = new ScannerService(scannerConfig, quoteStore);
const agentManager = new AgentManager(quoteStore, platformConfig);

let depositWatcher: DepositWatcher | null = null;
let withdrawalProcessor: WithdrawalProcessor | null = null;

if (db) {
  depositWatcher = new DepositWatcher({
    db,
    rpcUrl: scannerConfig.rpcUrl,
    chainId: scannerConfig.chainId,
  });

  withdrawalProcessor = new WithdrawalProcessor({
    db,
    privyClient,
    chainId: scannerConfig.chainId,
  });
} else {
  console.warn("[Platform] DATABASE_URL not set — DepositWatcher and WithdrawalProcessor disabled");
}

const port = Number(process.env.PORT ?? "4000");

async function main() {
  console.log("[Platform] Initializing scanner...");
  await scanner.initialize();
  scanner.start();
  depositWatcher?.start();

  const app = createPlatformServer({
    db,
    agentManager,
    depositWatcher,
    withdrawalProcessor,
    quoteStore,
    rpcUrl: platformConfig.rpcUrl,
    chainId: platformConfig.chainId,
  });

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[Platform] Server running on http://localhost:${info.port}`);
    console.log(`[Platform] Chain ID: ${scannerConfig.chainId}`);
    console.log(`[Platform] Dry run: ${platformConfig.dryRun}`);
  });
}

main().catch((err) => {
  console.error("[Platform] Fatal error:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("[Platform] Shutting down...");
  agentManager.stopAll();
  scanner.stop();
  depositWatcher?.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Platform] Shutting down...");
  agentManager.stopAll();
  scanner.stop();
  depositWatcher?.stop();
  process.exit(0);
});

export { scanner, agentManager, quoteStore };
