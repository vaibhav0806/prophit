import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { MockProvider } from "./providers/mock-provider.js";
import { detectArbitrage } from "./arbitrage/detector.js";
import { VaultClient } from "./execution/vault-client.js";
import { Executor } from "./execution/executor.js";
import { createServer } from "./api/server.js";
import type { ArbitOpportunity, Position, AgentStatus } from "./types.js";

// --- Viem clients ---
const account = privateKeyToAccount(config.privateKey);

const chain = defineChain({
  id: config.chainId,
  name: "prophit-chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
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

const providers = [providerA, providerB];

// --- Execution ---
const vaultClient = new VaultClient(walletClient, publicClient, config.vaultAddress);
const executor = new Executor(vaultClient, config);

// --- Agent state ---
let running = false;
let lastScan = 0;
let tradesExecuted = 0;
let opportunities: ArbitOpportunity[] = [];
let positions: Position[] = [];
let scanTimer: ReturnType<typeof setTimeout> | null = null;
const startedAt = Date.now();

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
      console.log(`[Agent] Scanning for opportunities...`);

      // Fetch quotes from all providers
      const allQuotes = (await Promise.all(providers.map((p) => p.fetchQuotes()))).flat();
      console.log(`[Agent] Fetched ${allQuotes.length} quotes`);

      // Detect arbitrage
      const detected = detectArbitrage(allQuotes);
      opportunities = detected;

      // Filter by minSpreadBps
      const actionable = detected.filter((o) => o.spreadBps >= minSpreadBps);

      if (actionable.length > 0) {
        console.log(
          `[Agent] Found ${actionable.length} opportunities above ${minSpreadBps} bps`,
        );
        console.log(
          `[Agent] Best: ${actionable[0].spreadBps} bps (${actionable[0].protocolA} vs ${actionable[0].protocolB})`,
        );

        try {
          await executor.executeBest(actionable[0], maxPositionSize);
          tradesExecuted++;
        } catch {
          // Already logged in executor
        }
      } else {
        console.log(`[Agent] No opportunities above ${minSpreadBps} bps threshold`);
      }

      // Refresh positions
      try {
        positions = await vaultClient.getAllPositions();
      } catch {
        // Vault may not have positions yet
      }

      lastScan = Date.now();
    } catch (err) {
      console.error("[Agent] Scan error:", err);
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
  console.log("[Agent] Started");
  scan();
}

function stopAgent(): void {
  running = false;
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  console.log("[Agent] Stopped");
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
    minSpreadBps = update.minSpreadBps;
    console.log(`[Agent] Updated minSpreadBps: ${minSpreadBps}`);
  }
  if (update.maxPositionSize !== undefined) {
    maxPositionSize = BigInt(update.maxPositionSize);
    console.log(`[Agent] Updated maxPositionSize: ${maxPositionSize}`);
  }
  if (update.scanIntervalMs !== undefined) {
    scanIntervalMs = update.scanIntervalMs;
    console.log(`[Agent] Updated scanIntervalMs: ${scanIntervalMs}`);
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
  console.log(`[Prophit Agent] Server running on http://localhost:${info.port}`);
  console.log(`[Prophit Agent] Vault: ${config.vaultAddress}`);
  console.log(`[Prophit Agent] Adapter A: ${config.adapterAAddress}`);
  console.log(`[Prophit Agent] Adapter B: ${config.adapterBAddress}`);
  console.log(`[Prophit Agent] Market: ${config.marketId}`);
  console.log(`[Prophit Agent] Min spread: ${minSpreadBps} bps`);
  console.log(`[Prophit Agent] Max position: ${maxPositionSize}`);
  console.log(`[Prophit Agent] Scan interval: ${scanIntervalMs}ms`);

  // Auto-start the agent
  startAgent();
});

// --- Graceful shutdown ---
function shutdown() {
  console.log("[Agent] Shutting down...");
  running = false;
  if (scanTimer) clearTimeout(scanTimer);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
