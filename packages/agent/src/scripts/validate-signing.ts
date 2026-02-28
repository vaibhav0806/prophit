import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProbableClobClient } from "../clob/probable-client.js";
import { PredictClobClient } from "../clob/predict-client.js";

// ---------------------------------------------------------------------------
// Lightweight env parsing (NOT src/config.ts — it throws on missing vault vars)
// ---------------------------------------------------------------------------

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;

if (!PRIVATE_KEY || !RPC_URL) {
  console.error("Required: PRIVATE_KEY, RPC_URL");
  process.exit(1);
}

const CHAIN_ID = Number(process.env.CHAIN_ID || "56");
const PROBABLE_API_BASE = process.env.PROBABLE_API_BASE || "https://api.probable.markets";
const PROBABLE_EXCHANGE_ADDRESS = (process.env.PROBABLE_EXCHANGE_ADDRESS || "0xf99f5367ce708c66f0860b77b4331301a5597c86") as `0x${string}`;
const PREDICT_API_BASE = process.env.PREDICT_API_BASE || "https://api.predict.fun";
const PREDICT_API_KEY = process.env.PREDICT_API_KEY || "";
const PREDICT_EXCHANGE_ADDRESS = (process.env.PREDICT_EXCHANGE_ADDRESS || "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689") as `0x${string}`;
const PROBABLE_PROXY_ADDRESS = process.env.PROBABLE_PROXY_ADDRESS as `0x${string}` | undefined;

// Parse market maps for test token IDs
function getFirstTokenId(envVar: string): string | null {
  const raw = process.env[envVar];
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, { yesTokenId: string }>;
    const first = Object.values(map)[0];
    return first?.yesTokenId ?? null;
  } catch {
    return null;
  }
}

function getFirstMarketId(envVar: string): string | null {
  const raw = process.env[envVar];
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, { predictMarketId?: string }>;
    const first = Object.values(map)[0];
    return first?.predictMarketId ?? null;
  } catch {
    return null;
  }
}

const probableTokenId = getFirstTokenId("PROBABLE_MARKET_MAP");
const predictTokenId = getFirstTokenId("PREDICT_MARKET_MAP");
const predictMarketId = getFirstMarketId("PREDICT_MARKET_MAP");

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

function getFlag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

const platform = getFlag("--platform", "both");
const shouldCancel = process.argv.includes("--cancel");

// ---------------------------------------------------------------------------
// Viem clients
// ---------------------------------------------------------------------------

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 56 ? "BNB Smart Chain" : "prophet-chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 10_000 }),
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL, { timeout: 10_000 }),
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

async function validateProbable(): Promise<void> {
  console.log("\n========================================");
  console.log(" Validating Probable Markets signing");
  console.log("========================================\n");

  const tokenId = probableTokenId;
  if (!tokenId) {
    console.error("No PROBABLE_MARKET_MAP set — cannot determine test token ID.");
    console.error("Set PROBABLE_MARKET_MAP env var with at least one entry.");
    return;
  }

  console.log(`Token ID: ${tokenId}`);
  console.log(`API base: ${PROBABLE_API_BASE}`);
  console.log(`Exchange: ${PROBABLE_EXCHANGE_ADDRESS}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`Wallet:   ${account.address}`);
  console.log(`Proxy:    ${PROBABLE_PROXY_ADDRESS ?? "none (EOA mode)"}`);

  const client = new ProbableClobClient({
    walletClient,
    apiBase: PROBABLE_API_BASE,
    exchangeAddress: PROBABLE_EXCHANGE_ADDRESS,
    chainId: CHAIN_ID,
    dryRun: false,
    proxyAddress: PROBABLE_PROXY_ADDRESS,
  });

  // Authenticate (derives L2 API key via EIP-712 signed request)
  console.log("\nAuthenticating (deriving L2 API key)...");
  await client.authenticate();
  console.log("Authentication successful.");

  // Fetch nonce (critical — server may reject nonce=0)
  console.log("\nFetching nonce...");
  const nonce = await client.fetchNonce();
  console.log(`Nonce: ${nonce}`);

  // Place minimal test order: $1, BUY, price=0.50
  console.log("\nPlacing test order: $1 BUY @ 0.50...");
  const result = await client.placeOrder({
    tokenId,
    side: "BUY",
    price: 0.50,
    size: 1,
  });

  console.log("\nOrder result:", JSON.stringify(result, null, 2));

  if (result.success && result.orderId && shouldCancel) {
    console.log(`\nCancelling order ${result.orderId}...`);
    const cancelled = await client.cancelOrder(result.orderId, tokenId);
    console.log(`Cancel result: ${cancelled ? "SUCCESS" : "FAILED"}`);
  }

  console.log(`\nProbable validation: ${result.success ? "PASSED" : "FAILED"}`);
  if (!result.success) {
    console.error(`Error: ${result.error}`);
  }
}

async function validatePredict(): Promise<void> {
  console.log("\n========================================");
  console.log(" Validating Predict.fun signing");
  console.log("========================================\n");

  if (!PREDICT_API_KEY) {
    console.error("PREDICT_API_KEY not set — skipping Predict validation.");
    return;
  }

  const tokenId = predictTokenId;
  if (!tokenId) {
    console.error("No PREDICT_MARKET_MAP set — cannot determine test token ID.");
    console.error("Set PREDICT_MARKET_MAP env var with at least one entry.");
    return;
  }

  console.log(`Token ID: ${tokenId}`);
  console.log(`API base: ${PREDICT_API_BASE}`);
  console.log(`Exchange: ${PREDICT_EXCHANGE_ADDRESS}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`Wallet:   ${account.address}`);

  const client = new PredictClobClient({
    walletClient,
    apiBase: PREDICT_API_BASE,
    apiKey: PREDICT_API_KEY,
    exchangeAddress: PREDICT_EXCHANGE_ADDRESS,
    chainId: CHAIN_ID,
    dryRun: false,
  });

  // Authenticate (JWT flow)
  console.log("\nAuthenticating (JWT flow)...");
  await client.authenticate();
  console.log("Authentication successful.");

  // Fetch nonce (critical)
  console.log("\nFetching nonce...");
  const nonce = await client.fetchNonce();
  console.log(`Nonce: ${nonce}`);

  // Place minimal test order: $1, BUY, price=0.50
  console.log(`\nPlacing test order: $1 BUY @ 0.50...`);
  console.log(`Market ID: ${predictMarketId ?? "none (using default exchange)"}`);
  const result = await client.placeOrder({
    tokenId,
    side: "BUY",
    price: 0.50,
    size: 1,
    ...(predictMarketId ? { marketId: predictMarketId } : {}),
  });

  console.log("\nOrder result:", JSON.stringify(result, null, 2));

  if (result.success && result.orderId && shouldCancel) {
    console.log(`\nCancelling order ${result.orderId}...`);
    const cancelled = await client.cancelOrder(result.orderId, tokenId);
    console.log(`Cancel result: ${cancelled ? "SUCCESS" : "FAILED"}`);
  }

  console.log(`\nPredict validation: ${result.success ? "PASSED" : "FAILED"}`);
  if (!result.success) {
    console.error(`Error: ${result.error}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("EIP-712 Signing Validation");
  console.log(`Platform: ${platform}`);
  console.log(`Cancel after place: ${shouldCancel}`);

  if (platform === "probable" || platform === "both") {
    try {
      await validateProbable();
    } catch (err) {
      console.error("\nProbable validation threw:", err);
    }
  }

  if (platform === "predict" || platform === "both") {
    try {
      await validatePredict();
    } catch (err) {
      console.error("\nPredict validation threw:", err);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
