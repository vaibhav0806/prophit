import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpinionProvider } from "./providers/opinion-provider.js";
import { PredictProvider } from "./providers/predict-provider.js";
import type { MarketProvider } from "./providers/base.js";
import { detectArbitrage } from "./arbitrage/detector.js";
import { VaultClient } from "./execution/vault-client.js";
import { Executor } from "./execution/executor.js";
import { createServer } from "./api/server.js";
import { log } from "./logger.js";
import { loadState, saveState } from "./persistence.js";
import type { ArbitOpportunity, Position, AgentStatus } from "./types.js";

// --- Viem clients ---
const account = privateKeyToAccount(config.privateKey);

const chain = defineChain({
  id: config.chainId,
  name: config.chainId === 56 ? "BNB Smart Chain" : "prophit-chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl, { timeout: 10_000 }),
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(config.rpcUrl, { timeout: 10_000 }),
});

// --- Providers ---
const providerA = new MockProvider(
  publicClient,
  config.adapterAAddress,
  "MockA",
  [config.marketId],
);

const providerB = new MockProvider(
  publicClient,
  config.adapterBAddress,
  "MockB",
  [config.marketId],
);

const providers: MarketProvider[] = [providerA, providerB];

if (config.opinionAdapterAddress && config.opinionApiKey && config.opinionTokenMap) {
  const tokenMap = new Map(Object.entries(config.opinionTokenMap));
  const opinionProvider = new OpinionProvider(
    config.opinionAdapterAddress,
    config.opinionApiBase,
    config.opinionApiKey,
    Object.keys(config.opinionTokenMap).map((k) => k as `0x${string}`),
    tokenMap,
  );
  providers.push(opinionProvider);
}

if (config.predictAdapterAddress && config.predictApiKey && config.predictMarketMap) {
  const marketMap = new Map(Object.entries(config.predictMarketMap));
  const predictProvider = new PredictProvider(
    config.predictAdapterAddress,
    config.predictApiBase,
    config.predictApiKey,
    Object.keys(config.predictMarketMap).map((k) => k as `0x${string}`),
    marketMap,
  );
  providers.push(predictProvider);
}

if (config.chainId === 31337) {
  log.warn("Running on local devnet (chainId 31337). Set CHAIN_ID for production.");
}

// --- Execution ---
const vaultClient = new VaultClient(walletClient, publicClient, config.vaultAddress);
const executor = new Executor(vaultClient, config, publicClient);

// --- Agent state ---
let running = false;
let lastScan = 0;
let tradesExecuted = 0;
let opportunities: ArbitOpportunity[] = [];
let positions: Position[] = [];
let scanTimer: ReturnType<typeof setTimeout> | null = null;
const startedAt = Date.now();

// Load persisted state
const persisted = loadState();
if (persisted) {
  tradesExecuted = persisted.tradesExecuted;
  positions = persisted.positions;
  lastScan = persisted.lastScan;
  log.info("Restored persisted state", {
    tradesExecuted,
    positions: positions.length,
    lastScan,
  });
}

// Mutable config
let minSpreadBps = config.minSpreadBps;
let maxPositionSize = config.maxPositionSize;
let scanIntervalMs = config.scanIntervalMs;

// --- Scan loop ---
let scanning = false;

async function scan(): Promise<void> {
  if (!running) return;
  if (scanning) return;
  scanning = true;

  try {
    try {
      log.info("Scanning for opportunities");

      // Fetch quotes from all providers
      const allQuotes = (await Promise.all(providers.map((p) => p.fetchQuotes()))).flat();
      log.info("Fetched quotes", { count: allQuotes.length });

      // Detect arbitrage
      const detected = detectArbitrage(allQuotes);
      opportunities = detected;

      // Filter by minSpreadBps
      const actionable = detected.filter((o) => o.spreadBps >= minSpreadBps);

      if (actionable.length > 0) {
        log.info("Found opportunities above threshold", {
          count: actionable.length,
          minSpreadBps,
          bestSpreadBps: actionable[0].spreadBps,
          bestProtocolA: actionable[0].protocolA,
          bestProtocolB: actionable[0].protocolB,
        });

        try {
          await executor.executeBest(actionable[0], maxPositionSize);
          tradesExecuted++;
        } catch {
          // Already logged in executor
        }
      } else {
        log.info("No opportunities above threshold", { minSpreadBps });
      }

      // Refresh positions
      try {
        positions = await vaultClient.getAllPositions();
      } catch {
        // Vault may not have positions yet
      }

      // Close resolved positions
      try {
        const closed = await executor.closeResolved(positions);
        if (closed > 0) {
          log.info("Closed resolved positions", { count: closed });
          // Refresh positions after closing
          positions = await vaultClient.getAllPositions();
        }
      } catch (err) {
        log.error("Error closing resolved positions", { error: String(err) });
      }

      lastScan = Date.now();

      // Persist state after successful scan
      saveState({ tradesExecuted, positions, lastScan });
    } catch (err) {
      log.error("Scan error", { error: String(err) });
    }

    // Schedule next scan
    if (running) {
      scanTimer = setTimeout(scan, scanIntervalMs);
    }
  } finally {
    scanning = false;
  }
}

function startAgent(): void {
  if (running) return;
  running = true;
  log.info("Agent started");
  scan();
}

function stopAgent(): void {
  running = false;
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  log.info("Agent stopped");
}

function getStatus(): AgentStatus {
  return {
    running,
    lastScan,
    tradesExecuted,
    uptime: Date.now() - startedAt,
    config: {
      minSpreadBps,
      maxPositionSize: maxPositionSize.toString(),
      scanIntervalMs,
    },
  };
}

function getOpportunities(): ArbitOpportunity[] {
  return opportunities;
}

function getPositions(): Position[] {
  return positions;
}

function updateConfig(update: {
  minSpreadBps?: number;
  maxPositionSize?: string;
  scanIntervalMs?: number;
}): void {
  if (update.minSpreadBps !== undefined) {
    if (update.minSpreadBps < 1 || update.minSpreadBps > 10000) {
      throw new Error('minSpreadBps must be between 1 and 10000');
    }
    minSpreadBps = update.minSpreadBps;
    log.info("Updated minSpreadBps", { minSpreadBps });
  }
  if (update.maxPositionSize !== undefined) {
    const size = BigInt(update.maxPositionSize);
    if (size <= 0n) {
      throw new Error('maxPositionSize must be positive');
    }
    maxPositionSize = size;
    log.info("Updated maxPositionSize", { maxPositionSize: maxPositionSize.toString() });
  }
  if (update.scanIntervalMs !== undefined) {
    if (update.scanIntervalMs < 1000 || update.scanIntervalMs > 300000) {
      throw new Error('scanIntervalMs must be between 1000 and 300000');
    }
    scanIntervalMs = update.scanIntervalMs;
    log.info("Updated scanIntervalMs", { scanIntervalMs });
  }
}

// --- HTTP server ---
const app = createServer(
  getStatus,
  getOpportunities,
  getPositions,
  startAgent,
  stopAgent,
  updateConfig,
);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info("Server running", {
    url: `http://localhost:${info.port}`,
    vault: config.vaultAddress,
    adapterA: config.adapterAAddress,
    adapterB: config.adapterBAddress,
    marketId: config.marketId,
    minSpreadBps,
    maxPositionSize: maxPositionSize.toString(),
    scanIntervalMs,
  });

  // Auto-start the agent
  startAgent();
});

// --- Graceful shutdown ---
function shutdown() {
  log.info("Shutting down");
  running = false;
  if (scanTimer) clearTimeout(scanTimer);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
