/**
 * Manual test: place a small order on Predict.fun and inspect the full API responses.
 *
 * Investigates why POST /v1/orders returns 200 with orderId but GET /v1/orders/:id returns 404.
 *
 * Usage: pnpm --filter platform exec tsx src/scripts/test-predict-order.ts
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, defineChain, hashTypedData, getAddress } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { buildOrder, signOrder } from "@prophet/agent/src/clob/signing.js";
import { ORDER_EIP712_TYPES } from "@prophet/agent/src/clob/types.js";
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

const PREDICT_API_BASE = (process.env.PREDICT_API_BASE ?? "").replace(/\/$/, "");
const PREDICT_API_KEY = process.env.PREDICT_API_KEY ?? "";

if (!PREDICT_API_BASE || !PREDICT_API_KEY) {
  console.error("Missing PREDICT_API_BASE or PREDICT_API_KEY env vars");
  process.exit(1);
}

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

// Market details — use a known liquid market
const MARKET_ID = "896";
const TOKEN_ID = "98876737971799967586109149861169718634304824070035376080152065110264249734170";

// Order params: minimal size, generous price to ensure matching
const SIDE = "BUY" as const;
const PRICE = 0.50;  // way above the ~0.231 trading price — should match if valid
const SIZE = 1;      // $1 USDT

// Predict.fun constants
const PREDICT_DOMAIN_NAME = "predict.fun CTF Exchange";
const PREDICT_SCALE = 1_000_000_000_000_000_000n; // 1e18
const FEE_RATE_BPS = 200;
const EXPIRATION_SEC = 300; // 5 minutes

// Exchange contracts by market type
const PREDICT_EXCHANGE_STANDARD = "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689" as `0x${string}`;
const PREDICT_EXCHANGE_NEGRISK = "0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A" as `0x${string}`;
const PREDICT_EXCHANGE_YIELD = "0x6bEb5a40C032AFc305961162d8204CDA16DECFa5" as `0x${string}`;
const PREDICT_EXCHANGE_YIELD_NEGRISK = "0x8A289d458f5a134bA40015085A8F50Ffb681B41d" as `0x${string}`;

const erc20BalanceOfAbi = [
  {
    type: "function" as const,
    name: "balanceOf" as const,
    inputs: [{ name: "account" as const, type: "address" as const }],
    outputs: [{ name: "" as const, type: "uint256" as const }],
    stateMutability: "view" as const,
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header() { return "=".repeat(70); }

async function getUsdtBalance(publicClient: ReturnType<typeof createPublicClient>, address: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: BSC_USDT,
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf",
    args: [address],
  });
}

async function predictFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${PREDICT_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "x-api-key": PREDICT_API_KEY,
    ...(options.headers as Record<string, string> ?? {}),
  };
  return fetch(url, { ...options, headers, signal: AbortSignal.timeout(15_000) });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(header());
  console.log("TEST: Predict.fun order placement diagnostic");
  console.log(header());
  console.log(`API Base: ${PREDICT_API_BASE}`);
  console.log(`Market: ${MARKET_ID} | Token: ${TOKEN_ID.slice(0, 20)}...`);
  console.log(`Order: ${SIDE} $${SIZE} @ ${PRICE}`);
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
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });
  console.log(`  EOA: ${eoaAddress}`);
  console.log(`  Privy wallet ID: ${wallet.privyWalletId}`);

  // 2. Check USDT balance before
  console.log();
  console.log("[2] Checking USDT balance BEFORE...");
  const balanceBefore = await getUsdtBalance(publicClient, eoaAddress);
  console.log(`  USDT balance: ${balanceBefore} (${Number(balanceBefore) / 1e18} USDT)`);

  // 3. Authenticate with Predict
  console.log();
  console.log("[3] Authenticating with Predict...");

  // 3a. Get auth message
  const msgRes = await predictFetch("/v1/auth/message");
  const msgResBody = await msgRes.text();
  console.log(`  GET /v1/auth/message => ${msgRes.status}`);
  console.log(`  Response: ${msgResBody}`);
  if (!msgRes.ok) { console.error("Auth message failed"); process.exit(1); }

  const msgData = JSON.parse(msgResBody) as { success: boolean; data: { message: string } };
  const authMessage = msgData.data.message;

  // 3b. Sign auth message
  const authSignature = await walletClient.signMessage({ account, message: authMessage });
  console.log(`  Signature: ${authSignature.slice(0, 20)}...`);

  // 3c. POST login
  const loginRes = await predictFetch("/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signer: getAddress(eoaAddress), message: authMessage, signature: authSignature }),
  });
  const loginResBody = await loginRes.text();
  console.log(`  POST /v1/auth => ${loginRes.status}`);
  console.log(`  Response: ${loginResBody}`);
  if (!loginRes.ok) { console.error("Auth login failed"); process.exit(1); }

  const loginData = JSON.parse(loginResBody) as { data?: { token: string }; token?: string };
  const jwt = loginData.data?.token ?? loginData.token;
  if (!jwt) { console.error("No JWT in login response"); process.exit(1); }
  console.log(`  JWT: ${jwt.slice(0, 30)}...`);

  // 4. Resolve exchange for this market
  console.log();
  console.log("[4] Resolving exchange contract for market...");
  const marketRes = await predictFetch(`/v1/markets/${MARKET_ID}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const marketResBody = await marketRes.text();
  console.log(`  GET /v1/markets/${MARKET_ID} => ${marketRes.status}`);
  console.log(`  Response (first 500 chars): ${marketResBody.slice(0, 500)}`);

  let exchange: `0x${string}` = PREDICT_EXCHANGE_STANDARD;
  if (marketRes.ok) {
    const marketJson = JSON.parse(marketResBody) as { data?: { isNegRisk?: boolean; isYieldBearing?: boolean } };
    const market = marketJson.data ?? (marketJson as any);
    const isNegRisk = market.isNegRisk ?? false;
    const isYieldBearing = market.isYieldBearing ?? false;
    console.log(`  isNegRisk=${isNegRisk}, isYieldBearing=${isYieldBearing}`);

    if (isYieldBearing && isNegRisk) exchange = PREDICT_EXCHANGE_YIELD_NEGRISK;
    else if (isYieldBearing) exchange = PREDICT_EXCHANGE_YIELD;
    else if (isNegRisk) exchange = PREDICT_EXCHANGE_NEGRISK;
    else exchange = PREDICT_EXCHANGE_STANDARD;
  }
  console.log(`  Exchange: ${exchange}`);

  // 5. Build & sign order
  console.log();
  console.log("[5] Building and signing order...");
  const nonce = 0n;

  const order = buildOrder({
    maker: eoaAddress,
    signer: eoaAddress,
    tokenId: TOKEN_ID,
    side: SIDE,
    price: PRICE,
    size: SIZE,
    feeRateBps: FEE_RATE_BPS,
    expirationSec: EXPIRATION_SEC,
    nonce,
    scale: Number(PREDICT_SCALE),
  });

  console.log("  Built order:");
  console.log(`    salt: ${order.salt}`);
  console.log(`    maker: ${order.maker}`);
  console.log(`    signer: ${order.signer}`);
  console.log(`    taker: ${order.taker}`);
  console.log(`    tokenId: ${order.tokenId}`);
  console.log(`    makerAmount: ${order.makerAmount}`);
  console.log(`    takerAmount: ${order.takerAmount}`);
  console.log(`    expiration: ${order.expiration}`);
  console.log(`    nonce: ${order.nonce}`);
  console.log(`    feeRateBps: ${order.feeRateBps}`);
  console.log(`    side: ${order.side}`);
  console.log(`    signatureType: ${order.signatureType}`);

  const { signature: orderSignature } = await signOrder(
    walletClient,
    order,
    chainId,
    exchange,
    PREDICT_DOMAIN_NAME,
  );
  console.log(`  Signature: ${orderSignature.slice(0, 20)}...`);

  // 5b. Compute EIP-712 hash
  const orderHash = hashTypedData({
    domain: {
      name: PREDICT_DOMAIN_NAME,
      version: "1",
      chainId,
      verifyingContract: exchange,
    },
    types: ORDER_EIP712_TYPES,
    primaryType: "Order",
    message: {
      salt: order.salt,
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      expiration: order.expiration,
      nonce: order.nonce,
      feeRateBps: order.feeRateBps,
      side: order.side,
      signatureType: order.signatureType,
    },
  });
  console.log(`  EIP-712 hash: ${orderHash}`);

  // 6. Build payload and POST order
  console.log();
  console.log("[6] Placing order via POST /v1/orders...");

  const pricePerShare = BigInt(Math.floor(PRICE * 1e18)).toString();

  const payload = {
    data: {
      order: {
        salt: order.salt.toString(),
        maker: getAddress(order.maker),
        signer: getAddress(order.signer),
        taker: order.taker,
        tokenId: order.tokenId.toString(),
        makerAmount: order.makerAmount.toString(),
        takerAmount: order.takerAmount.toString(),
        expiration: order.expiration.toString(),
        nonce: order.nonce.toString(),
        feeRateBps: order.feeRateBps.toString(),
        side: order.side, // numeric: 0 (BUY) or 1 (SELL)
        signatureType: order.signatureType,
        signature: orderSignature,
        hash: orderHash,
      },
      pricePerShare,
      strategy: "MARKET",
    },
  };

  console.log("  Payload:");
  console.log(JSON.stringify(payload, null, 2));

  const orderRes = await predictFetch("/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(payload),
  });
  const orderResBody = await orderRes.text();
  console.log();
  console.log(`  POST /v1/orders => ${orderRes.status} ${orderRes.statusText}`);
  console.log(`  Response headers:`);
  orderRes.headers.forEach((v, k) => console.log(`    ${k}: ${v}`));
  console.log(`  Response body:`);
  console.log(orderResBody);

  // Extract orderId for status check
  let orderId: string | undefined;
  try {
    const orderResJson = JSON.parse(orderResBody);
    const data = orderResJson?.data ?? orderResJson;
    orderId = data?.orderId ?? data?.id ?? data?.order_id;
    console.log(`  Extracted orderId: ${orderId}`);
  } catch {
    console.log("  Could not parse response as JSON");
  }

  // 7. Wait, then check order status
  console.log();
  console.log("[7] Waiting 2 seconds before checking order status...");
  await new Promise((r) => setTimeout(r, 2000));

  if (orderId) {
    console.log(`  GET /v1/orders/${orderId}`);
    const statusRes = await predictFetch(`/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const statusResBody = await statusRes.text();
    console.log(`  => ${statusRes.status} ${statusRes.statusText}`);
    console.log(`  Response headers:`);
    statusRes.headers.forEach((v, k) => console.log(`    ${k}: ${v}`));
    console.log(`  Response body:`);
    console.log(statusResBody);
  } else {
    console.log("  No orderId — skipping status check");
  }

  // 7b. Also try listing open orders for this address
  console.log();
  console.log("[7b] Listing open orders for address...");
  const openRes = await predictFetch(`/v1/orders?address=${eoaAddress}&status=OPEN`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const openResBody = await openRes.text();
  console.log(`  GET /v1/orders?address=${eoaAddress}&status=OPEN => ${openRes.status}`);
  console.log(`  Response body (first 1000 chars):`);
  console.log(openResBody.slice(0, 1000));

  // 7c. Try listing ALL orders (not just OPEN) to see if the order shows up with any status
  console.log();
  console.log("[7c] Listing ALL orders for address (no status filter)...");
  const allRes = await predictFetch(`/v1/orders?address=${eoaAddress}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const allResBody = await allRes.text();
  console.log(`  GET /v1/orders?address=${eoaAddress} => ${allRes.status}`);
  console.log(`  Response body (first 2000 chars):`);
  console.log(allResBody.slice(0, 2000));

  // 8. Check USDT balance after
  console.log();
  console.log("[8] Checking USDT balance AFTER...");
  const balanceAfter = await getUsdtBalance(publicClient, eoaAddress);
  console.log(`  USDT balance: ${balanceAfter} (${Number(balanceAfter) / 1e18} USDT)`);
  const diff = balanceBefore - balanceAfter;
  console.log(`  Difference: ${diff} (${Number(diff) / 1e18} USDT)`);
  if (diff > 0n) {
    console.log("  => USDT was spent — order likely filled (at least partially)");
  } else if (diff === 0n) {
    console.log("  => No USDT change — order did NOT fill");
  } else {
    console.log("  => USDT increased — unexpected (refund?)");
  }

  console.log();
  console.log(header());
  console.log("DONE");
  console.log(header());

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
