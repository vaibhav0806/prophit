/**
 * Diagnostic: test whether Predict.fun FOK orders actually fill when placed
 * at a clearly crossable price.
 *
 * 1. Fetches the live orderbook for market 896
 * 2. Prints top 5 bids and asks
 * 3. Places a MARKET FOK BUY at the best ask price ($0.50 notional)
 * 4. Waits 5 seconds
 * 5. Checks USDT balance before/after to confirm fill
 *
 * Usage: pnpm --filter platform exec tsx src/scripts/test-predict-fok.ts
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

// Market details
const MARKET_ID = "896";
const TOKEN_ID = "98876737971799967586109149861169718634304824070035376080152065110264249734170";

// Order params
const SIDE = "BUY" as const;
const SIZE_USD = 1.00; // $1.00 USDT notional — above Predict $0.90 minimum

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

interface OrderBookEntry {
  price: number;
  quantity: number;
}

interface OrderBook {
  asks: Array<[number, number]>;
  bids: Array<[number, number]>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(header());
  console.log("TEST: Predict.fun FOK order fill diagnostic");
  console.log(header());
  console.log(`API Base: ${PREDICT_API_BASE}`);
  console.log(`Market: ${MARKET_ID} | Token: ${TOKEN_ID.slice(0, 20)}...`);
  console.log(`Order: ${SIDE} $${SIZE_USD} FOK with slippageBps=200`);
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

  // 2. Check USDT balance BEFORE
  console.log();
  console.log("[2] Checking USDT balance BEFORE...");
  const balanceBefore = await getUsdtBalance(publicClient, eoaAddress);
  console.log(`  USDT balance: ${balanceBefore} (${Number(balanceBefore) / 1e18} USDT)`);

  // 3. Fetch live orderbook
  console.log();
  console.log("[3] Fetching live orderbook...");
  const bookRes = await predictFetch(`/v1/markets/${MARKET_ID}/orderbook`);
  const bookResBody = await bookRes.text();
  console.log(`  GET /v1/markets/${MARKET_ID}/orderbook => ${bookRes.status}`);

  if (!bookRes.ok) {
    console.error(`  Orderbook fetch failed: ${bookResBody}`);
    process.exit(1);
  }

  const bookJson = JSON.parse(bookResBody) as { success: boolean; data: OrderBook };
  if (!bookJson.success || !bookJson.data) {
    console.error(`  Orderbook response invalid: ${bookResBody.slice(0, 500)}`);
    process.exit(1);
  }

  const book = bookJson.data;
  const sortedAsks = [...book.asks].sort((a, b) => a[0] - b[0]);
  const sortedBids = [...book.bids].sort((a, b) => b[0] - a[0]);

  console.log();
  console.log("  TOP 5 BIDS (highest first):");
  for (let i = 0; i < Math.min(5, sortedBids.length); i++) {
    const [price, qty] = sortedBids[i];
    console.log(`    ${i + 1}. price=${price}  qty=${qty}`);
  }
  if (sortedBids.length === 0) console.log("    (none)");

  console.log();
  console.log("  TOP 5 ASKS (lowest first):");
  for (let i = 0; i < Math.min(5, sortedAsks.length); i++) {
    const [price, qty] = sortedAsks[i];
    console.log(`    ${i + 1}. price=${price}  qty=${qty}`);
  }
  if (sortedAsks.length === 0) console.log("    (none)");

  if (sortedAsks.length === 0) {
    console.error("\n  No asks in orderbook — cannot place a crossable BUY. Aborting.");
    process.exit(1);
  }

  const bestAskPrice = sortedAsks[0][0];
  const bestAskQty = sortedAsks[0][1];
  console.log();
  console.log(`  Best ask: price=${bestAskPrice}  qty=${bestAskQty}`);
  console.log(`  Will place FOK BUY at best ask price ${bestAskPrice} for $${SIZE_USD}`);

  // 4. Authenticate with Predict
  console.log();
  console.log("[4] Authenticating with Predict...");

  // 4a. Get auth message
  const msgRes = await predictFetch("/v1/auth/message");
  const msgResBody = await msgRes.text();
  console.log(`  GET /v1/auth/message => ${msgRes.status}`);
  if (!msgRes.ok) { console.error(`  Auth message failed: ${msgResBody}`); process.exit(1); }

  const msgData = JSON.parse(msgResBody) as { success: boolean; data: { message: string } };
  const authMessage = msgData.data.message;

  // 4b. Sign auth message
  const authSignature = await walletClient.signMessage({ account, message: authMessage });
  console.log(`  Signature: ${authSignature.slice(0, 20)}...`);

  // 4c. POST login
  const loginRes = await predictFetch("/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signer: getAddress(eoaAddress), message: authMessage, signature: authSignature }),
  });
  const loginResBody = await loginRes.text();
  console.log(`  POST /v1/auth => ${loginRes.status}`);
  if (!loginRes.ok) { console.error(`  Auth login failed: ${loginResBody}`); process.exit(1); }

  const loginData = JSON.parse(loginResBody) as { data?: { token: string }; token?: string };
  const jwt = loginData.data?.token ?? loginData.token;
  if (!jwt) { console.error("  No JWT in login response"); process.exit(1); }
  console.log(`  JWT: ${jwt.slice(0, 30)}...`);

  // 5. Resolve exchange for this market
  console.log();
  console.log("[5] Resolving exchange contract for market...");
  const marketRes = await predictFetch(`/v1/markets/${MARKET_ID}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const marketResBody = await marketRes.text();
  console.log(`  GET /v1/markets/${MARKET_ID} => ${marketRes.status}`);

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

  // 6. Build & sign FOK order at best ask price
  console.log();
  console.log("[6] Building and signing FOK order...");

  const orderPrice = bestAskPrice;
  const orderSize = SIZE_USD;
  const nonce = 0n;

  const order = buildOrder({
    maker: eoaAddress,
    signer: eoaAddress,
    tokenId: TOKEN_ID,
    side: SIDE,
    price: orderPrice,
    size: orderSize,
    feeRateBps: FEE_RATE_BPS,
    expirationSec: EXPIRATION_SEC,
    nonce,
    scale: Number(PREDICT_SCALE),
    slippageBps: 200, // bake 2% slippage into on-chain makerAmount for MARKET FOK
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

  // Compute EIP-712 hash
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

  // 7. Build payload with FOK flags and POST order
  console.log();
  console.log("[7] Placing FOK order via POST /v1/orders...");

  const pricePerShare = BigInt(Math.floor(orderPrice * 1e18)).toString();

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
      isFillOrKill: true,
      slippageBps: "200",
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

  // Extract orderId
  let orderId: string | undefined;
  try {
    const orderResJson = JSON.parse(orderResBody);
    const data = orderResJson?.data ?? orderResJson;
    orderId = data?.orderId ?? data?.id ?? data?.order_id;
    console.log(`  Extracted orderId: ${orderId}`);
  } catch {
    console.log("  Could not parse response as JSON");
  }

  // 8. Wait 5 seconds for settlement
  console.log();
  console.log("[8] Waiting 5 seconds for settlement...");
  await new Promise((r) => setTimeout(r, 5000));

  // 8b. Check order status if we have an orderId
  if (orderId) {
    console.log(`  GET /v1/orders/${orderId}`);
    const statusRes = await predictFetch(`/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const statusResBody = await statusRes.text();
    console.log(`  => ${statusRes.status} ${statusRes.statusText}`);
    console.log(`  Response body:`);
    console.log(statusResBody);
  } else {
    console.log("  No orderId — skipping status check");
  }

  // 9. Check USDT balance AFTER
  console.log();
  console.log("[9] Checking USDT balance AFTER...");
  const balanceAfter = await getUsdtBalance(publicClient, eoaAddress);
  console.log(`  USDT balance: ${balanceAfter} (${Number(balanceAfter) / 1e18} USDT)`);
  const diff = balanceBefore - balanceAfter;
  console.log(`  Difference: ${diff} (${Number(diff) / 1e18} USDT)`);

  // 10. Verdict
  console.log();
  console.log(header());
  if (diff > 0n) {
    console.log("RESULT: USDT was spent => FOK order FILLED (at least partially)");
    console.log(`  Spent: ${Number(diff) / 1e18} USDT`);
    console.log(`  Expected: ~$${SIZE_USD} at price ${orderPrice}`);
  } else if (diff === 0n) {
    console.log("RESULT: No USDT change => FOK order DID NOT FILL");
    console.log("  Possible causes:");
    console.log("    - FOK was rejected (no matching liquidity at that price)");
    console.log("    - Order was accepted but not executed on-chain");
    console.log("    - slippageBps too tight for the available liquidity");
  } else {
    console.log("RESULT: USDT increased => unexpected (refund or unrelated transfer)");
    console.log(`  Change: +${Number(-diff) / 1e18} USDT`);
  }
  console.log(header());

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
