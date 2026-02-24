import { createPublicClient, createWalletClient, defineChain, http, formatUnits } from "viem";
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
import { ProbableClobClient } from "./clob/probable-client.js";
import { PredictClobClient } from "./clob/predict-client.js";
import type { ClobClient } from "./clob/types.js";
import { createServer } from "./api/server.js";
import { log } from "./logger.js";
import { loadState, saveState } from "./persistence.js";
import type { ArbitOpportunity, MarketQuote, Position, ClobPosition, AgentStatus } from "./types.js";
import { scorePositions } from "./yield/scorer.js";
import { allocateCapital } from "./yield/allocator.js";
import { checkRotations } from "./yield/rotator.js";
import type { YieldStatus } from "./yield/types.js";

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// --- Dedup prevention ---
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const recentTrades = new Map<string, number>();

function opportunityHash(opp: ArbitOpportunity): string {
  return `${opp.marketId}-${opp.protocolA}-${opp.protocolB}-${opp.buyYesOnA}`;
}

function isRecentlyTraded(opp: ArbitOpportunity): boolean {
  const hash = opportunityHash(opp);
  const lastTrade = recentTrades.get(hash);
  return !!(lastTrade && Date.now() - lastTrade < DEDUP_WINDOW_MS);
}

function recordTrade(opp: ArbitOpportunity): void {
  recentTrades.set(opportunityHash(opp), Date.now());
  for (const [key, ts] of recentTrades) {
    if (Date.now() - ts > DEDUP_WINDOW_MS) recentTrades.delete(key);
  }
}

// --- Daily loss limit ---
let dailyStartBalance: bigint | null = null;
let dailyLossResetAt = Date.now() + 24 * 60 * 60 * 1000;

function checkDailyLoss(currentBalance: bigint): boolean {
  if (Date.now() > dailyLossResetAt) {
    dailyStartBalance = currentBalance;
    dailyLossResetAt = Date.now() + 24 * 60 * 60 * 1000;
    log.info("Daily loss counter reset", { balance: currentBalance.toString() });
  }
  if (dailyStartBalance === null) {
    dailyStartBalance = currentBalance;
  }
  if (dailyStartBalance > currentBalance) {
    const loss = dailyStartBalance - currentBalance;
    if (loss >= config.dailyLossLimit) return false;
  }
  return true;
}

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
const providers: MarketProvider[] = [];

if (config.chainId === 31337) {
  const providerA = new MockProvider(publicClient, config.adapterAAddress, "MockA", [config.marketId]);
  const providerB = new MockProvider(publicClient, config.adapterBAddress, "MockB", [config.marketId]);
  providers.push(providerA, providerB);
  log.info("Mock providers enabled", { chainId: config.chainId });
} else if (process.env.USE_MOCK_PROVIDERS === "true") {
  log.warn("USE_MOCK_PROVIDERS ignored — mock providers are only allowed on chainId 31337");
}

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

// --- Agent state (loaded early so CLOB init can reference persisted nonces) ---
let running = false;
let lastScan = 0;
let tradesExecuted = 0;
let opportunities: ArbitOpportunity[] = [];
let positions: Position[] = [];
let clobPositions: ClobPosition[] = [];
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let yieldStatus: YieldStatus | null = null;
const startedAt = Date.now();

// Load persisted state
const persisted = loadState();
if (persisted) {
  tradesExecuted = persisted.tradesExecuted;
  positions = persisted.positions;
  clobPositions = persisted.clobPositions ?? [];
  lastScan = persisted.lastScan;
  log.info("Restored persisted state", {
    tradesExecuted,
    positions: positions.length,
    clobPositions: clobPositions.length,
    lastScan,
  });
}

// --- CLOB clients (when executionMode=clob) ---
let probableClobClient: ProbableClobClient | undefined;
let predictClobClient: PredictClobClient | undefined;
let clobInitPromise: Promise<void> | undefined;

if (config.executionMode === "clob") {
  log.info("CLOB execution mode enabled");

  probableClobClient = new ProbableClobClient({
    walletClient,
    apiBase: config.probableApiBase,
    exchangeAddress: config.probableExchangeAddress,
    chainId: config.chainId,
    expirationSec: config.orderExpirationSec,
    dryRun: config.dryRun,
  });

  if (config.predictApiKey) {
    predictClobClient = new PredictClobClient({
      walletClient,
      apiBase: config.predictApiBase,
      apiKey: config.predictApiKey,
      exchangeAddress: config.predictExchangeAddress,
      chainId: config.chainId,
      expirationSec: config.orderExpirationSec,
      dryRun: config.dryRun,
    });
  }

  // Initialize CLOB clients (auth + nonce)
  clobInitPromise = (async () => {
    try {
      await probableClobClient!.authenticate();
      await probableClobClient!.fetchNonce();
      if (predictClobClient) {
        await predictClobClient.authenticate();
        await predictClobClient.fetchNonce();
      }
      // Restore persisted nonces (must happen after auth/fetchNonce)
      if (persisted?.clobNonces) {
        if (persisted.clobNonces.Probable) {
          probableClobClient!.setNonce(BigInt(persisted.clobNonces.Probable));
          log.info("Restored Probable nonce", { nonce: persisted.clobNonces.Probable });
        }
        if (predictClobClient && persisted.clobNonces.Predict) {
          predictClobClient.setNonce(BigInt(persisted.clobNonces.Predict));
          log.info("Restored Predict nonce", { nonce: persisted.clobNonces.Predict });
        }
      }
      // Check approvals
      await probableClobClient!.ensureApprovals(publicClient);
      if (predictClobClient) await predictClobClient.ensureApprovals(publicClient);
      log.info("CLOB clients initialized");
    } catch (err) {
      log.error("CLOB client init failed", { error: String(err) });
    }
  })();
} else {
  log.info("Vault execution mode (default)");
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

// Build meta resolvers map for CLOB mode
const metaResolvers = new Map<string, { getMarketMeta: (id: `0x${string}`) => import("./types.js").MarketMeta | undefined }>();
for (const p of providers) {
  if ("getMarketMeta" in p && typeof (p as any).getMarketMeta === "function") {
    metaResolvers.set(p.name, p as any);
  }
}

const executor = new Executor(
  vaultClient,
  config,
  publicClient,
  { probable: probableClobClient, predict: predictClobClient },
  metaResolvers,
  walletClient,
);

// --- Graceful shutdown flag ---
let shuttingDown = false;

// Mutable config
let minSpreadBps = config.minSpreadBps;
let maxPositionSize = config.maxPositionSize;
let scanIntervalMs = config.scanIntervalMs;

// --- CLOB nonce collection for persistence ---
function collectClobNonces(): Record<string, string> | undefined {
  if (!probableClobClient && !predictClobClient) return undefined;
  const nonces: Record<string, string> = {};
  if (probableClobClient) nonces.Probable = probableClobClient.getNonce().toString();
  if (predictClobClient) nonces.Predict = predictClobClient.getNonce().toString();
  return nonces;
}

// --- Scan loop ---
let scanning = false;

async function scan(): Promise<void> {
  if (shuttingDown) return;
  if (!running) return;
  if (scanning) return;
  scanning = true;

  try {
    if (clobInitPromise) await clobInitPromise;

    try {
      log.info("Scanning for opportunities");

      // Fetch quotes from all providers
      const results = await Promise.allSettled(providers.map((p) => p.fetchQuotes()));
      const allQuotes = results
        .filter((r): r is PromiseFulfilledResult<MarketQuote[]> => r.status === "fulfilled")
        .flatMap((r) => r.value);
      const failedProviders = results
        .map((r, i) => r.status === "rejected" ? providers[i].name : null)
        .filter(Boolean);
      if (failedProviders.length > 0) {
        log.warn("Some providers failed", { failed: failedProviders });
      }
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
      const fresh = actionable.filter((o) => !isRecentlyTraded(o));

      // Daily loss limit check — use EOA balance in CLOB mode, vault balance in vault mode
      let balanceForLossCheck = 0n;
      if (config.executionMode === "clob") {
        try {
          const usdtBalance = await publicClient.readContract({
            address: BSC_USDT,
            abi: erc20BalanceOfAbi,
            functionName: "balanceOf",
            args: [account.address],
          });
          // BSC USDT is 18 decimals, dailyLossLimit is 6 decimals
          balanceForLossCheck = usdtBalance / BigInt(1e12);
        } catch { /* balance check may fail */ }
      } else {
        try { balanceForLossCheck = await vaultClient.getVaultBalance(); } catch { /* vault may not be available */ }
      }
      const withinLossLimit = checkDailyLoss(balanceForLossCheck);
      if (!withinLossLimit) {
        log.warn("Daily loss limit reached, skipping execution", {
          startBalance: dailyStartBalance?.toString(),
          currentBalance: balanceForLossCheck.toString(),
          limit: config.dailyLossLimit.toString(),
        });
      }

      if (fresh.length > 0 && withinLossLimit) {
        log.info("Found opportunities above threshold", {
          count: fresh.length,
          minSpreadBps,
          bestSpreadBps: fresh[0].spreadBps,
          bestProtocolA: fresh[0].protocolA,
          bestProtocolB: fresh[0].protocolB,
        });

        // LLM risk assessment (if AI matching is enabled)
        let effectiveMaxSize = maxPositionSize;
        if (matchingPipeline) {
          try {
            const risk = await matchingPipeline.assessRisk(fresh[0], allQuotes);
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
          const result = await executor.executeBest(fresh[0], effectiveMaxSize);
          tradesExecuted++;
          recordTrade(fresh[0]);
          // Track CLOB positions
          if (result && config.executionMode === "clob") {
            clobPositions.push(result);
          }
        } catch {
          // Already logged in executor
        }
      } else if (fresh.length === 0) {
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

      // Close resolved CLOB positions
      if (config.executionMode === "clob" && clobPositions.length > 0) {
        try {
          const closedClob = await executor.closeResolvedClob(clobPositions);
          if (closedClob > 0) {
            log.info("Closed resolved CLOB positions", { count: closedClob });
          }
        } catch (err) {
          log.error("Error closing resolved CLOB positions", { error: String(err) });
        }
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
      saveState({ tradesExecuted, positions, clobPositions, lastScan, clobNonces: collectClobNonces() });
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
      executionMode: config.executionMode,
    },
  };
}

function getClobPositions(): ClobPosition[] {
  return clobPositions;
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
  getClobPositions,
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
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Shutting down gracefully...");

  running = false;
  if (scanTimer) clearTimeout(scanTimer);

  // Cancel open CLOB orders
  if (config.executionMode === "clob") {
    const clients: Array<{ name: string; client: ClobClient }> = [];
    if (probableClobClient) clients.push({ name: "Probable", client: probableClobClient });
    if (predictClobClient) clients.push({ name: "Predict", client: predictClobClient });

    for (const { name, client } of clients) {
      try {
        const openOrders = await client.getOpenOrders();
        for (const order of openOrders) {
          try {
            await client.cancelOrder(order.orderId, order.tokenId);
            log.info("Cancelled order on shutdown", { name, orderId: order.orderId });
          } catch (err) {
            log.error("Failed to cancel order on shutdown", { name, orderId: order.orderId, error: String(err) });
          }
        }
      } catch (err) {
        log.error("Failed to fetch open orders on shutdown", { name, error: String(err) });
      }
    }
  }

  // Flush state to disk
  saveState({ tradesExecuted, positions, clobPositions, lastScan, clobNonces: collectClobNonces() });
  log.info("State flushed to disk");

  process.exit(0);
}

process.on("SIGINT", () => { shutdown(); });
process.on("SIGTERM", () => { shutdown(); });
