import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpinionProvider } from "./providers/opinion-provider.js";
import { PredictProvider } from "./providers/predict-provider.js";
import { ProbableProvider } from "./providers/probable-provider.js";
import type { MarketProvider } from "./providers/base.js";
import { detectArbitrage } from "./arbitrage/detector.js";
import { MatchingPipeline } from "./matching/index.js";
import { VaultClient } from "./execution/vault-client.js";
import { Executor } from "./execution/executor.js";
import { createServer } from "./api/server.js";
import { log } from "./logger.js";
import { loadState, saveState } from "./persistence.js";
import type { ArbitOpportunity, MarketQuote, Position, AgentStatus } from "./types.js";
import { scorePositions } from "./yield/scorer.js";
import { allocateCapital } from "./yield/allocator.js";
import { checkRotations } from "./yield/rotator.js";
import type { YieldStatus } from "./yield/types.js";

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

if (config.probableAdapterAddress && config.probableMarketMap) {
  const marketMap = new Map(Object.entries(config.probableMarketMap));
  const probableProvider = new ProbableProvider(
    config.probableAdapterAddress,
    config.probableApiBase,
    Object.keys(config.probableMarketMap).map((k) => k as `0x${string}`),
    marketMap,
    config.probableEventsApiBase,
  );
  providers.push(probableProvider);
}

if (config.chainId === 31337) {
  log.warn("Running on local devnet (chainId 31337). Set CHAIN_ID for production.");
}

// --- AI Matching (optional) ---
const matchingPipeline = config.openaiApiKey
  ? new MatchingPipeline(
      config.openaiApiKey,
      config.matchingSimilarityThreshold,
      config.matchingConfidenceThreshold,
    )
  : null;

if (matchingPipeline) {
  log.info("AI semantic matching enabled");
} else {
  log.info("AI semantic matching disabled (no OPENAI_API_KEY)");
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
let yieldStatus: YieldStatus | null = null;
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

      // AI semantic matching: discover equivalent events across protocols
      let matchedQuotes: MarketQuote[] = allQuotes;
      if (matchingPipeline) {
        try {
          const clusters = await matchingPipeline.matchQuotes(allQuotes);
          if (clusters.length > 0) {
            // Assign a shared synthetic marketId to each verified cluster
            // so detectArbitrage can group them together
            const syntheticQuotes: MarketQuote[] = [];
            for (let ci = 0; ci < clusters.length; ci++) {
              const syntheticId = (`0x${"ee".repeat(31)}${ci.toString(16).padStart(2, "0")}`) as `0x${string}`;
              for (const q of clusters[ci].quotes) {
                syntheticQuotes.push({ ...q, marketId: syntheticId });
              }
            }
            // Include both original quotes (for exact-match) and synthetic ones (for semantic-match)
            matchedQuotes = [...allQuotes, ...syntheticQuotes];
            log.info("AI matching found verified clusters", {
              clusterCount: clusters.length,
              syntheticQuotes: syntheticQuotes.length,
            });
          }
        } catch (err) {
          log.error("AI matching failed, falling back to exact-match", { error: String(err) });
        }
      }

      // Detect arbitrage
      const detected = detectArbitrage(matchedQuotes);
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

        // LLM risk assessment (if AI matching is enabled)
        let effectiveMaxSize = maxPositionSize;
        if (matchingPipeline) {
          try {
            const risk = await matchingPipeline.assessRisk(actionable[0], allQuotes);
            const sizeMultiplier = BigInt(Math.floor(risk.recommendedSizeMultiplier * 100));
            effectiveMaxSize = (maxPositionSize * sizeMultiplier) / 100n;
            log.info("Risk-adjusted position size", {
              riskScore: risk.riskScore,
              multiplier: risk.recommendedSizeMultiplier,
              originalMax: maxPositionSize.toString(),
              adjustedMax: effectiveMaxSize.toString(),
              concerns: risk.concerns,
            });
          } catch (err) {
            log.error("Risk assessment failed, using default size", { error: String(err) });
          }
        }

        try {
          await executor.executeBest(actionable[0], effectiveMaxSize);
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

      // --- Yield rotation ---
      if (config.yieldRotationEnabled) {
        try {
          const openPositions = positions.filter((p) => !p.closed);
          const scored = scorePositions(openPositions);

          let vaultBalance = 0n;
          try {
            vaultBalance = await vaultClient.getVaultBalance();
          } catch {
            // Vault may not be available
          }

          const allocationPlan = allocateCapital(vaultBalance, opportunities, maxPositionSize);

          // Estimate gas cost for rotation check
          const gasCostEstimate = config.gasToUsdtRate * 400_000n / BigInt(1e18);
          const rotationSuggestions = checkRotations(
            scored,
            opportunities,
            gasCostEstimate,
            config.minYieldImprovementBps,
          );

          // Compute totals
          let totalDeployed = 0n;
          let weightedSum = 0;
          for (const sp of scored) {
            const cost = sp.position.costA + sp.position.costB;
            totalDeployed += cost;
            weightedSum += sp.annualizedYield * Number(cost);
          }
          const weightedAvgYield = totalDeployed > 0n ? weightedSum / Number(totalDeployed) : 0;

          yieldStatus = {
            scoredPositions: scored,
            allocationPlan,
            rotationSuggestions,
            totalDeployed: totalDeployed.toString(),
            weightedAvgYield,
          };

          if (rotationSuggestions.length > 0) {
            log.info("Yield rotation suggestions", {
              count: rotationSuggestions.length,
              bestImprovement: rotationSuggestions[0].yieldImprovement,
            });
          }
        } catch (err) {
          log.error("Yield rotation error", { error: String(err) });
        }
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

function getYieldStatus(): YieldStatus | null {
  return yieldStatus;
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
  config.yieldRotationEnabled ? getYieldStatus : undefined,
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
