import "dotenv/config";
import { log } from "./logger.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requireAddress(name: string): `0x${string}` {
  const value = requireEnv(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid address for ${name}: ${value}`);
  }
  return value as `0x${string}`;
}

function requireHex(name: string): `0x${string}` {
  const value = requireEnv(name);
  if (!value.startsWith("0x")) {
    throw new Error(`Invalid hex for ${name}: ${value}`);
  }
  return value as `0x${string}`;
}

const executionMode = (process.env.EXECUTION_MODE || "vault") as "vault" | "clob";

export const config = {
  rpcUrl: requireEnv("RPC_URL"),
  privateKey: requireHex("PRIVATE_KEY") as `0x${string}`,
  // Vault-mode only — optional when EXECUTION_MODE=clob
  vaultAddress: executionMode === "vault" ? requireAddress("VAULT_ADDRESS") : (process.env.VAULT_ADDRESS ?? undefined) as `0x${string}` | undefined,
  adapterAAddress: executionMode === "vault" ? requireAddress("ADAPTER_A_ADDRESS") : (process.env.ADAPTER_A_ADDRESS ?? undefined) as `0x${string}` | undefined,
  adapterBAddress: executionMode === "vault" ? requireAddress("ADAPTER_B_ADDRESS") : (process.env.ADAPTER_B_ADDRESS ?? undefined) as `0x${string}` | undefined,
  usdtAddress: executionMode === "vault" ? requireAddress("USDT_ADDRESS") : (process.env.USDT_ADDRESS ?? "0x55d398326f99059fF775485246999027B3197955") as `0x${string}`,
  marketId: executionMode === "vault" ? requireHex("MARKET_ID") as `0x${string}` : (process.env.MARKET_ID ?? undefined) as `0x${string}` | undefined,
  minSpreadBps: Number(process.env.MIN_SPREAD_BPS ?? "100"),
  maxPositionSize: BigInt(process.env.MAX_POSITION_SIZE ?? "500000000"),
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS ?? "5000"),
  gasToUsdtRate: BigInt(process.env.GAS_TO_USDT_RATE || "3000000000"), // default $3000 ETH in 6-dec USDT
  chainId: Number(process.env.CHAIN_ID || "31337"),
  port: Number(process.env.PORT ?? "3001"),
  apiKey: process.env.API_KEY ?? "",
  opinionAdapterAddress: (process.env.OPINION_ADAPTER_ADDRESS || undefined) as `0x${string}` | undefined,
  opinionApiBase: process.env.OPINION_API_BASE || "https://openapi.opinion.trade/openapi",
  opinionApiKey: process.env.OPINION_API_KEY || "",
  opinionTokenMap: process.env.OPINION_TOKEN_MAP
    ? JSON.parse(process.env.OPINION_TOKEN_MAP) as Record<string, { yesTokenId: string; noTokenId: string; topicId: string }>
    : undefined,
  predictAdapterAddress: (process.env.PREDICT_ADAPTER_ADDRESS || undefined) as `0x${string}` | undefined,
  predictApiBase: process.env.PREDICT_API_BASE || "https://api.predict.fun",
  predictApiKey: process.env.PREDICT_API_KEY || "",
  predictMarketMap: process.env.PREDICT_MARKET_MAP
    ? JSON.parse(process.env.PREDICT_MARKET_MAP) as Record<string, { predictMarketId: string; yesTokenId: string; noTokenId: string }>
    : undefined,
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  matchingSimilarityThreshold: Number(process.env.MATCHING_SIMILARITY_THRESHOLD || "0.85"),
  matchingConfidenceThreshold: Number(process.env.MATCHING_CONFIDENCE_THRESHOLD || "0.90"),
  yieldRotationEnabled: process.env.YIELD_ROTATION_ENABLED === "true",
  minYieldImprovementBps: Number(process.env.MIN_YIELD_IMPROVEMENT_BPS ?? "200"),
  dailyLossLimit: BigInt(process.env.DAILY_LOSS_LIMIT || "50000000"), // 50 USDT in 6-dec
  probableAdapterAddress: (process.env.PROBABLE_ADAPTER_ADDRESS || undefined) as `0x${string}` | undefined,
  probableApiBase: process.env.PROBABLE_API_BASE || "https://api.probable.markets",
  probableEventsApiBase: process.env.PROBABLE_EVENTS_API_BASE || "https://market-api.probable.markets",
  probableMarketIds: process.env.PROBABLE_MARKET_IDS
    ? (JSON.parse(process.env.PROBABLE_MARKET_IDS) as `0x${string}`[])
    : undefined,
  probableMarketMap: process.env.PROBABLE_MARKET_MAP
    ? JSON.parse(process.env.PROBABLE_MARKET_MAP) as Record<string, { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string }>
    : undefined,
  // CLOB execution mode
  executionMode: (process.env.EXECUTION_MODE || "vault") as "vault" | "clob",
  probableExchangeAddress: (process.env.PROBABLE_EXCHANGE_ADDRESS || "0xf99f5367ce708c66f0860b77b4331301a5597c86") as `0x${string}`,
  predictExchangeAddress: (process.env.PREDICT_EXCHANGE_ADDRESS || "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689") as `0x${string}`,
  orderExpirationSec: Number(process.env.ORDER_EXPIRATION_SEC ?? "300"),
  maxOrderRetries: Number(process.env.MAX_ORDER_RETRIES ?? "2"),
  dryRun: process.env.DRY_RUN === "true",
  fillPollIntervalMs: Number(process.env.FILL_POLL_INTERVAL_MS ?? "5000"),
  fillPollTimeoutMs: Number(process.env.FILL_POLL_TIMEOUT_MS ?? "60000"),
  autoDiscover: process.env.AUTO_DISCOVER === "true",
} as const;

if (!config.apiKey) {
  if (process.env.NODE_ENV === "production" || config.chainId !== 31337) {
    throw new Error("API_KEY must be set when running against real chains or in production");
  }
  log.warn("API_KEY is not set — agent API endpoints are unauthenticated");
}

export type Config = typeof config;
