/**
 * Test Probable SELL order placement (unwind path verification).
 *
 * Places a LIMIT SELL order on Probable for tokens from today's successful
 * arb trade (market 395, Safe bought at $0.949). Uses the same buildOrder()
 * path as the unwind: quantize=true, slippageBps=100, scale=1e18.
 *
 * If Probable accepts the order, the SELL unwind path is verified.
 *
 * Usage: pnpm --filter platform exec tsx src/scripts/test-probable-sell.ts
 */
import "dotenv/config";
import { createWalletClient, http, defineChain, getAddress } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { buildOrder, signOrder, serializeOrder, buildHmacSignature, signClobAuth } from "@prophet/agent/src/clob/signing.js";
import { createDb } from "@prophet/shared/db";
import { tradingWallets } from "@prophet/shared/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const rpcUrl = process.env.RPC_URL!;
const chainId = 56;
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";
const eoaAddress = "0xdad013d95acb067b2431fde18cbac2bc92ef6b6c" as `0x${string}`;
const safeAddress = "0xD2d193AbB6Ca9365C4D32E52e26a7264F30FfCF9" as `0x${string}`;

const PROBABLE_API_BASE = (process.env.PROBABLE_API_BASE ?? "https://api.probable.markets").replace(/\/$/, "");

const PROBABLE_DOMAIN_NAME = "Probable CTF Exchange";
const PROBABLE_SCALE = 1_000_000_000_000_000_000; // 1e18
const PROBABLE_EXCHANGE = (process.env.PROBABLE_EXCHANGE_ADDRESS ?? "0xf99f5367ce708c66f0860b77b4331301a5597c86") as `0x${string}`;
const FEE_RATE_BPS = 175; // Probable minimum 1.75%
const EXPIRATION_SEC = 300;

// Token from today's successful trade (market 395, Probable leg BUY at $0.949)
const TOKEN_ID = "30328088284441520992647531865948529126291253902044775690572065616792156014763";
const BUY_PRICE = 0.949;
const SELL_SIZE = 1; // $1 USDT — small test, don't sell the whole position
const DISCOUNT = 0.05; // 5% below buy price

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header() { return "=".repeat(70); }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(header());
  console.log("TEST: Probable SELL order (unwind path verification)");
  console.log(header());
  console.log();

  // 1. Set up wallet
  console.log("[1] Setting up wallet...");
  const db = createDb(process.env.DATABASE_URL!);
  const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
  if (!wallet) { console.error("No wallet found for user"); process.exit(1); }

  const chain = defineChain({
    id: chainId,
    name: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const account = createPrivyAccount(wallet.privyWalletId, eoaAddress);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });
  console.log(`  EOA (signer): ${eoaAddress}`);
  console.log(`  Safe (maker): ${safeAddress}`);

  // 2. Authenticate with Probable (L1 → L2 API keys)
  console.log();
  console.log("[2] Authenticating with Probable (L1 → API key)...");

  const auth = await signClobAuth(walletClient, chainId);
  const l1Headers: Record<string, string> = {
    Prob_address: auth.address,
    Prob_signature: auth.signature,
    Prob_timestamp: auth.timestamp,
    Prob_nonce: "0",
  };

  // Try createApiKey first, fall back to deriveApiKey
  let apiKey: string;
  let apiSecret: string;
  let apiPassphrase: string;

  const createRes = await fetch(`${PROBABLE_API_BASE}/public/api/v1/auth/api-key/${chainId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...l1Headers },
    signal: AbortSignal.timeout(10_000),
  });

  let keyData: Record<string, unknown>;
  if (createRes.ok) {
    keyData = await createRes.json() as Record<string, unknown>;
  } else {
    console.log(`  createApiKey returned ${createRes.status}, trying deriveApiKey...`);
    const deriveAuth = await signClobAuth(walletClient, chainId);
    const deriveHeaders: Record<string, string> = {
      Prob_address: deriveAuth.address,
      Prob_signature: deriveAuth.signature,
      Prob_timestamp: deriveAuth.timestamp,
      Prob_nonce: "0",
    };
    const deriveRes = await fetch(`${PROBABLE_API_BASE}/public/api/v1/auth/derive-api-key/${chainId}`, {
      method: "GET",
      headers: deriveHeaders,
      signal: AbortSignal.timeout(10_000),
    });
    if (!deriveRes.ok) {
      console.error(`  deriveApiKey failed: ${deriveRes.status} ${await deriveRes.text()}`);
      process.exit(1);
    }
    keyData = await deriveRes.json() as Record<string, unknown>;
  }

  apiKey = keyData.apiKey as string;
  apiSecret = keyData.secret as string;
  apiPassphrase = keyData.passphrase as string;
  console.log(`  API key: ${apiKey.slice(0, 8)}...`);

  // 3. Build SELL order
  const sellPrice = Math.round(BUY_PRICE * (1 - DISCOUNT) * 1000) / 1000; // 3dp
  console.log();
  console.log("[3] Building SELL order...");
  console.log(`  Token: ${TOKEN_ID.slice(0, 20)}...`);
  console.log(`  Buy price: $${BUY_PRICE}`);
  console.log(`  Sell price: $${sellPrice} (${DISCOUNT * 100}% discount)`);
  console.log(`  Size: $${SELL_SIZE}`);
  console.log(`  Exchange: ${PROBABLE_EXCHANGE}`);

  const order = buildOrder({
    maker: safeAddress,
    signer: eoaAddress,
    tokenId: TOKEN_ID,
    side: "SELL",
    price: sellPrice,
    size: SELL_SIZE,
    feeRateBps: FEE_RATE_BPS,
    expirationSec: EXPIRATION_SEC,
    nonce: 0n,
    scale: PROBABLE_SCALE,
    signatureType: 2, // Gnosis Safe
    quantize: true,
    slippageBps: 100, // 1% slippage buffer
  });

  console.log();
  console.log("  Built order:");
  console.log(`    maker: ${order.maker} (Safe)`);
  console.log(`    signer: ${order.signer} (EOA)`);
  console.log(`    makerAmount: ${order.makerAmount}`);
  console.log(`    takerAmount: ${order.takerAmount}`);
  console.log(`    side: ${order.side} (1 = SELL)`);
  console.log(`    signatureType: ${order.signatureType} (2 = Safe)`);
  console.log(`    implied price: ${Number(order.takerAmount) / Number(order.makerAmount)}`);

  // 4. Sign the order
  console.log();
  console.log("[4] Signing order (EIP-712)...");
  const signed = await signOrder(
    walletClient,
    order,
    chainId,
    PROBABLE_EXCHANGE,
    PROBABLE_DOMAIN_NAME,
  );
  console.log(`  Signature: ${signed.signature.slice(0, 20)}...`);

  // 5. Build payload
  const serialized = serializeOrder(signed.order);
  const body = {
    deferExec: false,
    order: {
      salt: serialized.salt,
      maker: serialized.maker,
      signer: serialized.signer,
      taker: serialized.taker,
      tokenId: serialized.tokenId,
      makerAmount: serialized.makerAmount,
      takerAmount: serialized.takerAmount,
      side: serialized.side,
      expiration: serialized.expiration,
      nonce: serialized.nonce,
      feeRateBps: serialized.feeRateBps,
      signatureType: serialized.signatureType,
      signature: signed.signature,
    },
    owner: safeAddress,
    orderType: "GTC", // GTC for unwind path (sits on book, not instant FOK)
  };

  // 6. Place order with L2 HMAC auth
  console.log();
  console.log("[5] Placing SELL order via POST...");

  const requestPath = `/public/api/v1/order/${chainId}`;
  const bodyStr = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const hmacSig = buildHmacSignature(apiSecret, timestamp, "POST", requestPath, bodyStr);

  const l2Headers: Record<string, string> = {
    Prob_address: account.address,
    Prob_signature: hmacSig,
    Prob_timestamp: String(timestamp),
    Prob_api_key: apiKey,
    Prob_passphrase: apiPassphrase,
  };

  const orderRes = await fetch(`${PROBABLE_API_BASE}${requestPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...l2Headers,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(15_000),
  });
  const orderResBody = await orderRes.text();
  console.log(`  POST ${requestPath} => ${orderRes.status} ${orderRes.statusText}`);
  console.log(`  Response: ${orderResBody}`);

  // 7. Verdict
  console.log();
  if (orderRes.ok) {
    console.log("  ✅ SELL ORDER ACCEPTED — Probable SELL unwind path verified!");

    // Cancel immediately (we don't actually want to sell)
    try {
      const resJson = JSON.parse(orderResBody);
      const orderId = resJson.orderId ?? resJson.orderID ?? resJson.id;
      if (orderId) {
        console.log(`  Cancelling order ${orderId}...`);
        const cancelPath = `/public/api/v1/order/${chainId}/${orderId}?tokenId=${TOKEN_ID}`;
        const cancelTs = Math.floor(Date.now() / 1000);
        const cancelSig = buildHmacSignature(apiSecret, cancelTs, "DELETE", cancelPath);
        const cancelRes = await fetch(`${PROBABLE_API_BASE}${cancelPath}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Prob_address: account.address,
            Prob_signature: cancelSig,
            Prob_timestamp: String(cancelTs),
            Prob_api_key: apiKey,
            Prob_passphrase: apiPassphrase,
          },
          signal: AbortSignal.timeout(10_000),
        });
        console.log(`  DELETE => ${cancelRes.status}`);
      }
    } catch { /* best effort cancel */ }
  } else {
    const hasTickError = orderResBody.includes("tick size") || orderResBody.includes("-4014");
    if (hasTickError) {
      console.log("  ❌ SELL ORDER REJECTED — tick size error (Bug 1 not fully fixed for SELL)");
    } else {
      console.log("  ⚠️  SELL ORDER REJECTED — different error");
    }
  }

  console.log();
  console.log(header());
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
