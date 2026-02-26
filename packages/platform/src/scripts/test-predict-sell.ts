/**
 * Test Bug 2 fix: place a LIMIT SELL order on Predict for stranded tokens.
 *
 * Tests that buildOrder() with the derive-amounts fix produces
 * makerAmount/takerAmount that pass Predict's exact price validation
 * (previously failed with NonMatchingAmountsError).
 *
 * Places a LIMIT GTC SELL at a 5% discount from original buy price.
 * If Predict accepts the order (201), Bug 2 is verified fixed.
 *
 * Usage: pnpm --filter platform exec tsx src/scripts/test-predict-sell.ts
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, defineChain, hashTypedData, getAddress } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { buildOrder, signOrder } from "@prophit/agent/src/clob/signing.js";
import { ORDER_EIP712_TYPES } from "@prophit/agent/src/clob/types.js";
import { createDb } from "@prophit/shared/db";
import { tradingWallets } from "@prophit/shared/db";
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

// Predict constants
const PREDICT_DOMAIN_NAME = "predict.fun CTF Exchange";
const PREDICT_SCALE = 1_000_000_000_000_000_000n; // 1e18
const FEE_RATE_BPS = 200;
const EXPIRATION_SEC = 300;

// Exchange contracts
const PREDICT_EXCHANGE_STANDARD = "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689" as `0x${string}`;
const PREDICT_EXCHANGE_YIELD_NEGRISK = "0x8A289d458f5a134bA40015085A8F50Ffb681B41d" as `0x${string}`;

// Stranded positions from incident 2026-02-25
const POSITIONS = [
  {
    label: "Market 896 (standard)",
    marketId: "896",
    tokenId: "98876737971799967586109149861169718634304824070035376080152065110264249734170",
    buyPrice: 0.231,
    costBasis: 4.0,
    exchange: PREDICT_EXCHANGE_STANDARD,
  },
  {
    label: "Market 1528 (negRisk + yieldBearing)",
    marketId: "1528",
    tokenId: "21808188434154981111364433028427990955948831667619569192992500667769531501984",
    buyPrice: 0.014,
    costBasis: 4.0,
    exchange: PREDICT_EXCHANGE_YIELD_NEGRISK,
  },
];

const DISCOUNT = 0.05; // 5% discount from buy price

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header() { return "=".repeat(70); }

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
  console.log("TEST: Predict LIMIT SELL order (Bug 2 verification)");
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
  console.log(`  EOA: ${eoaAddress}`);

  // 2. Authenticate with Predict
  console.log();
  console.log("[2] Authenticating with Predict...");

  const msgRes = await predictFetch("/v1/auth/message");
  if (!msgRes.ok) { console.error(`  Auth message failed: ${await msgRes.text()}`); process.exit(1); }
  const msgData = JSON.parse(await msgRes.text()) as { success: boolean; data: { message: string } };
  const authMessage = msgData.data.message;

  const authSignature = await walletClient.signMessage({ account, message: authMessage });

  const loginRes = await predictFetch("/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signer: getAddress(eoaAddress), message: authMessage, signature: authSignature }),
  });
  if (!loginRes.ok) { console.error(`  Auth login failed: ${await loginRes.text()}`); process.exit(1); }

  const loginData = JSON.parse(await loginRes.text()) as { data?: { token: string }; token?: string };
  const jwt = loginData.data?.token ?? loginData.token;
  if (!jwt) { console.error("  No JWT in login response"); process.exit(1); }
  console.log(`  Authenticated. JWT: ${jwt.slice(0, 30)}...`);

  // 3. Test each stranded position
  for (const pos of POSITIONS) {
    console.log();
    console.log(header());
    console.log(`Testing: ${pos.label}`);
    console.log(`  Market: ${pos.marketId} | Token: ${pos.tokenId.slice(0, 20)}...`);
    console.log(`  Buy price: $${pos.buyPrice} | Cost basis: $${pos.costBasis}`);
    console.log(`  Exchange: ${pos.exchange}`);
    console.log(header());

    // Compute sell price at 5% discount, rounded to 3dp
    const sellPrice = Math.round(pos.buyPrice * (1 - DISCOUNT) * 1000) / 1000;
    const sellSize = pos.costBasis;
    console.log(`  Sell price: $${sellPrice} (${DISCOUNT * 100}% discount from $${pos.buyPrice})`);
    console.log(`  Sell size: $${sellSize}`);

    // Build order using the Bug 2 fixed path (no quantize, no slippage, scale 1e18)
    const order = buildOrder({
      maker: eoaAddress,
      signer: eoaAddress,
      tokenId: pos.tokenId,
      side: "SELL",
      price: sellPrice,
      size: sellSize,
      feeRateBps: FEE_RATE_BPS,
      expirationSec: EXPIRATION_SEC,
      nonce: 0n,
      scale: Number(PREDICT_SCALE),
    });

    console.log();
    console.log("  Built SELL order:");
    console.log(`    makerAmount: ${order.makerAmount} (shares to sell)`);
    console.log(`    takerAmount: ${order.takerAmount} (USDT to receive)`);
    console.log(`    side: ${order.side} (1 = SELL)`);

    const impliedPrice = Number(order.takerAmount) / Number(order.makerAmount);
    console.log(`    implied price: ${impliedPrice}`);
    console.log(`    target price:  ${sellPrice}`);
    console.log(`    ratio match: ${Math.abs(impliedPrice - sellPrice) < 1e-10 ? "YES" : "NO (!!)"}`);

    // Sign the order
    const { signature: orderSignature } = await signOrder(walletClient, order, chainId, pos.exchange, PREDICT_DOMAIN_NAME);

    // Compute EIP-712 hash
    const orderHash = hashTypedData({
      domain: { name: PREDICT_DOMAIN_NAME, version: "1", chainId, verifyingContract: pos.exchange },
      types: ORDER_EIP712_TYPES,
      primaryType: "Order",
      message: {
        salt: order.salt, maker: order.maker, signer: order.signer, taker: order.taker,
        tokenId: order.tokenId, makerAmount: order.makerAmount, takerAmount: order.takerAmount,
        expiration: order.expiration, nonce: order.nonce, feeRateBps: order.feeRateBps,
        side: order.side, signatureType: order.signatureType,
      },
    });

    const pricePerShare = (BigInt(Math.round(sellPrice * 1e8)) * 10_000_000_000n).toString();
    console.log(`    pricePerShare: ${pricePerShare}`);

    const payload = {
      data: {
        order: {
          salt: order.salt.toString(), maker: getAddress(order.maker), signer: getAddress(order.signer),
          taker: order.taker, tokenId: order.tokenId.toString(),
          makerAmount: order.makerAmount.toString(), takerAmount: order.takerAmount.toString(),
          expiration: order.expiration.toString(), nonce: order.nonce.toString(),
          feeRateBps: order.feeRateBps.toString(), side: order.side,
          signatureType: order.signatureType, signature: orderSignature, hash: orderHash,
        },
        pricePerShare,
        strategy: "LIMIT",
        isFillOrKill: false,
      },
    };

    console.log();
    console.log("  Placing LIMIT SELL order...");
    const orderRes = await predictFetch("/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(payload),
    });
    const orderResBody = await orderRes.text();
    console.log(`  POST /v1/orders => ${orderRes.status} ${orderRes.statusText}`);
    console.log(`  Response: ${orderResBody}`);

    console.log();
    if (orderRes.status === 201 || orderRes.status === 200) {
      console.log(`  ✅ ORDER ACCEPTED — Bug 2 fix VERIFIED for ${pos.label}`);
      console.log("     NonMatchingAmountsError is gone!");

      try {
        const resJson = JSON.parse(orderResBody);
        const orderId = resJson?.data?.orderId ?? resJson?.orderId;
        if (orderId) {
          console.log(`  Cancelling order ${orderId}...`);
          const cancelRes = await predictFetch(`/v1/orders/${orderId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${jwt}` },
          });
          console.log(`  DELETE /v1/orders/${orderId} => ${cancelRes.status}`);
        }
      } catch { /* best effort cancel */ }
    } else {
      const hasAmountError = orderResBody.includes("NonMatchingAmounts") || orderResBody.includes("amount");
      if (hasAmountError) {
        console.log(`  ❌ ORDER REJECTED — Bug 2 NOT fixed for ${pos.label}`);
        console.log("     Still getting amount mismatch error.");
      } else {
        console.log(`  ⚠️  ORDER REJECTED — different error (not Bug 2)`);
        console.log("     May be insufficient token balance, nonce issue, or other.");
      }
    }
  }

  console.log();
  console.log(header());
  console.log("Done.");
  console.log(header());
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
