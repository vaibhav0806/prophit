import { createPublicClient, createWalletClient, defineChain, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpinionProvider } from "./providers/opinion-provider.js";
import { PredictProvider } from "./providers/predict-provider.js";
import { ProbableProvider } from "./providers/probable-provider.js";
import type { MarketProvider } from "./providers/base.js";
import { MatchingPipeline } from "./matching/index.js";
import { VaultClient } from "./execution/vault-client.js";
import { Executor } from "./execution/executor.js";
import { ProbableClobClient } from "./clob/probable-client.js";
import { PredictClobClient } from "./clob/predict-client.js";
import { OpinionClobClient } from "./clob/opinion-client.js";
import type { ClobClient } from "./clob/types.js";
import { createServer } from "./api/server.js";
import { log } from "./logger.js";
import { loadState, saveState } from "./persistence.js";
import type { MarketQuote } from "./types.js";
import { AgentInstance } from "./agent-instance.js";
import type { QuoteStore } from "./agent-instance.js";
import { runDiscovery } from "./discovery/pipeline.js";

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

// --- Startup balance validation ---
async function validateStartupBalances(): Promise<void> {
  try {
    const bnbBalance = await publicClient.getBalance({ address: account.address });
    if (bnbBalance === 0n) {
      log.error("STARTUP CHECK: EOA BNB balance is 0 — transactions will fail", { eoa: account.address });
    } else if (bnbBalance < 10n ** 16n) { // < 0.01 BNB
      log.warn("STARTUP CHECK: EOA BNB balance is low", {
        eoa: account.address,
        balance: formatUnits(bnbBalance, 18),
      });
    } else {
      log.info("STARTUP CHECK: EOA BNB balance OK", {
        eoa: account.address,
        balance: formatUnits(bnbBalance, 18),
      });
    }
  } catch (err) {
    log.warn("STARTUP CHECK: failed to check BNB balance", { error: String(err) });
  }

  try {
    const eoaUsdt = await publicClient.readContract({
      address: BSC_USDT,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (eoaUsdt === 0n) {
      log.warn("STARTUP CHECK: EOA USDT balance is 0", { eoa: account.address });
    } else {
      log.info("STARTUP CHECK: EOA USDT balance", {
        eoa: account.address,
        balance: formatUnits(eoaUsdt, 18),
      });
    }
  } catch (err) {
    log.warn("STARTUP CHECK: failed to check EOA USDT balance", { error: String(err) });
  }

  if (config.probableProxyAddress) {
    try {
      const safeUsdt = await publicClient.readContract({
        address: BSC_USDT,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [config.probableProxyAddress],
      });
      if (safeUsdt === 0n) {
        log.warn("STARTUP CHECK: Safe USDT balance is 0", { safe: config.probableProxyAddress });
      } else {
        log.info("STARTUP CHECK: Safe USDT balance", {
          safe: config.probableProxyAddress,
          balance: formatUnits(safeUsdt, 18),
        });
      }
    } catch (err) {
      log.warn("STARTUP CHECK: failed to check Safe USDT balance", { error: String(err) });
    }
  }
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
const DUMMY_ADAPTER = "0x0000000000000000000000000000000000000001" as `0x${string}`;

if (config.chainId === 31337 && config.adapterAAddress && config.adapterBAddress && config.marketId) {
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

// Market maps — start from env, merge with auto-discovery if enabled
let predictMarketMap = config.predictMarketMap ?? {} as Record<string, { predictMarketId: string; yesTokenId: string; noTokenId: string }>;
let probableMarketMap = config.probableMarketMap ?? {} as Record<string, { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string }>;

// Auto-discovery: fetch all markets from both platforms and match cross-protocol
if (config.autoDiscover && config.predictApiKey) {
  try {
    log.info("Auto-discovery starting...");
    const result = await runDiscovery({
      probableEventsApiBase: config.probableEventsApiBase,
      predictApiBase: config.predictApiBase,
      predictApiKey: config.predictApiKey,
    });
    // Discovered maps as base, env maps override (env entries take precedence)
    predictMarketMap = { ...result.predictMarketMap, ...predictMarketMap };
    probableMarketMap = { ...result.probableMarketMap, ...probableMarketMap };
    log.info("Auto-discovery complete", {
      matches: result.matches.length,
      probableMarkets: Object.keys(probableMarketMap).length,
      predictMarkets: Object.keys(predictMarketMap).length,
    });
  } catch (err) {
    log.error("Auto-discovery failed, using env maps only", { error: String(err) });
  }
}

if (config.predictApiKey && Object.keys(predictMarketMap).length > 0) {
  const marketMap = new Map(Object.entries(predictMarketMap));
  const predictProvider = new PredictProvider(
    config.predictAdapterAddress || DUMMY_ADAPTER,
    config.predictApiBase,
    config.predictApiKey,
    Object.keys(predictMarketMap).map((k) => k as `0x${string}`),
    marketMap,
  );
  providers.push(predictProvider);
  log.info("Predict provider enabled", { markets: Object.keys(predictMarketMap).length });
}

if (Object.keys(probableMarketMap).length > 0 && !config.disableProbable) {
  const marketMap = new Map(Object.entries(probableMarketMap));
  const probableProvider = new ProbableProvider(
    config.probableAdapterAddress || DUMMY_ADAPTER,
    config.probableApiBase,
    Object.keys(probableMarketMap).map((k) => k as `0x${string}`),
    marketMap,
    config.probableEventsApiBase,
  );
  providers.push(probableProvider);
  log.info("Probable provider enabled", { markets: Object.keys(probableMarketMap).length });
}

if (config.chainId === 31337) {
  log.warn("Running on local devnet (chainId 31337). Set CHAIN_ID for production.");
}

// --- Load persisted state (early so CLOB init can reference persisted nonces) ---
const persisted = loadState();
if (persisted) {
  log.info("Restored persisted state", {
    tradesExecuted: persisted.tradesExecuted,
    positions: persisted.positions.length,
    clobPositions: (persisted.clobPositions ?? []).length,
    lastScan: persisted.lastScan,
  });
}

// --- CLOB clients (when executionMode=clob) ---
let probableClobClient: ProbableClobClient | undefined;
let predictClobClient: PredictClobClient | undefined;
let opinionClobClient: OpinionClobClient | undefined;
let clobInitPromise: Promise<void> | undefined;

if (config.executionMode === "clob") {
  log.info("CLOB execution mode enabled");

  if (!config.disableProbable) {
    probableClobClient = new ProbableClobClient({
      walletClient,
      apiBase: config.probableApiBase,
      exchangeAddress: config.probableExchangeAddress,
      chainId: config.chainId,
      expirationSec: config.orderExpirationSec,
      dryRun: config.dryRun,
      proxyAddress: config.probableProxyAddress,
    });
  } else {
    log.info("Probable CLOB disabled via DISABLE_PROBABLE");
  }

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

  if (config.opinionApiKey) {
    opinionClobClient = new OpinionClobClient({
      walletClient,
      apiBase: config.opinionApiBase,
      apiKey: config.opinionApiKey,
      exchangeAddress: config.opinionExchangeAddress as `0x${string}`,
      chainId: config.chainId,
      expirationSec: config.orderExpirationSec,
      dryRun: config.dryRun,
    });
  }

  // Initialize CLOB clients (auth + nonce)
  clobInitPromise = (async () => {
    try {
      if (probableClobClient) {
        await probableClobClient.authenticate();
        await probableClobClient.fetchNonce();
      }
      if (predictClobClient) {
        await predictClobClient.authenticate();
        await predictClobClient.fetchNonce();
      }
      if (opinionClobClient) {
        await opinionClobClient.authenticate();
        await opinionClobClient.fetchNonce();
      }
      // Restore persisted nonces (must happen after auth/fetchNonce)
      if (persisted?.clobNonces) {
        if (probableClobClient && persisted.clobNonces.Probable) {
          probableClobClient.setNonce(BigInt(persisted.clobNonces.Probable));
          log.info("Restored Probable nonce", { nonce: persisted.clobNonces.Probable });
        }
        if (predictClobClient && persisted.clobNonces.Predict) {
          predictClobClient.setNonce(BigInt(persisted.clobNonces.Predict));
          log.info("Restored Predict nonce", { nonce: persisted.clobNonces.Predict });
        }
        if (opinionClobClient && persisted.clobNonces.Opinion) {
          opinionClobClient.setNonce(BigInt(persisted.clobNonces.Opinion));
          log.info("Restored Opinion nonce", { nonce: persisted.clobNonces.Opinion });
        }
      }
      // Check approvals
      if (probableClobClient) await probableClobClient.ensureApprovals(publicClient, config.maxPositionSize);
      if (predictClobClient) await predictClobClient.ensureApprovals(publicClient);
      if (opinionClobClient) await opinionClobClient.ensureApprovals(publicClient);
      // Startup balance checks
      await validateStartupBalances();
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
const vaultClient = config.executionMode === "vault" && config.vaultAddress
  ? new VaultClient(walletClient, publicClient, config.vaultAddress)
  : null;

// Build meta resolvers map for CLOB mode
const metaResolvers = new Map<string, { getMarketMeta: (id: `0x${string}`) => import("./types.js").MarketMeta | undefined }>();
for (const p of providers) {
  if ("getMarketMeta" in p && typeof (p as any).getMarketMeta === "function") {
    metaResolvers.set(p.name, p as any);
  }
}

const executor = new Executor(
  vaultClient ?? undefined,
  config,
  publicClient,
  { probable: probableClobClient, predict: predictClobClient, opinion: opinionClobClient, probableProxyAddress: config.probableProxyAddress },
  metaResolvers,
  walletClient,
);

// --- CLOB nonce collection for persistence ---
function collectClobNonces(): Record<string, string> | undefined {
  if (!probableClobClient && !predictClobClient && !opinionClobClient) return undefined;
  const nonces: Record<string, string> = {};
  if (probableClobClient) nonces.Probable = probableClobClient.getNonce().toString();
  if (predictClobClient) nonces.Predict = predictClobClient.getNonce().toString();
  if (opinionClobClient) nonces.Opinion = opinionClobClient.getNonce().toString();
  return nonces;
}

// --- QuoteStore adapter: wraps providers for AgentInstance ---
const providerQuoteStore: QuoteStore = {
  async getLatestQuotes(): Promise<MarketQuote[]> {
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
    return allQuotes;
  },
};

// --- Balance checker for daily loss limit ---
async function getBalanceForLossCheck(): Promise<bigint> {
  if (config.executionMode === "clob") {
    try {
      const usdtBalance = await publicClient.readContract({
        address: BSC_USDT,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [account.address],
      });
      // BSC USDT is 18 decimals, dailyLossLimit is 6 decimals
      return usdtBalance / BigInt(1e12);
    } catch (err) {
      log.error("CLOB balance check failed — skipping execution this scan", { error: String(err) });
      return -1n; // sentinel: will fail loss check
    }
  } else if (vaultClient) {
    try { return await vaultClient.getVaultBalance(); } catch { /* vault may not be available */ }
  }
  return 0n;
}

// --- Create AgentInstance ---
const agent = new AgentInstance({
  userId: "self-hosted",
  walletClient,
  publicClient,
  config: {
    minSpreadBps: config.minSpreadBps,
    maxPositionSize: config.maxPositionSize,
    scanIntervalMs: config.scanIntervalMs,
    executionMode: config.executionMode,
    dailyLossLimit: config.dailyLossLimit,
    dryRun: config.dryRun,
    yieldRotationEnabled: config.yieldRotationEnabled,
    gasToUsdtRate: config.gasToUsdtRate,
    minYieldImprovementBps: config.minYieldImprovementBps,
  },
  quoteStore: providerQuoteStore,
  executor,
  clobClients: {
    probable: probableClobClient,
    predict: predictClobClient,
    opinion: opinionClobClient,
    probableProxyAddress: config.probableProxyAddress,
  },
  vaultClient: vaultClient ?? undefined,
  matchingPipeline,
  collectClobNonces,
  getBalanceForLossCheck,
  clobInitPromise,
  initialState: persisted ? {
    tradesExecuted: persisted.tradesExecuted,
    positions: persisted.positions,
    clobPositions: persisted.clobPositions ?? [],
    lastScan: persisted.lastScan,
  } : undefined,
  onStateChanged: (state) => {
    saveState({
      tradesExecuted: state.tradesExecuted,
      positions: state.positions,
      clobPositions: state.clobPositions,
      lastScan: state.lastScan,
      clobNonces: collectClobNonces(),
    });
  },
});

// --- Graceful shutdown flag ---
let shuttingDown = false;

// --- HTTP server ---
const app = createServer(
  () => agent.getStatus(),
  () => agent.getOpportunities(),
  () => agent.getPositions(),
  () => agent.start(),
  () => agent.stop(),
  (update) => agent.updateConfig(update),
  config.yieldRotationEnabled ? () => agent.getYieldStatus() : undefined,
  () => agent.getClobPositions(),
);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info("Server running", {
    url: `http://localhost:${info.port}`,
    executionMode: config.executionMode,
    ...(config.vaultAddress ? { vault: config.vaultAddress } : {}),
    minSpreadBps: config.minSpreadBps,
    maxPositionSize: config.maxPositionSize.toString(),
    scanIntervalMs: config.scanIntervalMs,
  });

  // Auto-start the agent
  agent.start();
});

// --- Graceful shutdown ---
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Shutting down gracefully...");

  // Force exit after 30s if graceful shutdown hangs
  const forceExitTimer = setTimeout(() => {
    log.error("Graceful shutdown timed out after 30s — forcing exit");
    process.exit(1);
  }, 30_000);
  forceExitTimer.unref(); // Don't keep process alive just for this timer

  agent.stop();

  // Cancel open CLOB orders
  if (config.executionMode === "clob") {
    const clients: Array<{ name: string; client: ClobClient }> = [];
    if (probableClobClient) clients.push({ name: "Probable", client: probableClobClient });
    if (predictClobClient) clients.push({ name: "Predict", client: predictClobClient });
    if (opinionClobClient) clients.push({ name: "Opinion", client: opinionClobClient });

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
  saveState({
    tradesExecuted: agent.getStatus().tradesExecuted,
    positions: agent.getPositions(),
    clobPositions: agent.getClobPositions(),
    lastScan: agent.getStatus().lastScan,
    clobNonces: collectClobNonces(),
  });
  log.info("State flushed to disk");

  process.exit(0);
}

process.on("SIGINT", () => { shutdown(); });
process.on("SIGTERM", () => { shutdown(); });
