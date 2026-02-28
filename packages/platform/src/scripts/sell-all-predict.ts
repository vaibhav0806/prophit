/**
 * Sell all open Predict positions at a discount to ensure fill.
 * Usage: pnpm --filter platform exec tsx src/scripts/sell-all-predict.ts
 */
import "dotenv/config";
import { createWalletClient, http, defineChain, getAddress, hashTypedData, formatUnits } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { buildOrder, signOrder } from "@prophet/agent/src/clob/signing.js";
import { ORDER_EIP712_TYPES } from "@prophet/agent/src/clob/types.js";
import { createDb } from "@prophet/shared/db";
import { tradingWallets } from "@prophet/shared/db";
import { eq } from "drizzle-orm";

const EOA = "0xdad013d95acb067b2431fde18cbac2bc92ef6b6c" as `0x${string}`;
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";
const chainId = 56;

const PREDICT_DOMAIN_NAME = "predict.fun CTF Exchange";
const PREDICT_SCALE = 1_000_000_000_000_000_000n;
const EXPIRATION_SEC = 300;

const PREDICT_EXCHANGE_STANDARD      = "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689" as `0x${string}`;
const PREDICT_EXCHANGE_NEGRISK       = "0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A" as `0x${string}`;
const PREDICT_EXCHANGE_YIELD         = "0x6bEb5a40C032AFc305961162d8204CDA16DECFa5" as `0x${string}`;
const PREDICT_EXCHANGE_YIELD_NEGRISK = "0x8A289d458f5a134bA40015085A8F50Ffb681B41d" as `0x${string}`;

async function main() {
  const predictBase = (process.env.PREDICT_API_BASE || "").replace(/\/$/, "");
  const predictKey = process.env.PREDICT_API_KEY || "";
  if (!predictBase || !predictKey) { console.error("Missing PREDICT env vars"); process.exit(1); }

  const db = createDb(process.env.DATABASE_URL!);
  const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
  if (!wallet) { console.error("No wallet"); process.exit(1); }

  const rpcUrl = process.env.RPC_URL!;
  const chain = defineChain({ id: chainId, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const account = createPrivyAccount(wallet.privyWalletId, EOA);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });

  // Auth
  console.log("[1] Authenticating...");
  const msgRes = await fetch(predictBase + "/v1/auth/message", { headers: { "x-api-key": predictKey }, signal: AbortSignal.timeout(10_000) });
  const msgData = await msgRes.json() as any;
  const authSig = await walletClient.signMessage({ account, message: msgData.data.message });
  const loginRes = await fetch(predictBase + "/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": predictKey },
    body: JSON.stringify({ signer: getAddress(EOA), message: msgData.data.message, signature: authSig }),
    signal: AbortSignal.timeout(10_000),
  });
  const loginData = await loginRes.json() as any;
  const jwt = loginData.data?.token || loginData.token;
  console.log("  OK\n");

  // Fetch positions
  console.log("[2] Fetching positions...");
  const posRes = await fetch(predictBase + "/v1/positions?signer=" + getAddress(EOA), {
    headers: { "x-api-key": predictKey, Authorization: "Bearer " + jwt },
    signal: AbortSignal.timeout(10_000),
  });
  const posBody = await posRes.json() as any;
  const positions = posBody.data || [];

  if (positions.length === 0) { console.log("  No positions"); process.exit(0); }
  console.log(`  Found ${positions.length} position(s)\n`);

  for (const pos of positions) {
    const market = pos.market;
    const outcome = pos.outcome;
    const tokenId = outcome.onChainId;
    const rawAmount = BigInt(pos.amount);
    const shares = parseFloat(formatUnits(rawAmount, 18));
    const valueUsd = parseFloat(pos.valueUsd);
    const feeRateBps = market.feeRateBps || 200;
    const isNeg = !!market.isNegRisk;
    const isYield = !!market.isYieldBearing;
    const exchange = (isYield && isNeg) ? PREDICT_EXCHANGE_YIELD_NEGRISK
      : isYield ? PREDICT_EXCHANGE_YIELD
      : isNeg ? PREDICT_EXCHANGE_NEGRISK
      : PREDICT_EXCHANGE_STANDARD;

    const currentPrice = valueUsd / shares;
    const sellPrice = Math.round(currentPrice * 0.8 * 1000) / 1000;
    const sellSize = Math.floor(shares * sellPrice * 100) / 100;

    console.log("=".repeat(70));
    console.log(`Market ${market.id}: ${market.question}`);
    console.log(`  Outcome: ${outcome.name} | Token: ${tokenId.slice(0, 30)}...`);
    console.log(`  Shares: ${shares} | Value: $${valueUsd} | Price: $${currentPrice.toFixed(4)}`);
    console.log(`  Sell price: $${sellPrice} (20% discount) | Sell size: $${sellSize}`);
    console.log(`  Flags: negRisk=${isNeg} yieldBearing=${isYield} | Exchange: ${exchange}`);

    if (sellPrice <= 0 || sellSize < 0.01) {
      console.log("  SKIP — price or size too small\n");
      continue;
    }

    const order = buildOrder({
      maker: EOA, signer: EOA, tokenId, side: "SELL",
      price: sellPrice, size: sellSize, feeRateBps,
      expirationSec: EXPIRATION_SEC, nonce: 0n, scale: Number(PREDICT_SCALE),
    });

    if (order.makerAmount > rawAmount) {
      console.log(`  makerAmount ${order.makerAmount} > available ${rawAmount}, reducing...`);
      const priceWei = BigInt(Math.round(sellPrice * 1e8)) * (PREDICT_SCALE / 100_000_000n);
      const adjustedTaker = rawAmount * priceWei / PREDICT_SCALE;
      (order as any).makerAmount = rawAmount;
      (order as any).takerAmount = adjustedTaker;
    }

    console.log(`  makerAmount: ${order.makerAmount} (shares) | available: ${rawAmount}`);
    console.log(`  takerAmount: ${order.takerAmount} (USDT)`);

    const { signature: orderSignature } = await signOrder(walletClient, order, chainId, exchange, PREDICT_DOMAIN_NAME);

    const orderHash = hashTypedData({
      domain: { name: PREDICT_DOMAIN_NAME, version: "1", chainId, verifyingContract: exchange },
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

    console.log("  Placing SELL order...");
    const orderRes = await fetch(predictBase + "/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": predictKey, Authorization: "Bearer " + jwt },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const orderResBody = await orderRes.text();
    console.log(`  => ${orderRes.status}`);
    console.log(`  ${orderResBody.slice(0, 400)}`);

    if (orderRes.status === 201 || orderRes.status === 200) {
      console.log("  ✅ SELL ORDER PLACED");
    } else {
      console.log("  ❌ REJECTED");
    }
    console.log();
  }

  console.log("Done.");
  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e); process.exit(1); });
