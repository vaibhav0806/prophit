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

export const config = {
  rpcUrl: requireEnv("RPC_URL"),
  privateKey: requireHex("PRIVATE_KEY") as `0x${string}`,
  vaultAddress: requireAddress("VAULT_ADDRESS"),
  adapterAAddress: requireAddress("ADAPTER_A_ADDRESS"),
  adapterBAddress: requireAddress("ADAPTER_B_ADDRESS"),
  usdtAddress: requireAddress("USDT_ADDRESS"),
  marketId: requireHex("MARKET_ID") as `0x${string}`,
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
} as const;

if (!config.apiKey) {
  log.warn("API_KEY is not set — agent API endpoints are unauthenticated");
}

export type Config = typeof config;
